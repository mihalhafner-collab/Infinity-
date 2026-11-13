package at.hafner.gruenraum.tunnel

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.IBinder
import android.os.PowerManager
import at.hafner.gruenraum.storage.NativeStoreManager
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Sichtbarer und jederzeit vom Nutzer abschaltbarer Foreground-Service
 * für den direkten privaten OpenAI-Pixel-Tunnel (Infinity · ChatGPT).
 */
class PixelTunnelService : Service() {
    private val closing = AtomicBoolean()
    private var worker: Thread? = null
    @Volatile
    private var http: PixelTunnelWire.HttpTransport? = null
    private var manager: ConnectivityManager? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    @Volatile
    private var activeBinding = ""
    private val control =
        Executors.newSingleThreadExecutor { task ->
            Thread(task, "infinity-tunnel-control").apply { isDaemon = true }
        }

    override fun onCreate() {
        super.onCreate()
        val channel =
            NotificationChannel(CHANNEL, "Infinity · ChatGPT-Tunnel", NotificationManager.IMPORTANCE_LOW)
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
            channel
        )
        startForeground(NOTICE, notice("Verbindung startet"))
        running = true
        closing.set(false)
        manager = getSystemService(CONNECTIVITY_SERVICE) as ConnectivityManager
        callback =
            object : ConnectivityManager.NetworkCallback() {
                private var ready: Network? = null

