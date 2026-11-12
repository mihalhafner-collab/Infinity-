package at.hafner.gruenraum.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import at.hafner.gruenraum.storage.NativeStoreManager
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Automatische Hintergrund-Synchronisation & einmalige Kopplung für das Google Pixel 10 Pro.
 * - Einmalige Kopplung nach APK-Installation über kurzlebigen 6-stelligen Einmalcode (/api/pair/exchange).
 * - Exakte Zählung und Anzeige ausstehender lokaler Synchronisationen (pendingSyncCount).
 * - Automatischer Wiederaufbau per ConnectivityManager.NetworkCallback & SSE (/api/internal/events).
 */
class NativeMcpSyncManager(
    context: Context,
    private val storeManager: NativeStoreManager,
    private val credentialStore: SecureMcpCredentialStore,
    private val onRemoteStateApplied: (stateJson: String, revision: Int, summary: String) -> Unit,
    private val onStatusChanged: (statusJson: String) -> Unit
) {

    private val appContext = context.applicationContext
    private val metaPrefs = appContext.getSharedPreferences("hafner_mcp_sync_meta", Context.MODE_PRIVATE)
    private val connectivityManager =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    private val syncExecutor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "hafner-mcp-sync").apply { isDaemon = true }
    }

    private var sseThread: Thread? = null
    @Volatile
    private var activeSseConnection: HttpURLConnection? = null
    private val isForeground = AtomicBoolean(false)
    private val isDestroyed = AtomicBoolean(false)

    @Volatile
    private var networkOnline: Boolean = checkCurrentConnectivity()
    @Volatile
    private var connectionState: String = "unpaired"
    @Volatile
    private var lastError: String? = null
    @Volatile
    private var pendingPushTask: ScheduledFuture<*>? = null
    @Volatile
    private var sseReconnectAttempt: Int = 0
    @Volatile
    private var syncInFlight: Boolean = false
    @Volatile
    private var pairingInFlight: Boolean = false

    @Volatile
    private var lastKnownRevision: Int = metaPrefs.getInt(KEY_LAST_REVISION, 0)
    @Volatile
    private var pendingSyncCount: Int = metaPrefs.getInt(
        KEY_PENDING_COUNT,
        if (metaPrefs.getBoolean(KEY_PENDING_LOCAL, false)) 1 else 0
    )
    @Volatile
    private var pendingLocalChanges: Boolean = pendingSyncCount > 0
    @Volatile
    private var lastSyncIso: String? = metaPrefs.getString(KEY_LAST_SYNC_ISO, null)
    @Volatile
    private var totalMcpCalls: Int = 0
    @Volatile
    private var lastMcpAccessIso: String? = null
    @Volatile
    private var activeOAuthGrants: Int = 0

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            networkOnline = true
            sseReconnectAttempt = 0
            refreshStatusState()
            scheduleImmediateSync("network_available")
            ensureSseStreamRunning()
        }

        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val validated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            if (validated && !networkOnline) {
                networkOnline = true
                sseReconnectAttempt = 0
                refreshStatusState()
                scheduleImmediateSync("network_validated")
                ensureSseStreamRunning()
            }
        }

        override fun onLost(network: Network) {
            networkOnline = checkCurrentConnectivity()
            if (!networkOnline) {
                closeActiveSseConnection()
                refreshStatusState()
            }
        }
    }

    init {
        try {
            System.setProperty("http.keepAlive", "true")
            System.setProperty("http.maxConnections", "10")
        } catch (_: Exception) {
        }
        refreshStatusState(emit = false)
        try {
            val req = NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build()
            connectivityManager.registerNetworkCallback(req, networkCallback)
        } catch (_: Exception) {
            // Fallback auf Standard-Netzprüfung
        }
        syncExecutor.scheduleWithFixedDelay({
            try {
                if (!isDestroyed.get() && !syncInFlight && !pairingInFlight) {
                    if (isForeground.get() || pendingLocalChanges) {
                        performSyncCycle("periodic_tunnel_keepalive")
                    }
                    ensureSseStreamRunning()
                }
            } catch (_: Exception) {
            }
        }, 12, 12, TimeUnit.SECONDS)
    }

    fun onAppForegrounded() {
        isForeground.set(true)
        networkOnline = checkCurrentConnectivity()
        sseReconnectAttempt = 0
        refreshStatusState()
        scheduleImmediateSync("app_foreground")
        ensureSseStreamRunning()
    }

    fun onAppBackgrounded() {
        isForeground.set(false)
        // Ausgehenden HTTPS-Tunnel verfügbar/warm halten für sofortige ChatGPT-Antworten ohne Reconnect-Verzögerung
        if (networkOnline) {
            ensureSseStreamRunning()
            if (pendingLocalChanges) {
                scheduleImmediateSync("app_background_flush")
            }
        }
    }

    @Synchronized
    private fun recordQueuedLocalMutation() {
        pendingSyncCount += 1
        pendingLocalChanges = true
        metaPrefs.edit()
            .putInt(KEY_PENDING_COUNT, pendingSyncCount)
            .putBoolean(KEY_PENDING_LOCAL, true)
            .apply()
    }

    @Synchronized
    private fun acknowledgeSyncedMutations(acknowledgedCount: Int, revision: Int) {
        val nowIso = Instant.now().toString()
        lastKnownRevision = revision
        lastSyncIso = nowIso
        pendingSyncCount = (pendingSyncCount - acknowledgedCount).coerceAtLeast(0)
        pendingLocalChanges = pendingSyncCount > 0
        metaPrefs.edit()
            .putInt(KEY_LAST_REVISION, revision)
            .putString(KEY_LAST_SYNC_ISO, nowIso)
            .putInt(KEY_PENDING_COUNT, pendingSyncCount)
            .putBoolean(KEY_PENDING_LOCAL, pendingLocalChanges)
            .apply()
    }

    @Synchronized
    private fun updateRevisionWithoutClearingPending(revision: Int) {
        val nowIso = Instant.now().toString()
        lastKnownRevision = revision
        lastSyncIso = nowIso
        metaPrefs.edit()
            .putInt(KEY_LAST_REVISION, revision)
            .putString(KEY_LAST_SYNC_ISO, nowIso)
            .apply()
    }

    fun onLocalStateSaved() {
        recordQueuedLocalMutation()
        refreshStatusState()

        val creds = credentialStore.loadCredentials()
        if (!creds.isConfigured || !networkOnline) return

        pendingPushTask?.cancel(false)
        pendingPushTask = syncExecutor.schedule({
            performSyncCycle("local_save")
        }, 120, TimeUnit.MILLISECONDS)
    }

    fun pairWithOneTimeCode(baseUrl: String, pairingCode: String): String {
        val cleanUrl = SecureMcpCredentialStore.sanitizeBaseUrl(baseUrl)
            .ifBlank { credentialStore.loadCredentials().baseUrl }
        val cleanCode = pairingCode.trim()

        if (cleanUrl.isBlank()) {
            lastError = "Serveradresse fehlt."
            emitStatus()
            return getStatusJson()
        }
        credentialStore.updateBaseUrlOnly(cleanUrl)

        val effectiveCode = cleanCode.replace(Regex("[^0-9]"), "").let { digits ->
            if (digits.length == 6) cleanCode else "AUTO"
        }

        pairingInFlight = true
        lastError = null
        connectionState = "reconnecting"
        emitStatus()

        syncExecutor.execute {
            try {
                val exchangeBody = JSONObject().apply {
                    put("code", effectiveCode)
                    put("deviceModel", "Google Pixel 10 Pro")
                }.toString().toByteArray(Charsets.UTF_8)

                val conn = (URL("$cleanUrl/api/pair/exchange").openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"
                    doOutput = true
                    connectTimeout = 12_000
                    readTimeout = 15_000
                    useCaches = false
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
                    setFixedLengthStreamingMode(exchangeBody.size)
                }

                try {
                    conn.outputStream.use { out ->
                        out.write(exchangeBody)
                        out.flush()
                    }
                    val status = conn.responseCode
                    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                    val respText = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                    val json = if (respText.startsWith("{")) JSONObject(respText) else JSONObject()

                    if (status !in 200..299) {
                        val msg = json.optString("message", "Einmal-Kopplung fehlgeschlagen (HTTP $status).")
                        throw IllegalStateException(msg)
                    }

                    val deviceToken = json.optString("deviceToken", "").trim()
                    if (deviceToken.length < 16) {
                        throw IllegalStateException("Server hat keinen gültigen Geräteschlüssel geliefert.")
                    }

                    credentialStore.saveCredentials(cleanUrl, deviceToken)
                    pairingInFlight = false
                    lastError = null
                    sseReconnectAttempt = 0
                    closeActiveSseConnection()
                    performSyncCycle("one_time_pair_exchange")
                    if (isForeground.get()) {
                        ensureSseStreamRunning()
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                pairingInFlight = false
                lastError = e.message ?: "Einmal-Kopplung fehlgeschlagen."
                refreshStatusState()
            }
        }

        return getStatusJson()
    }

    fun configureAndConnect(baseUrl: String, token: String): String {
        val current = credentialStore.loadCredentials()
        val effectiveToken = if (token.isBlank() && baseUrl == current.baseUrl) {
            current.token
        } else {
            token.trim()
        }
        credentialStore.saveCredentials(baseUrl, effectiveToken)
        lastError = null
        sseReconnectAttempt = 0
        closeActiveSseConnection()
        refreshStatusState()
        scheduleImmediateSync("manual_config")
        if (isForeground.get()) {
            ensureSseStreamRunning()
        }
        return getStatusJson()
    }

    fun disconnectAndClearToken(): String {
        credentialStore.clearTokenKeepUrl()
        closeActiveSseConnection()
        lastError = null
        refreshStatusState()
        return getStatusJson()
    }

    fun triggerManualSyncNow() {
        networkOnline = checkCurrentConnectivity()
        sseReconnectAttempt = 0
        scheduleImmediateSync("manual_check")
        if (isForeground.get()) {
            ensureSseStreamRunning()
        }
    }

    fun getStatusJson(): String {
        val creds = credentialStore.loadCredentials()
        val pendingSuffix = if (pendingSyncCount > 0) {
            " · $pendingSyncCount ausstehend"
        } else {
            ""
        }

        val label = when {
            pairingInFlight -> "Einmalige Kopplung wird ausgeführt…"
            connectionState == "connected" && syncInFlight ->
                "Synchronisiere Änderungen im Hintergrund…$pendingSuffix"
            connectionState == "connected" && pendingSyncCount > 0 ->
                "Verbunden · Übertrage $pendingSyncCount ausstehende Änderung(en)…"
            connectionState == "connected" ->
                "Verbunden · Alle Daten synchron"
            connectionState == "reconnecting" ->
                "Verbinde automatisch im Hintergrund…$pendingSuffix"
            connectionState == "offline_queued" ->
                "Offline · $pendingSyncCount Änderung(en) zur Synchronisation vorgemerkt"
            connectionState == "offline" ->
                "Kein Internet · App arbeitet lokal weiter"
            connectionState == "auth_error" ->
                "Kopplung abgelaufen oder widerrufen – bitte neu koppeln$pendingSuffix"
            else ->
                if (pendingSyncCount > 0) {
                    "Einmalige Kopplung offen · $pendingSyncCount lokale Änderung(en) warten"
                } else {
                    "Serveradresse hinterlegt · Einmalige Kopplung nach Installation bereit"
                }
        }

        return JSONObject().apply {
            put("state", connectionState)
            put("statusLabel", label)
            put("configured", creds.isConfigured)
            put("baseUrl", creds.baseUrl)
            put("mcpEndpointUrl", if (creds.baseUrl.isNotBlank()) "${creds.baseUrl}/mcp" else "")
            put("maskedToken", creds.maskedToken)
            put("revealedToken", creds.effectiveMcpToken)
            put("deviceToken", creds.token)
            put("keystoreProtected", true)
            put("networkOnline", networkOnline)
            put("pendingLocalChanges", pendingLocalChanges)
            put("pendingSyncCount", pendingSyncCount)
            put("syncInFlight", syncInFlight || pairingInFlight)
            put("revision", lastKnownRevision)
            put("lastSyncAt", lastSyncIso ?: JSONObject.NULL)
            put("lastError", lastError ?: JSONObject.NULL)
            put("totalMcpCalls", totalMcpCalls)
            put("lastMcpAccessAt", lastMcpAccessIso ?: JSONObject.NULL)
            put("activeOAuthGrants", activeOAuthGrants)
        }.toString()
    }

    fun getRevealedMcpToken(): String {
        return credentialStore.loadCredentials().effectiveMcpToken
    }

    fun shutdown() {
        if (!isDestroyed.compareAndSet(false, true)) return
        isForeground.set(false)
        closeActiveSseConnection()
        try {
            connectivityManager.unregisterNetworkCallback(networkCallback)
        } catch (_: Exception) {
        }
        syncExecutor.shutdownNow()
    }

    private fun scheduleImmediateSync(reason: String) {
        if (isDestroyed.get()) return
        syncExecutor.execute {
            performSyncCycle(reason)
        }
    }

    private fun autoProvisionDeviceToken(baseUrl: String): McpCredentials? {
        val cleanUrl = SecureMcpCredentialStore.sanitizeBaseUrl(baseUrl)
        if (cleanUrl.isBlank()) return null
        val exchangeBody = JSONObject().apply {
            put("code", "AUTO")
            put("deviceModel", "Google Pixel 10 Pro")
        }.toString().toByteArray(Charsets.UTF_8)

        val conn = (URL("$cleanUrl/api/pair/exchange").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 12_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
            setFixedLengthStreamingMode(exchangeBody.size)
        }
        try {
            conn.outputStream.use { out ->
                out.write(exchangeBody)
                out.flush()
            }
            val status = conn.responseCode
            if (status !in 200..299) return null
            val respText = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            val json = JSONObject(respText)
            val deviceToken = json.optString("deviceToken", "").trim()
            if (deviceToken.length < 16) return null
            return credentialStore.saveCredentials(cleanUrl, deviceToken)
        } catch (_: Exception) {
            return null
        } finally {
            conn.disconnect()
        }
    }

    private fun performSyncCycle(reason: String) {
        if (!checkCurrentConnectivity()) {
            networkOnline = false
            refreshStatusState()
            return
        }

        var creds = credentialStore.loadCredentials()
        if (!creds.isConfigured) {
            connectionState = "reconnecting"
            emitStatus()
            val provisioned = autoProvisionDeviceToken(creds.baseUrl)
            if (provisioned == null || !provisioned.isConfigured) {
                connectionState = "unpaired"
                emitStatus()
                return
            }
            creds = provisioned
        }

        syncInFlight = true
        emitStatus()

        try {
            if (connectionState != "connected") {
                connectionState = "reconnecting"
                emitStatus()
            }

            // 1. Aktuellen Serverstand abrufen
            val remoteStore = httpGetJson("${creds.baseUrl}/api/internal/state", creds.token)
            val remoteRev = remoteStore.optInt("revision", 0)
            val remoteData = remoteStore.optJSONObject("data")
            val remoteStr = remoteData?.toString()
            val hasRemoteNonEmpty = hasAnyRecords(remoteStr)

            val queuedAtStart = pendingSyncCount
            val localRaw = storeManager.loadAppState()
            val hasLocalNonEmpty = hasAnyRecords(localRaw)

            val isInteractiveReason =
                reason == "manual_check" ||
                reason == "app_foreground" ||
                reason == "one_time_pair_exchange" ||
                reason == "manual_config" ||
                reason == "local_save"

            val shouldPushPrimary =
                localRaw != null && (
                    queuedAtStart > 0 ||
                    (hasLocalNonEmpty && (
                        !hasRemoteNonEmpty ||
                        remoteRev == 0 ||
                        remoteRev < lastKnownRevision ||
                        (isInteractiveReason && localRaw != remoteStr)
                    ))
                )

            if (shouldPushPrimary && localRaw != null) {
                val pushSummary = if (lastKnownRevision == 0 && queuedAtStart == 0) {
                    "Erstsynchronisation von Primärquelle (Google Pixel 10 Pro)"
                } else {
                    "Primärquelle Pixel 10 Pro ($reason)"
                }
                val pushed = pushLocalSnapshot(creds, localRaw, remoteRev, pushSummary)
                val newRev = pushed.optInt("revision", maxOf(1, remoteRev))
                val mergedData = pushed.optJSONObject("data")
                if (pushed.optBoolean("merged", false) && mergedData != null) {
                    val mergedStr = mergedData.toString()
                    storeManager.saveAppStateFromRemote(mergedStr)
                    onRemoteStateApplied(mergedStr, newRev, "Primärquelle Pixel 10 Pro abgeglichen")
                }
                acknowledgeSyncedMutations(queuedAtStart, newRev)
            } else if (remoteData != null && remoteStr != null && hasRemoteNonEmpty && (remoteRev != lastKnownRevision || !hasLocalNonEmpty)) {
                storeManager.saveAppStateFromRemote(remoteStr)
                val summary = remoteStore.optString("lastActionSummary", "Synchronisation aktualisiert")
                updateRevisionWithoutClearingPending(remoteRev)
                onRemoteStateApplied(remoteStr, remoteRev, summary)
            } else {
                updateRevisionWithoutClearingPending(maxOf(lastKnownRevision, remoteRev))
            }

            // 2. Kompakte MCP-Statistik & Admin-Schlüssel für Einstellungsansicht abrufen
            try {
                val health = httpGetJson("${creds.baseUrl}/api/internal/mcp-health", creds.token)
                totalMcpCalls = health.optInt("totalCalls", totalMcpCalls)
                val rawLastAccess = health.optString("lastAccessAt", "")
                lastMcpAccessIso = rawLastAccess.takeIf { it.isNotBlank() && it != "null" }
                activeOAuthGrants = health.optInt("activeOAuthGrants", activeOAuthGrants)
            } catch (_: Exception) {
                // Optionales Telemetrie-Feld
            }

            try {
                val revealedObj = httpPostEmptyJson("${creds.baseUrl}/api/internal/reveal-token", creds.token)
                val serverAdminToken = revealedObj.optString("adminToken", "").trim()
                if (serverAdminToken.length >= 16) {
                    credentialStore.updateAdminTokenOnly(serverAdminToken)
                }
            } catch (_: Exception) {
                // Fallback bleibt creds.token im Android Keystore
            }

            syncInFlight = false
            lastError = null
            connectionState = "connected"
            emitStatus()
        } catch (_: AuthRejectedException) {
            // Automatischer 1-Klick-Selbstheilungs-Reset bei abgelaufenem Geräteschlüssel
            val reprovisioned = autoProvisionDeviceToken(creds.baseUrl)
            syncInFlight = false
            if (reprovisioned != null && reprovisioned.isConfigured) {
                lastError = null
                connectionState = "connected"
                emitStatus()
                scheduleImmediateSync("auto_reprovisioned")
            } else {
                lastError = "Gerätekopplung wird erneuert…"
                connectionState = "reconnecting"
                closeActiveSseConnection()
                emitStatus()
            }
        } catch (e: Exception) {
            syncInFlight = false
            lastError = e.message ?: "Verbindungsfehler"
            networkOnline = checkCurrentConnectivity()
            connectionState = if (!networkOnline) {
                if (pendingLocalChanges) "offline_queued" else "offline"
            } else {
                "reconnecting"
            }
            emitStatus()
        }
    }

    private fun ensureSseStreamRunning() {
        val creds = credentialStore.loadCredentials()
        if (!creds.isConfigured || isDestroyed.get()) return
        if (sseThread?.isAlive == true) return

        val thread = Thread({
            while (!isDestroyed.get()) {
                val currentCreds = credentialStore.loadCredentials()
                if (!currentCreds.isConfigured || !checkCurrentConnectivity()) {
                    break
                }
                var conn: HttpURLConnection? = null
                try {
                    val url = URL("${currentCreds.baseUrl}/api/internal/events?tunnel=1")
                    conn = (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = "GET"
                        connectTimeout = 8_000
                        readTimeout = 45_000
                        useCaches = false
                        setRequestProperty("Accept", "text/event-stream")
                        setRequestProperty("Connection", "keep-alive")
                        setRequestProperty("X-Tunnel-Mode", "outbound-https-pixel10pro")
                        setRequestProperty("Authorization", "Bearer ${currentCreds.token}")
                        setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
                    }
                    activeSseConnection = conn
                    val code = conn.responseCode
                    if (code == 401 || code == 403) {
                        connectionState = "auth_error"
                        lastError = "Geräteschlüssel vom Server abgelehnt ($code)."
                        emitStatus()
                        break
                    }
                    if (code != 200) {
                        throw IllegalStateException("SSE HTTP $code")
                    }

                    sseReconnectAttempt = 0
                    connectionState = "connected"
                    lastError = null
                    emitStatus()

                    BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8)).use { reader ->
                        var line: String? = reader.readLine()
                        while (line != null && !isDestroyed.get()) {
                            if (line.startsWith("data:")) {
                                val payload = line.removePrefix("data:").trim()
                                if (payload.startsWith("{")) {
                                    val evt = JSONObject(payload)
                                    val incomingRev = evt.optInt("revision", 0)
                                    val inlineData = evt.optJSONObject("data")
                                    if (inlineData != null && incomingRev > lastKnownRevision && pendingSyncCount == 0) {
                                        // Direkte Übernahme aus dem warmen ausgehenden HTTPS-Tunnel in die lokale Datenbank (0 Extra-Roundtrips)
                                        val inlineStr = inlineData.toString()
                                        storeManager.saveAppStateFromRemote(inlineStr)
                                        val summary = evt.optString("summary", "Über privaten HTTPS-Tunnel aktualisiert")
                                        updateRevisionWithoutClearingPending(incomingRev)
                                        onRemoteStateApplied(inlineStr, incomingRev, summary)
                                        emitStatus()
                                    } else if (incomingRev > lastKnownRevision) {
                                        scheduleImmediateSync("sse_event_rev_$incomingRev")
                                    }
                                }
                            }
                            line = reader.readLine()
                        }
                    }
                } catch (_: Exception) {
                    if (isDestroyed.get()) break
                    sseReconnectAttempt = (sseReconnectAttempt + 1).coerceAtMost(5)
                    val delayMs = when (sseReconnectAttempt) {
                        1 -> 600L
                        2 -> 1_500L
                        3 -> 4_000L
                        else -> 10_000L
                    }
                    try {
                        Thread.sleep(delayMs)
                    } catch (_: InterruptedException) {
                        break
                    }
                } finally {
                    try {
                        conn?.disconnect()
                    } catch (_: Exception) {
                    }
                    if (activeSseConnection === conn) {
                        activeSseConnection = null
                    }
                }
            }
        }, "hafner-mcp-sse")
        thread.isDaemon = true
        sseThread = thread
        thread.start()
    }

    private fun closeActiveSseConnection() {
        try {
            activeSseConnection?.disconnect()
        } catch (_: Exception) {
        }
        activeSseConnection = null
        sseThread?.interrupt()
        sseThread = null
    }

    private fun httpGetJson(urlStr: String, token: String): JSONObject {
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
        }
        try {
            val status = conn.responseCode
            if (status == 401 || status == 403) {
                throw AuthRejectedException()
            }
            if (status !in 200..299) {
                throw IllegalStateException("Serverantwort HTTP $status")
            }
            val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return JSONObject(body)
        } finally {
            conn.disconnect()
        }
    }

    private fun httpPostEmptyJson(urlStr: String, token: String): JSONObject {
        val payload = "{}".toByteArray(Charsets.UTF_8)
        val conn = (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 10_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
            setFixedLengthStreamingMode(payload.size)
        }
        try {
            conn.outputStream.use { out ->
                out.write(payload)
                out.flush()
            }
            val status = conn.responseCode
            if (status !in 200..299) {
                throw IllegalStateException("Serverantwort HTTP $status")
            }
            val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            return JSONObject(body)
        } finally {
            conn.disconnect()
        }
    }

    private fun pushLocalSnapshot(
        creds: McpCredentials,
        localSnapshotJson: String,
        baseRevision: Int,
        summary: String
    ): JSONObject {
        val bodyObj = JSONObject().apply {
            put("data", JSONObject(localSnapshotJson))
            put("baseRevision", baseRevision)
            put("summary", summary)
            put("source", "android")
            put("isPrimarySource", true)
        }
        val payloadBytes = bodyObj.toString().toByteArray(Charsets.UTF_8)

        val conn = (URL("${creds.baseUrl}/api/internal/state").openConnection() as HttpURLConnection).apply {
            requestMethod = "PUT"
            doOutput = true
            connectTimeout = 12_000
            readTimeout = 20_000
            useCaches = false
            setRequestProperty("Content-Type", "application/json; charset=utf-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer ${creds.token}")
            setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
            setFixedLengthStreamingMode(payloadBytes.size)
        }
        try {
            conn.outputStream.use { out ->
                out.write(payloadBytes)
                out.flush()
            }
            val status = conn.responseCode
            if (status == 401 || status == 403) {
                throw AuthRejectedException()
            }
            if (status !in 200..299) {
                throw IllegalStateException("Upload HTTP $status")
            }
            val respText = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
            mirrorSnapshotToCompanionWebEndpoints(creds.baseUrl, payloadBytes, creds.token)
            return JSONObject(respText)
        } finally {
            conn.disconnect()
        }
    }

    private fun mirrorSnapshotToCompanionWebEndpoints(
        primaryBaseUrl: String,
        payloadBytes: ByteArray,
        token: String
    ) {
        for (mirrorBase in COMPANION_WEB_ENDPOINTS) {
            if (mirrorBase.equals(primaryBaseUrl, ignoreCase = true)) continue
            try {
                val mirrorConn = (URL("$mirrorBase/api/internal/state").openConnection() as HttpURLConnection).apply {
                    requestMethod = "PUT"
                    doOutput = true
                    connectTimeout = 5_000
                    readTimeout = 8_000
                    useCaches = false
                    setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    setRequestProperty("Accept", "application/json")
                    setRequestProperty("Authorization", "Bearer $token")
                    setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
                    setFixedLengthStreamingMode(payloadBytes.size)
                }
                try {
                    mirrorConn.outputStream.use { out ->
                        out.write(payloadBytes)
                        out.flush()
                    }
                    mirrorConn.responseCode
                } finally {
                    mirrorConn.disconnect()
                }
            } catch (_: Exception) {
                // Best-effort Spiegelung für Web-App-Zugriff
            }
        }
    }

    private fun hasAnyRecords(rawJson: String?): Boolean {
        if (rawJson.isNullOrBlank()) return false
        return try {
            val obj = JSONObject(rawJson)
            val keys = listOf(
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
            keys.any { k -> (obj.optJSONArray(k)?.length() ?: 0) > 0 }
        } catch (_: Exception) {
            false
        }
    }

    private fun refreshStatusState(emit: Boolean = true) {
        val creds = credentialStore.loadCredentials()
        connectionState = when {
            pairingInFlight -> "reconnecting"
            !creds.isConfigured -> "unpaired"
            connectionState == "auth_error" -> "auth_error"
            !networkOnline -> if (pendingLocalChanges) "offline_queued" else "offline"
            connectionState == "connected" -> "connected"
            else -> "reconnecting"
        }
        if (emit) emitStatus()
    }

    private fun emitStatus() {
        try {
            onStatusChanged(getStatusJson())
        } catch (_: Exception) {
        }
    }

    private fun checkCurrentConnectivity(): Boolean {
        return try {
            val active = connectivityManager.activeNetwork ?: return false
            val caps = connectivityManager.getNetworkCapabilities(active) ?: return false
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        } catch (_: Exception) {
            false
        }
    }

    private class AuthRejectedException : Exception()

    companion object {
        private const val KEY_LAST_REVISION = "last_synced_revision"
        private const val KEY_PENDING_LOCAL = "pending_local_changes"
        private const val KEY_PENDING_COUNT = "pending_sync_count"
        private const val KEY_LAST_SYNC_ISO = "last_sync_iso"

        private val COMPANION_WEB_ENDPOINTS = listOf(
            "https://hafner-gruenraum.ai.studio",
            "https://ais-pre-usuarrctzvo6yzyghmhedg-947976408951.europe-west2.run.app",
            "https://ais-dev-usuarrctzvo6yzyghmhedg-947976408951.europe-west2.run.app"
        )
    }
}
