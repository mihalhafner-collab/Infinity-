package at.hafner.gruenraum.sync

import android.content.Context
import at.hafner.gruenraum.storage.NativeStoreManager
import org.json.JSONObject

/**
 * Lokaler Status-Adapter (KISS / YAGNI):
 * Die Android Infinity App auf dem Pixel 10 Pro ist vollständig von der Web-App getrennt.
 * Es findet keinerlei Hintergrund-Synchronisation mit einem Web-App-Backend und kein
 * automatischer Token-Wechsel statt. Der direkte OpenAI-Pixel-Tunnel läuft eigenständig
 * über PixelTunnelService / InfinityMcpDispatcher.
 */
class NativeMcpSyncManager(
    context: Context,
    private val storeManager: NativeStoreManager,
    @Suppress("UNUSED_PARAMETER") private val credentialStore: SecureMcpCredentialStore,
    @Suppress("UNUSED_PARAMETER") private val onRemoteStateApplied: (stateJson: String, revision: Int, summary: String) -> Unit,
    private val onStatusChanged: (statusJson: String) -> Unit
) {

    init {
        // Alte Cloud-Kopplungsdaten bereinigen, damit niemals veraltete Tokens im Hintergrund aktiv werden
        try {
            credentialStore.clearCredentials()
            context.applicationContext
                .getSharedPreferences("hafner_mcp_sync_meta", Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
        } catch (_: Exception) {
        }
    }

    fun onAppForegrounded() {
        // Keine Web-App-Synchronisation
    }

    fun onAppBackgrounded() {
        // Keine Web-App-Synchronisation
    }

    fun onLocalStateSaved() {
        // Keine Web-App-Synchronisation
    }

    fun triggerManualSyncNow() {
        onStatusChanged(getStatusJson())
    }

    fun configureAndConnect(@Suppress("UNUSED_PARAMETER") baseUrlRaw: String, @Suppress("UNUSED_PARAMETER") tokenRaw: String): String {
        val status = getStatusJson()
        onStatusChanged(status)
        return status
    }

    fun pairWithOneTimeCode(@Suppress("UNUSED_PARAMETER") baseUrlRaw: String, @Suppress("UNUSED_PARAMETER") codeRaw: String): String {
        val status = getStatusJson()
        onStatusChanged(status)
        return status
    }

    fun disconnectAndClearToken(): String {
        val status = getStatusJson()
        onStatusChanged(status)
        return status
    }

    fun getRevealedMcpToken(): String = ""

    fun getStatusJson(): String {
        return JSONObject().apply {
            put("state", "unpaired")
            put("statusLabel", "Lokal auf Pixel 10 Pro (von Web-App getrennt)")
            put("configured", false)
            put("baseUrl", "")
            put("mcpEndpointUrl", "")
            put("maskedToken", "")
            put("revealedToken", "")
            put("deviceToken", "")
            put("keystoreProtected", true)
            put("networkOnline", true)
            put("pendingLocalChanges", false)
            put("pendingSyncCount", 0)
            put("syncInFlight", false)
            put("revision", storeManager.getLocalRevision())
            put("lastSyncAt", storeManager.getLocalUpdatedAt())
            put("lastError", JSONObject.NULL)
            put("totalMcpCalls", 0)
            put("lastMcpAccessAt", JSONObject.NULL)
            put("activeOAuthGrants", 0)
        }.toString()
    }

    fun shutdown() {
        // Nichts zu beenden
    }
}