                override fun onLost(network: Network) {
                    if (network == ready) ready = null
                    http?.close()
                }

                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                    if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) {
                        if (network != ready) ready = network
                    } else if (network == ready) ready = null
                }
            }
        try {
            manager?.registerDefaultNetworkCallback(callback!!)
        } catch (_: Exception) {
        }
        notifyStatusListeners(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) {
            closing.set(true)
            http?.close()
            worker?.interrupt()
            control.execute {
                try {
                    PixelTunnelConfig(this).enabled(false)
                } catch (_: RuntimeException) {
                } finally {
                    stopSelf(startId)
                }
            }
            return START_NOT_STICKY
        }
        if (worker?.isAlive != true) {
            worker = Thread(::runTunnel, "infinity-mcp-tunnel")
            worker!!.start()
        }
        return START_STICKY
    }

    private fun online(): Boolean {
        val current = manager ?: return false
        val network = current.activeNetwork ?: return false
        val caps = current.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) ||
            caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun runTunnel() {
        try {
            if (closing.get()) return
            val initial = PixelTunnelConfig(this)
            activeBinding = initial.bindingHash()
            if (!initial.enabled() || !initial.configured()) {
                updateStatus("not_configured", "Pixel-Verbindung einmalig einrichten.")
                return
            }
            val storeManager = NativeStoreManager(applicationContext)
            runTunnelLoop(storeManager)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } catch (_: Exception) {
            if (!closing.get()) {
                updateStatus("local_review_required", "Gespeicherten lokalen Datenstand prüfen.")
            }
        } finally {
            if (!closing.get()) stopSelf()
        }
    }

    private fun runTunnelLoop(storeManager: NativeStoreManager) {
        var failures = 0
        while (!closing.get()) {
            try {
                val config = PixelTunnelConfig(this)
                if (!config.enabled()) break
                val binding = config.bindingHash()
                activeBinding = binding
                if (!online()) {
                    updateStatus("offline", "Kein Internet. Verbindung wird automatisch erneut versucht.")
                    Thread.sleep(5000L)
                    continue
                }
                // Sicherstellen, dass der lokale Infinity-Datenbestand valide lesbar ist
                storeManager.loadOrInitStateObject()

                val transport = PixelTunnelWire.HttpTransport(config.secret(), config.organization())
                http = transport
                val initialWriteState = config.writeEnabled()
                val dispatcher = InfinityMcpDispatcher(
                    context = applicationContext,
                    storeManager = storeManager,
                    isWriteEnabled = { PixelTunnelConfig(this@PixelTunnelService).writeEnabled() }
                )
                val tunnel = PixelTunnelWire(config.id(), transport, dispatcher)
                updateStatus("connecting", "OpenAI-Tunnel wird geprüft.")
                tunnel.verify()
                failures = 0
                updateStatus(
                    "ready",
                    "Tunnel erreichbar · wartet auf Anfragen.",
                    contact = true,
                    response = false
                )
                while (!closing.get() && config.enabled() && config.bindingHash() == binding) {
                    if (config.writeEnabled() != initialWriteState) break
                    val delivered = tunnel.cycle()
                    updateStatus(
                        "ready",
                        if (delivered > 0) "Anfrageantwort an den Tunnel übergeben."
                        else "Tunnel erreichbar · wartet auf Anfragen.",
                        contact = true,
                        response = delivered > 0
                    )
                }
            } catch (limited: PixelTunnelWire.RateLimit) {
                failures = minOf(8, failures + 1)
                updateStatus(
                    "rate_limited",
                    "Tunnel-Anfragen vorübergehend begrenzt. Nach der Wartezeit wird erneut verbunden."
                )
                try {
                    Thread.sleep(maxOf(limited.retryAfterMs, minOf(60000L, 1000L shl failures)))
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            } catch (denied: PixelTunnelWire.AccessError) {
                updateStatus("auth_error", denied.userMessage())
                val current = PixelTunnelConfig(this)
                if (current.bindingHash() == activeBinding) {
                    current.enabled(false)
                }
                break
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            } catch (_: Exception) {
                failures++
                updateStatus(
                    "reconnecting",
                    "Verbindung oder lokalen Datenstand prüfen. Neuer Versuch folgt."
                )
                try {
                    Thread.sleep(minOf(60000L, 1000L shl minOf(failures, 6)))
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
            } finally {
                http?.close()
            }
        }
    }

    private fun notice(detail: String): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, PixelTunnelActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this,
            1,
            Intent(this, PixelTunnelService::class.java).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Infinity · ChatGPT")
            .setContentText(detail)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, "Beenden", stop).build())
            .build()
    }

    private fun updateStatus(
        state: String,
        detail: String,
        contact: Boolean = false,
        response: Boolean = false
    ) {
        val prefs = getSharedPreferences(PixelTunnelConfig.STATUS_PREFS, MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val edit = prefs.edit()
        if (prefs.getString("binding", "") != activeBinding) {
            edit.remove("last_contact_at").remove("last_response_at")
        }
        edit
            .putString("binding", activeBinding)
            .putString("state", state)
            .putString("detail", detail)
            .putLong("at", now)
        if (contact) edit.putLong("last_contact_at", now)
        if (response) edit.putLong("last_response_at", now)
        edit.apply()
        try {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).notify(
                NOTICE,
                notice(detail)
            )
        } catch (_: Exception) {
        }
        notifyStatusListeners(this)
    }

    override fun onDestroy() {
        closing.set(true)
        running = false
        http?.close()
        worker?.interrupt()
        val currentManager = manager
        val currentCallback = callback
        if (currentManager != null && currentCallback != null) {
            try {
                currentManager.unregisterNetworkCallback(currentCallback)
            } catch (_: Exception) {
            }
        }
        val appCtx = applicationContext
        control.execute {
            try {
                val prefs = appCtx.getSharedPreferences(PixelTunnelConfig.STATUS_PREFS, MODE_PRIVATE)
                if (
                    prefs.getString("binding", "") == activeBinding &&
                    prefs.getString("state", "") != "auth_error"
                ) {
                    prefs
                        .edit()
                        .putString("state", "stopped")
                        .putString("detail", "Verbindung beendet.")
                        .apply()
                }
            } catch (_: RuntimeException) {
            }
            notifyStatusListeners(appCtx)
        }
        control.shutdown()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val STOP = "at.hafner.gruenraum.PIXEL_TUNNEL_STOP"
        private const val CHANNEL = "infinity_pixel_tunnel"
        private const val NOTICE = 2815
        @Volatile
        private var running = false

        private val statusListeners = CopyOnWriteArraySet<(JSONObject) -> Unit>()

        fun registerStatusListener(listener: (JSONObject) -> Unit) {
            statusListeners.add(listener)
        }

        fun unregisterStatusListener(listener: (JSONObject) -> Unit) {
            statusListeners.remove(listener)
        }

        fun notifyStatusListeners(context: Context) {
            val current = status(context.applicationContext)
            for (listener in statusListeners) {
                try {
                    listener(current)
                } catch (_: Exception) {
                }
            }
        }

        @JvmStatic
        fun isServiceRunning(): Boolean = running

        @JvmStatic
        fun status(context: Context): JSONObject {
            val appCtx = context.applicationContext
            val result = JSONObject()
            val prefs = appCtx.getSharedPreferences(PixelTunnelConfig.STATUS_PREFS, MODE_PRIVATE)
            val power = appCtx.getSystemService(POWER_SERVICE) as PowerManager
            try {
                val config = PixelTunnelConfig(appCtx)
                val storeManager = NativeStoreManager(appCtx)
                val bound = prefs.getString("binding", "") == config.bindingHash()
                var state = if (bound) prefs.getString("state", "stopped") ?: "stopped" else "stopped"
                val preserve = state == "auth_error" || state == "start_blocked"
                if (!running && !preserve) state = "stopped"
                val contact = if (bound) prefs.getLong("last_contact_at", 0L) else 0L
                val response = if (bound) prefs.getLong("last_response_at", 0L) else 0L
                val stale =
                    running &&
                        state == "ready" &&
                        (contact == 0L || System.currentTimeMillis() - contact > 90000L)
                if (stale) state = "reconnecting"

                val detail = when {
                    stale -> "Verbindung länger nicht bestätigt. Wird erneut geprüft."
                    !running && !preserve -> "Pixel-Verbindung ist beendet."
                    bound -> prefs.getString("detail", "Verbindung noch nicht gestartet.") ?: "Verbindung noch nicht gestartet."
                    else -> "Für diese Verbindung liegt noch keine lokale Statusmeldung vor."
                }

                val transportConfirmed = config.enabled() && running && state == "ready" && !stale

                result
                    .put("running", running)
                    .put("state", state)
                    .put("detail", detail)
                    .put("battery_exempt", power.isIgnoringBatteryOptimizations(appCtx.packageName))
                    .put("configured", config.configured())
                    .put("enabled", config.enabled())
                    .put("write_enabled", config.writeEnabled())
                    .put("tunnel_id_masked", config.maskedId())
                    .put("organization", config.organization())
                    .put("last_contact_at", contact)
                    .put("last_response_at", response)
                    .put("transport_confirmed", transportConfirmed)
                    .put("local_revision", storeManager.getLocalRevision())
                    .put("dataset_id", storeManager.getDatasetId())

                result.put("label", pixelConnectionLabel(result))
            } catch (_: Exception) {
                result
                    .put("state", "status_unavailable")
                    .put("label", "Lokaler Status nicht lesbar")
                    .put("detail", "Lokaler Verbindungsstatus derzeit nicht lesbar.")
            }
            return result
        }
    }
}
