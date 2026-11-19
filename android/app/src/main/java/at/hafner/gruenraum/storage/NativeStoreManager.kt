package at.hafner.gruenraum.storage

import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

data class BackupResult(
    val ok: Boolean,
    val isoTimestamp: String,
    val targetLabel: String,
    val verifiedBytes: Int,
    val error: String? = null
)

class ConflictingRequestException(message: String) : IllegalArgumentException(message)
class StaleRevisionException(message: String) : IllegalStateException(message)

/**
 * Gemeinsamer, prozessweit synchronisierter Lese-Prüf-Ändere-Speichere-Pfad
 * für Infinity (Oberfläche, direkter OpenAI-Pixel-Tunnel und Cloud-Synchronisation).
 *
 * - Atomare Speicherung mit Rücklese-Prüfung (SHA-256).
 * - Revisionszähler & Schutz gegen Überschreiben neuerer MCP-Änderungen durch veraltete WebView-/Cloud-Snapshots.
 * - Dauerhafte Idempotenz-Belege (infinity_tunnel_receipts.json) für alle Schreibaufträge über den Pixel-Tunnel.
 */
class NativeStoreManager(context: Context) {

    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val storeFile = File(appContext.filesDir, "hafner_app_store.json")
    private val storeBackupFile = File(appContext.filesDir, "hafner_app_store.json.bak")
    private val receiptsFile = File(appContext.filesDir, "infinity_tunnel_receipts.json")
    private val internalZipDir = File(appContext.filesDir, "backups").apply { mkdirs() }
    private val internalZipFile = File(internalZipDir, "hausgarten-backup.zip")

    var onLocalStateChanged: (() -> Unit)? = null

    fun getDatasetId(): String {
        synchronized(STORE_LOCK) {
            val existing = prefs.getString(KEY_DATASET_ID, null)
            if (!existing.isNullOrBlank()) return existing
            val created = "infinity-pixel-${UUID.randomUUID().toString().take(12)}"
            prefs.edit().putString(KEY_DATASET_ID, created).commit()
            return created
        }
    }

    fun getLocalRevision(): Int {
        synchronized(STORE_LOCK) {
            val rev = prefs.getInt(KEY_LOCAL_REVISION, 0)
            if (rev > 0) return rev
            val hasData = loadRawStringLocked() != null
            if (hasData) {
                prefs.edit().putInt(KEY_LOCAL_REVISION, 1).commit()
                return 1
            }
            return 0
        }
    }

    fun getLocalUpdatedAt(): String {
        synchronized(STORE_LOCK) {
            return prefs.getString(KEY_LOCAL_UPDATED_AT, null) ?: Instant.now().toString()
        }
    }

    fun getLocalLastActor(): String {
        synchronized(STORE_LOCK) {
            return prefs.getString(KEY_LOCAL_LAST_ACTOR, "ui") ?: "ui"
        }
    }

    fun getLocalLastSummary(): String {
        synchronized(STORE_LOCK) {
            return prefs.getString(KEY_LOCAL_LAST_SUMMARY, "Bereit") ?: "Bereit"
        }
    }

    fun loadAppState(): String? {
        synchronized(STORE_LOCK) {
            val loaded = loadRawStringLocked()
            lastWebViewLoadedRevision = getLocalRevision()
            return loaded
        }
    }

    fun loadOrInitStateObject(): JSONObject {
        synchronized(STORE_LOCK) {
            val raw = loadRawStringLocked()
            if (!raw.isNullOrBlank()) {
                try {
                    return ensureAllCollections(JSONObject(raw))
                } catch (_: Exception) {
                }
            }
            return ensureAllCollections(JSONObject())
        }
    }

    /**
     * Liefert einen von schweren Base64-Medien (Fotos/Dokument-Blobs) befreiten Lese-Snapshot aus dem RAM-Cache.
     * Vermeidet das wiederholte Parsen mehrerer Megabyte an Base64-Strings bei MCP-Leseabfragen (< 1 ms statt ~150 ms).
     */
    fun loadOrInitLightStateObject(): JSONObject {
        synchronized(STORE_LOCK) {
            cachedLightStateJson?.let { lightRaw ->
                try {
                    return ensureAllCollections(JSONObject(lightRaw))
                } catch (_: Exception) {
                    cachedLightStateJson = null
                }
            }
            val fullObj = loadOrInitStateObject()
            val lightObj = buildLightStateObject(fullObj)
            cachedLightStateJson = lightObj.toString()
            return lightObj
        }
    }

