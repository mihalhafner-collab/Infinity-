package at.hafner.gruenraum.storage

import android.content.Context
import android.content.Intent
import android.net.Uri
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.time.Instant
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

class NativeStoreManager(private val context: Context) {

    private val prefs = context.getSharedPreferences("hafner_native_prefs", Context.MODE_PRIVATE)
    private val storeFile = File(context.filesDir, "hafner_app_store.json")
    private val storeBackupFile = File(context.filesDir, "hafner_app_store.json.bak")
    private val internalZipDir = File(context.filesDir, "backups").apply { mkdirs() }
    private val internalZipFile = File(internalZipDir, "hausgarten-backup.zip")

    var onLocalStateChanged: (() -> Unit)? = null

    fun loadAppState(): String? {
        return try {
            when {
                storeFile.exists() && storeFile.length() > 2 -> storeFile.readText(Charsets.UTF_8)
                storeBackupFile.exists() && storeBackupFile.length() > 2 -> storeBackupFile.readText(Charsets.UTF_8)
                else -> null
            }
        } catch (_: Exception) {
            null
        }
    }

    @Synchronized
    fun saveAppState(json: String): Boolean {
        val ok = writeAtomically(json)
        if (ok) {
            onLocalStateChanged?.invoke()
        }
        return ok
    }

    @Synchronized
    fun saveAppStateFromRemote(json: String): Boolean {
        return writeAtomically(json)
    }

    private fun writeAtomically(json: String): Boolean {
        return try {
            JSONObject(json) // Validate well-formed JSON before atomic swap
            val tmpFile = File(context.filesDir, "hafner_app_store.json.tmp")
            tmpFile.writeText(json, Charsets.UTF_8)
            if (storeFile.exists()) {
                storeFile.copyTo(storeBackupFile, overwrite = true)
            }
            if (!tmpFile.renameTo(storeFile)) {
                tmpFile.copyTo(storeFile, overwrite = true)
                tmpFile.delete()
            }
            true
        } catch (_: Exception) {
            false
        }
    }

    fun getPersistedBackupUri(): Uri? {
        val raw = prefs.getString(KEY_BACKUP_URI, null) ?: return null
        return try {
            val uri = Uri.parse(raw)
            val persisted = context.contentResolver.persistedUriPermissions.any {
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
            context.contentResolver.takePersistableUriPermission(uri, flags)
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
        obj.put("lastBackupDate", prefs.getString(KEY_LAST_BACKUP_ISO, JSONObject.NULL))
        obj.put("hasInternalBackup", internalZipFile.exists())
        return obj.toString()
    }

    fun writeVerifiedZipBackup(jsonPayload: String, targetUri: Uri?): BackupResult {
        return try {
            JSONObject(jsonPayload) // Validate JSON before writing
            val nowIso = Instant.now().toString()
            val payloadBytes = jsonPayload.toByteArray(Charsets.UTF_8)
            val sha256 = sha256Hex(payloadBytes)

            val manifestJson = JSONObject().apply {
                put("app", "Hafner Grünraum Handwerk")
                put("createdAt", nowIso)
                put("sha256", sha256)
                put("payloadBytes", payloadBytes.size)
            }.toString()

            val zipBytes = ByteArrayOutputStream().use { baos ->
                ZipOutputStream(baos).use { zos ->
                    zos.putNextEntry(ZipEntry("hausgarten_backup_v1.json"))
                    zos.write(payloadBytes)
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
                context.contentResolver.openOutputStream(effectiveUri, "wt")?.use { out ->
                    out.write(zipBytes)
                    out.flush()
                } ?: throw IllegalStateException("Zieldatei konnte nicht zum Schreiben geöffnet werden.")
            }

            // REQ-020..022: Mandatory read-back & checksum verification
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
                    context.contentResolver.openInputStream(sourceUri)?.use { it.readBytes() }
                        ?: return null
                }
                getPersistedBackupUri() != null -> {
                    val uri = getPersistedBackupUri()!!
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
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
                var fallbackJson: String? = null
                var entry = zis.nextEntry
                while (entry != null) {
                    if (!entry.isDirectory && entry.name.endsWith(".json")) {
                        val content = zis.readBytes().toString(Charsets.UTF_8)
                        if (entry.name == "hausgarten_backup_v1.json") {
                            return content
                        }
                        if (entry.name != "manifest.json" && fallbackJson == null) {
                            fallbackJson = content
                        }
                    }
                    zis.closeEntry()
                    entry = zis.nextEntry
                }
                return fallbackJson
            }
        }
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val KEY_BACKUP_URI = "persisted_backup_uri"
        private const val KEY_LAST_BACKUP_ISO = "last_backup_iso"
    }
}
