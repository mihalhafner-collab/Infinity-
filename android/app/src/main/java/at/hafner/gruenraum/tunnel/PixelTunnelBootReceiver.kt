package at.hafner.gruenraum.tunnel

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import java.util.concurrent.Executors

/**
 * Automatischer Wiederanlauf des direkten OpenAI-Pixel-Tunnels nach
 * Geräteneustart (BOOT_COMPLETED) oder App-Update (MY_PACKAGE_REPLACED),
 * sofern der Tunnel eingerichtet und vom Nutzer eingeschaltet wurde.
 */
class PixelTunnelBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (
            intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        val pending = goAsync()
        val appCtx = context.applicationContext
        executor.execute {
            try {
                val config = PixelTunnelConfig(appCtx)
                if (!config.enabled() || !config.configured()) return@execute
                try {
                    appCtx.startForegroundService(Intent(appCtx, PixelTunnelService::class.java))
                } catch (_: RuntimeException) {
                    appCtx
                        .getSharedPreferences(PixelTunnelConfig.STATUS_PREFS, Context.MODE_PRIVATE)
                        .edit()
                        .putString("binding", config.bindingHash())
                        .putString("state", "start_blocked")
                        .putString(
                            "detail",
                            "Android hat den Start eingeschränkt. Bitte Verbindung in der App starten."
                        )
                        .apply()
                    PixelTunnelService.notifyStatusListeners(appCtx)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private val executor =
            Executors.newSingleThreadExecutor { task ->
                Thread(task, "infinity-tunnel-boot").apply { isDaemon = true }
            }
    }
}