    private fun buildLightStateObject(fullState: JSONObject): JSONObject {
        val light = JSONObject()
        for (col in COLLECTION_KEYS) {
            val srcArr = fullState.optJSONArray(col) ?: JSONArray()
            val dstArr = JSONArray()
            for (i in 0 until srcArr.length()) {
                val item = srcArr.optJSONObject(i) ?: continue
                dstArr.put(stripHeavyMediaFromRecordFast(item, includePhotos = false))
            }
            light.put(col, dstArr)
        }
        fullState.optJSONObject("taxSettings")?.let {
            light.put("taxSettings", JSONObject(it.toString()))
        }
        fullState.optJSONObject("deletedIds")?.let {
            light.put("deletedIds", JSONObject(it.toString()))
        }
        return ensureAllCollections(light)
    }

    private fun loadRawStringLocked(): String? {
        cachedRawStateJson?.let { cached ->
            if (cached.length > 2) return cached
        }
        return try {
            val diskRaw = when {
                storeFile.exists() && storeFile.length() > 2 -> storeFile.readText(Charsets.UTF_8)
                storeBackupFile.exists() && storeBackupFile.length() > 2 -> storeBackupFile.readText(Charsets.UTF_8)
                else -> null
            }
            if (!diskRaw.isNullOrBlank()) {
                cachedRawStateJson = diskRaw
                cachedLightStateJson = null
            }
            diskRaw
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Speichert Änderungen aus der WebView-Oberfläche.
     * Falls zwischenzeitlich Änderungen über den direkten Pixel-Tunnel geschrieben wurden,
     * wird ein veralteter WebView-Snapshot nicht blind über neuere Tunnel-Daten geschrieben,
     * sondern datensatzweise anhand von updated_at und Tombstones zusammengeführt.
     */
    fun saveAppState(json: String): Boolean {
        var mergedNotifyPayload: Triple<String, Int, String>? = null
        val ok = synchronized(STORE_LOCK) {
            try {
                val incomingObj = ensureAllCollections(JSONObject(json))
                val currentRev = getLocalRevision()
                val currentActor = getLocalLastActor()
                val existingRaw = loadRawStringLocked()

                val finalJsonStr: String
                val wasMergedWithNewerTunnelState: Boolean

                if (
                    existingRaw != null &&
                    currentRev > lastWebViewLoadedRevision
                ) {
                    val existingObj = ensureAllCollections(JSONObject(existingRaw))
                    val mergedObj = mergeSnapshotsLocked(
                        primaryNewer = existingObj,
                        secondaryOlder = incomingObj
                    )
                    finalJsonStr = mergedObj.toString()
                    wasMergedWithNewerTunnelState = true
                } else {
                    finalJsonStr = incomingObj.toString()
                    wasMergedWithNewerTunnelState = false
                    if (existingRaw != null && existingRaw == finalJsonStr) {
                        lastWebViewLoadedRevision = currentRev
                        return@synchronized true
                    }
                }

                if (!writeAtomicallyAndVerifyLocked(finalJsonStr)) {
                    return@synchronized false
                }

                val nextRev = currentRev + 1
                val nowIso = Instant.now().toString()
                prefs.edit()
                    .putInt(KEY_LOCAL_REVISION, nextRev)
                    .putString(KEY_LOCAL_UPDATED_AT, nowIso)
                    .putString(KEY_LOCAL_LAST_ACTOR, if (wasMergedWithNewerTunnelState) currentActor else "ui")
                    .putString(KEY_LOCAL_LAST_SUMMARY, "Lokale Speicherung (Oberfläche)")
                    .commit()
                lastWebViewLoadedRevision = nextRev

                if (wasMergedWithNewerTunnelState) {
                    mergedNotifyPayload = Triple(
                        finalJsonStr,
                        nextRev,
                        "Mit neueren Pixel-Tunnel-Änderungen abgeglichen"
                    )
                }
                true
            } catch (_: Exception) {
                false
            }
        }

        if (ok) {
            onLocalStateChanged?.invoke()
            notifyStaticLocalSaveListeners()
            mergedNotifyPayload?.let { (stateStr, rev, summary) ->
                notifyTunnelMutationListeners(stateStr, rev, summary)
            }
        }
        return ok
    }

    /**
     * Speichert eingehenden Cloud-/Remote-Snapshot, ohne neuere lokale Tunnel- oder Offline-Änderungen zu verlieren.
     */
    fun saveAppStateFromRemote(json: String): Boolean {
        return synchronized(STORE_LOCK) {
            try {
                val remoteObj = ensureAllCollections(JSONObject(json))
                val existingRaw = loadRawStringLocked()
                val currentActor = getLocalLastActor()
                val finalObj = if (existingRaw != null && currentActor == "pixel_tunnel") {
                    val localObj = ensureAllCollections(JSONObject(existingRaw))
                    mergeSnapshotsLocked(primaryNewer = localObj, secondaryOlder = remoteObj)
                } else {
                    remoteObj
                }
                val ok = writeAtomicallyAndVerifyLocked(finalObj.toString())
                if (ok) {
                    val nextRev = maxOf(getLocalRevision() + 1, 1)
                    prefs.edit()
                        .putInt(KEY_LOCAL_REVISION, nextRev)
                        .putString(KEY_LOCAL_UPDATED_AT, Instant.now().toString())
                        .putString(KEY_LOCAL_LAST_ACTOR, "cloud_sync")
                        .putString(KEY_LOCAL_LAST_SUMMARY, "Cloud-Abgleich übernommen")
                        .commit()
                    lastWebViewLoadedRevision = nextRev
                }
                ok
            } catch (_: Exception) {
                false
            }
        }
    }

    /**
     * Atomarer Lese-Prüf-Ändere-Speichere-Pfad für Schreibaufträge über den direkten OpenAI-Pixel-Tunnel.
     * - Prüft zuerst dauerhaften Wiederholungsbeleg (request_id + fingerprint).
     * - Prüft optional expectedRevision.
     * - Führt die Änderung aus, speichert & verifiziert die JSON-Datenbank sowie den Wiederholungsbeleg atomar.
     * - Benachrichtigt Oberfläche (falls offen) und Cloud-Synchronisation.
     */
    @Throws(Exception::class)
    fun executeTunnelMutation(
        requestId: String,
        fingerprint: String,
        expectedRevision: Int?,
        summary: String,
        mutator: (stateObj: JSONObject, nextRevision: Int) -> JSONObject
    ): JSONObject {
        val cleanReqId = requestId.trim()
        var notifyState: Triple<String, Int, String>? = null

        val resultObj = synchronized(STORE_LOCK) {
            val receipts = loadReceiptsLocked()
            if (cleanReqId.isNotEmpty() && receipts.has(cleanReqId)) {
                val existingReceipt = receipts.getJSONObject(cleanReqId)
                val storedFp = existingReceipt.optString("fingerprint", "")
                if (storedFp != fingerprint) {
                    throw ConflictingRequestException(
                        "CONFLICTING_REQUEST_ID: Die request_id '$cleanReqId' wurde bereits mit anderen Eingabedaten verwendet."
                    )
                }
                val storedResult = existingReceipt.optJSONObject("result")
                if (storedResult != null) {
                    return@synchronized JSONObject(storedResult.toString()).apply {
                        put("replayedFromReceipt", true)
                    }
                }
            }

            val currentRev = getLocalRevision()
            if (expectedRevision != null && expectedRevision >= 0 && expectedRevision != currentRev) {
                throw StaleRevisionException(
                    "REVISION_CONFLICT: Erwartete Revision $expectedRevision stimmt nicht mit aktuellem lokalen Datenstand (Revision $currentRev) überein."
                )
            }

            val stateObj = loadOrInitStateObject()
            val nextRev = currentRev + 1
            val mutationResult = mutator(stateObj, nextRev)
            val serializedState = ensureAllCollections(stateObj).toString()

            if (!writeAtomicallyAndVerifyLocked(serializedState)) {
                throw IOException("SAVE_FAILED: Lokale Speicherung auf dem Pixel 10 Pro fehlgeschlagen.")
            }

            val nowIso = Instant.now().toString()
            mutationResult.put("revision", nextRev)
            mutationResult.put("datasetId", getDatasetId())
            mutationResult.put("updatedAt", nowIso)

            if (cleanReqId.isNotEmpty()) {
                val receiptEntry = JSONObject().apply {
                    put("requestId", cleanReqId)
                    put("fingerprint", fingerprint)
                    put("revision", nextRev)
                    put("createdAt", nowIso)
                    put("summary", summary)
                    put("result", JSONObject(mutationResult.toString()))
                }
                receipts.put(cleanReqId, receiptEntry)
                saveReceiptsLocked(receipts)
            }

            prefs.edit()
                .putInt(KEY_LOCAL_REVISION, nextRev)
                .putString(KEY_LOCAL_UPDATED_AT, nowIso)
                .putString(KEY_LOCAL_LAST_ACTOR, "pixel_tunnel")
                .putString(KEY_LOCAL_LAST_SUMMARY, summary)
                .commit()

            notifyState = Triple(serializedState, nextRev, summary)
            mutationResult
        }

        notifyState?.let { (stateStr, rev, sum) ->
            onLocalStateChanged?.invoke()
            notifyStaticLocalSaveListeners()
            notifyTunnelMutationListeners(stateStr, rev, sum)
        }

        return resultObj
    }

    private fun loadReceiptsLocked(): JSONObject {
        cachedReceiptsJson?.let { cached ->
            return runCatching { JSONObject(cached) }.getOrElse { JSONObject() }
        }
        return try {
            if (receiptsFile.exists() && receiptsFile.length() > 2) {
                val raw = receiptsFile.readText(Charsets.UTF_8)
                val parsed = JSONObject(raw)
                cachedReceiptsJson = raw
                parsed
            } else {
                cachedReceiptsJson = "{}"
                JSONObject()
            }
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun saveReceiptsLocked(receipts: JSONObject) {
        try {
            // Begrenze dauerhafte Belege auf die letzten 500 Einträge nach Zeitstempel
            val keys = receipts.keys().asSequence().toList()
            if (keys.size > 500) {
                val sorted = keys.sortedBy { k ->
                    receipts.optJSONObject(k)?.optString("createdAt", "") ?: ""
                }
                val toRemove = sorted.take(keys.size - 500)
                for (k in toRemove) {
                    receipts.remove(k)
                }
            }
            val tmp = File(appContext.filesDir, "infinity_tunnel_receipts.json.tmp")
            val text = receipts.toString()
            cachedReceiptsJson = text
            tmp.writeText(text, Charsets.UTF_8)
            if (!tmp.renameTo(receiptsFile)) {
                tmp.copyTo(receiptsFile, overwrite = true)
                tmp.delete()
            }
        } catch (_: Exception) {
        }
    }

    private fun writeAtomicallyAndVerifyLocked(json: String): Boolean {
        return try {
            JSONObject(json) // Validate well-formed JSON before atomic swap
            val expectedHash = sha256Hex(json.toByteArray(Charsets.UTF_8))
            val tmpFile = File(appContext.filesDir, "hafner_app_store.json.tmp")
            tmpFile.writeText(json, Charsets.UTF_8)
            if (storeFile.exists()) {
                storeFile.copyTo(storeBackupFile, overwrite = true)
            }
            if (!tmpFile.renameTo(storeFile)) {
                tmpFile.copyTo(storeFile, overwrite = true)
                tmpFile.delete()
            }
            // Mandatory read-back verification
            val readBack = storeFile.readText(Charsets.UTF_8)
            val actualHash = sha256Hex(readBack.toByteArray(Charsets.UTF_8))
            val verified = expectedHash == actualHash
            if (verified) {
                cachedRawStateJson = readBack
                cachedLightStateJson = null
            }
            verified
        } catch (_: Exception) {
            false
        }
    }

    private fun ensureAllCollections(obj: JSONObject): JSONObject {
        for (col in COLLECTION_KEYS) {
            if (obj.optJSONArray(col) == null) {
                obj.put(col, JSONArray())
            }
        }
        if (obj.optJSONObject("taxSettings") == null) {
            obj.put(
                "taxSettings",
                JSONObject().apply {
                    put("selected_year", 2026)
                    put("preferred_method", "auto_best")
                    put("svs_paid", 0)
                    put("workplace_allowance", 0)
                    put("transit_ticket_full", 0)
                    put("manual_extra_income", 0)
                }
            )
        }
        if (obj.optJSONObject("deletedIds") == null) {
            obj.put("deletedIds", JSONObject())
        }
        return obj
    }

    private fun mergeSnapshotsLocked(primaryNewer: JSONObject, secondaryOlder: JSONObject): JSONObject {
        val out = JSONObject()
        val tombstones = JSONObject()
        for (src in listOf(secondaryOlder.optJSONObject("deletedIds"), primaryNewer.optJSONObject("deletedIds"))) {
            if (src == null) continue
            val it = src.keys()
            while (it.hasNext()) {
                val k = it.next()
                val v = src.optString(k, "")
                val existing = tombstones.optString(k, "")
                if (v.isNotEmpty() && (existing.isEmpty() || v >= existing)) {
                    tombstones.put(k, v)
                }
            }
        }

        for (col in COLLECTION_KEYS) {
            val byId = LinkedHashMap<String, JSONObject>()
            val olderArr = secondaryOlder.optJSONArray(col) ?: JSONArray()
            for (i in 0 until olderArr.length()) {
                val item = olderArr.optJSONObject(i) ?: continue
                val id = item.optString("id", "")
                if (id.isNotEmpty()) byId[id] = item
            }
            val newerArr = primaryNewer.optJSONArray(col) ?: JSONArray()
            for (i in 0 until newerArr.length()) {
                val item = newerArr.optJSONObject(i) ?: continue
                val id = item.optString("id", "")
                if (id.isEmpty()) continue
                val prev = byId[id]
                if (prev == null) {
                    byId[id] = item
                } else {
                    val prevUpdated = prev.optString("updated_at", "")
                    val newUpdated = item.optString("updated_at", "")
                    val sameTime = prevUpdated == newUpdated
                    val winner = if (prevUpdated.isEmpty() || (newUpdated.isNotEmpty() && newUpdated >= prevUpdated)) {
                        item
                    } else {
                        prev
                    }
                    val other = if (winner === item) prev else item
                    if (sameTime) {
                        val winPhoto = winner.optString("photo", "").trim()
                        val othPhoto = other.optString("photo", "").trim()
                        if ((winner.isNull("photo") || winPhoto.isEmpty() || winPhoto == "null") &&
                            !other.isNull("photo") && othPhoto.isNotEmpty() && othPhoto != "null"
                        ) {
                            winner.put("photo", othPhoto)
                        }
                    }
                    byId[id] = winner
                }
            }

            val mergedArr = JSONArray()
            for ((id, item) in byId) {
                val tombKey = "$col:$id"
                val deletedAt = tombstones.optString(tombKey, "")
                val itemUpdated = item.optString("updated_at", "")
                if (deletedAt.isNotEmpty() && (itemUpdated.isEmpty() || deletedAt >= itemUpdated)) {
                    continue
                }
                mergedArr.put(item)
            }
            out.put(col, mergedArr)
        }

        out.put(
            "taxSettings",
            primaryNewer.optJSONObject("taxSettings")
                ?: secondaryOlder.optJSONObject("taxSettings")
                ?: JSONObject()
        )
        out.put("deletedIds", tombstones)
        return out
    }

    fun getPersistedBackupUri(): Uri? {
        val raw = prefs.getString(KEY_BACKUP_URI, null) ?: return null
        return try {
            val uri = Uri.parse(raw)
            val persisted = appContext.contentResolver.persistedUriPermissions.any {
                it.uri == uri && it.isReadPermission && it.isWritePermission
            }
            if (persisted) uri else null
        } catch (_: Exception) {
            null
        }
    }

    fun savePersistedBackupUri(uri: Uri) {
        try {
            val flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
            appContext.contentResolver.takePersistableUriPermission(uri, flags)
        } catch (_: Exception) {
            // Provider may already grant access for session
        }
        prefs.edit().putString(KEY_BACKUP_URI, uri.toString()).apply()
    }

    fun getBackupMetaJson(): String {
        val obj = JSONObject()
        val extUri = getPersistedBackupUri()
        obj.put("hasExternalTarget", extUri != null)
        obj.put("targetLabel", extUri?.lastPathSegment ?: "hausgarten-backup.zip (Gerätespeicher)")
        obj.put("lastBackupDate", prefs.getString(KEY_LAST_BACKUP_ISO, null) ?: JSONObject.NULL)
        obj.put("hasInternalBackup", internalZipFile.exists())
        return obj.toString()
    }

    private fun buildLightWebAppBackupBytes(fullJson: String): ByteArray {
        return try {
            val root = JSONObject(fullJson)
            root.put("backupVariant", "webapp_light")
            for (col in listOf("customers", "properties", "workRecords", "equipments")) {
                val arr = root.optJSONArray(col) ?: continue
                for (i in 0 until arr.length()) {
                    val item = arr.optJSONObject(i) ?: continue
                    if (item.has("photo")) {
                        item.put("photo", JSONObject.NULL)
                    }
                    if (item.has("photos")) {
                        item.put("photos", JSONArray())
                    }
                }
            }
            root.toString().toByteArray(Charsets.UTF_8)
        } catch (_: Exception) {
            fullJson.toByteArray(Charsets.UTF_8)
        }
    }

    fun writeVerifiedZipBackup(jsonPayload: String, targetUri: Uri?): BackupResult {
        return try {
            JSONObject(jsonPayload) // Validate JSON before writing
            val nowIso = Instant.now().toString()
            val payloadBytes = jsonPayload.toByteArray(Charsets.UTF_8)
            val lightPayloadBytes = buildLightWebAppBackupBytes(jsonPayload)
            val sha256 = sha256Hex(payloadBytes)
            val lightSha256 = sha256Hex(lightPayloadBytes)

            val manifestJson = JSONObject().apply {
                put("app", "Infinity · Hafner Grünraum Handwerk")
                put("createdAt", nowIso)
                put("sha256", sha256)
                put("payloadBytes", payloadBytes.size)
                put("lightSha256", lightSha256)
                put("lightPayloadBytes", lightPayloadBytes.size)
            }.toString()

            val creds = at.hafner.gruenraum.sync.SecureMcpCredentialStore(appContext).loadCredentials()
            val gmailConfigBytes = JSONObject().apply {
                put("gmailSenderEmail", creds.gmailSenderEmail)
                put("gmailAppPassword", creds.gmailAppPassword)
                put("gmailOAuthToken", creds.gmailOAuthToken)
            }.toString().toByteArray(Charsets.UTF_8)

            val zipBytes = ByteArrayOutputStream().use { baos ->
                ZipOutputStream(baos).use { zos ->
                    zos.putNextEntry(ZipEntry("hausgarten_backup_v1.json"))
                    zos.write(payloadBytes)
                    zos.closeEntry()

                    zos.putNextEntry(ZipEntry("hausgarten_webapp_light.json"))
                    zos.write(lightPayloadBytes)
                    zos.closeEntry()

                    zos.putNextEntry(ZipEntry("gmail_config.json"))
                    zos.write(gmailConfigBytes)
                    zos.closeEntry()

                    zos.putNextEntry(ZipEntry("manifest.json"))
                    zos.write(manifestJson.toByteArray(Charsets.UTF_8))
                    zos.closeEntry()
                }
                baos.toByteArray()
            }

            // Always keep verified internal fallback copy
            internalZipFile.writeBytes(zipBytes)

            // Write to user-chosen persistent target file if configured
            val effectiveUri = targetUri ?: getPersistedBackupUri()
            if (effectiveUri != null) {
                appContext.contentResolver.openOutputStream(effectiveUri, "wt")?.use { out ->
                    out.write(zipBytes)
                    out.flush()
                } ?: throw IllegalStateException("Zieldatei konnte nicht zum Schreiben geöffnet werden.")
            }

            // Mandatory read-back & checksum verification
            val readBackJson = if (effectiveUri != null) {
                readVerifiedZipBackup(effectiveUri)
            } else {
                extractBackupJsonFromZipBytes(internalZipFile.readBytes())
            } ?: throw IllegalStateException("Rücklese-Prüfung der Sicherungsdatei fehlgeschlagen.")

            val readBackHash = sha256Hex(readBackJson.toByteArray(Charsets.UTF_8))
            if (readBackHash != sha256) {
                throw IllegalStateException("Prüfsummen-Abweichung beim Rücklesen der Sicherung.")
            }

            prefs.edit().putString(KEY_LAST_BACKUP_ISO, nowIso).apply()

            BackupResult(
                ok = true,
                isoTimestamp = nowIso,
                targetLabel = effectiveUri?.lastPathSegment ?: "hausgarten-backup.zip",
                verifiedBytes = zipBytes.size
            )
        } catch (e: Exception) {
            BackupResult(
                ok = false,
                isoTimestamp = Instant.now().toString(),
                targetLabel = "hausgarten-backup.zip",
                verifiedBytes = 0,
                error = e.message ?: "Fehler beim Schreiben der Sicherung"
            )
        }
    }

    fun readVerifiedZipBackup(sourceUri: Uri?): String? {
        return try {
            val rawBytes: ByteArray = when {
                sourceUri != null -> {
                    appContext.contentResolver.openInputStream(sourceUri)?.use { it.readBytes() }
                        ?: return null
                }
                getPersistedBackupUri() != null -> {
                    val uri = getPersistedBackupUri()!!
                    appContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                        ?: if (internalZipFile.exists()) internalZipFile.readBytes() else return null
                }
                internalZipFile.exists() -> internalZipFile.readBytes()
                else -> return null
            }

            val extracted = extractBackupJsonFromZipBytes(rawBytes)
                ?: rawBytes.toString(Charsets.UTF_8)

            JSONObject(extracted) // Ensure valid JSON object
            extracted
        } catch (_: Exception) {
            null
        }
    }

    private fun extractBackupJsonFromZipBytes(bytes: ByteArray): String? {
        if (bytes.size < 4 || bytes[0] != 'P'.code.toByte() || bytes[1] != 'K'.code.toByte()) {
            return null
        }
        ByteArrayInputStream(bytes).use { bais ->
            ZipInputStream(bais).use { zis ->
                var primaryJson: String? = null
                var fallbackJson: String? = null
                var entry = zis.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory && entry.name.endsWith(".json")) {
                        val content = zis.readBytes().toString(Charsets.UTF_8)
                        when (entry.name) {
                            "hausgarten_backup_v1.json" -> primaryJson = content
                            "gmail_config.json" -> {
                                runCatching {
                                    val gObj = JSONObject(content)
                                    val store = at.hafner.gruenraum.sync.SecureMcpCredentialStore(appContext)
                                    val current = store.loadCredentials()
                                    val restoredSender = gObj.optString("gmailSenderEmail", "").trim()
                                    val restoredPwd = gObj.optString("gmailAppPassword", "").trim()
                                    val restoredToken = gObj.optString("gmailOAuthToken", "").trim()
                                    if (restoredPwd.isNotEmpty() || restoredToken.isNotEmpty()) {
                                        store.saveGmailConfig(
                                            senderEmail = restoredSender.ifBlank { current.gmailSenderEmail },
                                            appPassword = if (restoredPwd.isNotEmpty()) restoredPwd else null,
                                            oauthToken = if (restoredToken.isNotEmpty()) restoredToken else null
                                        )
                                    }
                                }
                            }
                            "manifest.json" -> {}
                            else -> if (fallbackJson == null) fallbackJson = content
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
                return primaryJson ?: fallbackJson
            }
        }
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        private val STORE_LOCK = Any()
        private const val PREFS_NAME = "hafner_native_prefs"
        private const val KEY_BACKUP_URI = "persisted_backup_uri"
        private const val KEY_LAST_BACKUP_ISO = "last_backup_iso"
        private const val KEY_DATASET_ID = "infinity_dataset_id"
        private const val KEY_LOCAL_REVISION = "local_store_revision"
        private const val KEY_LOCAL_UPDATED_AT = "local_store_updated_at"
        private const val KEY_LOCAL_LAST_ACTOR = "local_store_last_actor"
        private const val KEY_LOCAL_LAST_SUMMARY = "local_store_last_summary"

        val COLLECTION_KEYS = listOf(
            "customers",
            "properties",
            "appointments",
            "workRecords",
            "invoices",
            "inquiries",
            "offers",
            "orders",
            "equipments",
            "materials",
            "expenses"
        )

        @Volatile
        private var lastWebViewLoadedRevision: Int = 0

        @Volatile
        private var cachedRawStateJson: String? = null

        @Volatile
        private var cachedLightStateJson: String? = null

        @Volatile
        private var cachedReceiptsJson: String? = null

        /**
         * Zero-Copy-Feldprojektion ohne Serialisierung von Base64-Medienstrings.
         */
        fun stripHeavyMediaFromRecordFast(item: JSONObject, includePhotos: Boolean): JSONObject {
            if (includePhotos) return JSONObject(item.toString())
            val out = JSONObject()
            val keys = item.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                when (key) {
                    "photos" -> {
                        val arr = item.optJSONArray("photos")
                        out.put("photo_count", arr?.length() ?: 0)
                    }
                    "photo" -> {
                        val singlePhoto = item.optString("photo", "")
                        if (singlePhoto.startsWith("data:")) {
                            out.put("has_photo", true)
                        } else if (!item.isNull("photo") && singlePhoto.isNotEmpty()) {
                            out.put("photo", singlePhoto)
                        }
                    }
                    "images" -> {
                        val imagesArr = item.optJSONArray("images")
                        if (imagesArr != null) {
                            out.put("image_count", imagesArr.length())
                            val strippedImages = JSONArray()
                            for (i in 0 until imagesArr.length()) {
                                val imgObj = imagesArr.optJSONObject(i)
                                if (imgObj == null) {
                                    strippedImages.put(imagesArr.opt(i))
                                    continue
                                }
                                val imgCopy = JSONObject()
                                val imgKeys = imgObj.keys()
                                while (imgKeys.hasNext()) {
                                    val ik = imgKeys.next()
                                    if (ik == "url" && imgObj.optString("url", "").startsWith("data:")) {
                                        imgCopy.put("has_data_url", true)
                                    } else {
                                        imgCopy.put(ik, imgObj.opt(ik))
                                    }
                                }
                                strippedImages.put(imgCopy)
                            }
                            out.put("images", strippedImages)
                        }
                    }
                    "documents" -> {
                        val docsArr = item.optJSONArray("documents")
                        if (docsArr != null) {
                            out.put("document_count", docsArr.length())
                            val strippedDocs = JSONArray()
                            for (i in 0 until docsArr.length()) {
                                val docObj = docsArr.optJSONObject(i)
                                if (docObj == null) {
                                    strippedDocs.put(docsArr.opt(i))
                                    continue
                                }
                                val docCopy = JSONObject()
                                val docKeys = docObj.keys()
                                while (docKeys.hasNext()) {
                                    val dk = docKeys.next()
                                    if (dk == "url" && docObj.optString("url", "").startsWith("data:")) {
                                        docCopy.put("has_data_url", true)
                                    } else {
                                        docCopy.put(dk, docObj.opt(dk))
                                    }
                                }
                                strippedDocs.put(docCopy)
                            }
                            out.put("documents", strippedDocs)
                        }
                    }
                    else -> out.put(key, item.opt(key))
                }
            }
            return out
        }

        private val tunnelMutationListeners =
            CopyOnWriteArraySet<(stateJson: String, revision: Int, summary: String) -> Unit>()
        private val staticLocalSaveListeners = CopyOnWriteArraySet<() -> Unit>()

        fun notifyWebViewSyncedRevision(revision: Int) {
            synchronized(STORE_LOCK) {
                if (revision > lastWebViewLoadedRevision) {
                    lastWebViewLoadedRevision = revision
                }
            }
        }

        fun registerTunnelMutationListener(
            listener: (stateJson: String, revision: Int, summary: String) -> Unit
        ) {
            tunnelMutationListeners.add(listener)
        }

        fun unregisterTunnelMutationListener(
            listener: (stateJson: String, revision: Int, summary: String) -> Unit
        ) {
            tunnelMutationListeners.remove(listener)
        }

        fun registerStaticLocalSaveListener(listener: () -> Unit) {
            staticLocalSaveListeners.add(listener)
        }

        fun unregisterStaticLocalSaveListener(listener: () -> Unit) {
            staticLocalSaveListeners.remove(listener)
        }

        private fun notifyTunnelMutationListeners(stateJson: String, revision: Int, summary: String) {
            for (listener in tunnelMutationListeners) {
                try {
                    listener(stateJson, revision, summary)
                } catch (_: Exception) {
                }
            }
        }

        private fun notifyStaticLocalSaveListeners() {
            for (listener in staticLocalSaveListeners) {
                try {
                    listener()
                } catch (_: Exception) {
                }
            }
        }
    }
}
