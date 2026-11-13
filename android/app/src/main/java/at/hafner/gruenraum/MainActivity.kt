package at.hafner.gruenraum

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import at.hafner.gruenraum.bridge.PixelNativeBridge
import at.hafner.gruenraum.calendar.NativeCalendarReader
import at.hafner.gruenraum.documents.NativeDocumentManager
import at.hafner.gruenraum.storage.NativeStoreManager
import at.hafner.gruenraum.sync.NativeMcpSyncManager
import at.hafner.gruenraum.sync.SecureMcpCredentialStore
import at.hafner.gruenraum.tunnel.PixelTunnelActivity
import at.hafner.gruenraum.tunnel.PixelTunnelConfig
import at.hafner.gruenraum.tunnel.PixelTunnelService
import android.os.Build
import org.json.JSONObject
import java.io.File

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var storeManager: NativeStoreManager
    private lateinit var documentManager: NativeDocumentManager
    private lateinit var calendarReader: NativeCalendarReader
    private lateinit var credentialStore: SecureMcpCredentialStore
    private lateinit var mcpSyncManager: NativeMcpSyncManager
    private lateinit var inAppBackCallback: OnBackPressedCallback

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraCaptureUri: Uri? = null

    private data class PendingDocSave(
        val requestId: String,
        val bytes: ByteArray
    )

    private data class PendingCalendarQuery(
        val requestId: String,
        val startDateIso: String,
        val endDateIso: String
    )

    private data class PendingBackupWrite(
        val requestId: String,
        val jsonPayload: String
    )

    private var pendingDocSave: PendingDocSave? = null
    private var pendingCalendarQuery: PendingCalendarQuery? = null
    private var pendingLocationRequestId: String? = null
    private var pendingWebGeoOrigin: String? = null
    private var pendingWebGeoCallback: GeolocationPermissions.Callback? = null
    private var pendingBackupWrite: PendingBackupWrite? = null
    private var pendingRestoreRequestId: String? = null

    private val tunnelMutationListener: (String, Int, String) -> Unit = { stateJson, revision, summary ->
        runOnUiThread {
            NativeStoreManager.notifyWebViewSyncedRevision(revision)
            dispatchRemoteMcpStateToWeb(stateJson, revision, summary)
        }
    }

    private val staticLocalSaveListener: () -> Unit = {
        if (::mcpSyncManager.isInitialized) {
            mcpSyncManager.onLocalStateSaved()
        }
    }

    private val pixelTunnelStatusListener: (JSONObject) -> Unit = { statusObj ->
        runOnUiThread {
            dispatchPixelTunnelStatusToWeb(statusObj.toString())
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        fileUploadCallback?.onReceiveValue(uris.toTypedArray())
        fileUploadCallback = null
    }

    private val takePictureLauncher = registerForActivityResult(
        ActivityResultContracts.TakePicture()
    ) { success ->
        val capturedUri = pendingCameraCaptureUri
        pendingCameraCaptureUri = null
        if (success && capturedUri != null) {
            fileUploadCallback?.onReceiveValue(arrayOf(capturedUri))
        } else {
            fileUploadCallback?.onReceiveValue(null)
        }
        fileUploadCallback = null
    }

    private val saveDocumentLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("*/*")
    ) { uri ->
        val pending = pendingDocSave
        pendingDocSave = null
        if (pending == null) return@registerForActivityResult

        if (uri == null) {
            dispatchNativeCallback(pending.requestId, false, "Speichern abgebrochen.")
            return@registerForActivityResult
        }

        Thread {
            try {
                contentResolver.openOutputStream(uri, "wt")?.use { out ->
                    out.write(pending.bytes)
                    out.flush()
                } ?: throw IllegalStateException("Ausgabedatei konnte nicht geöffnet werden.")
                val res = JSONObject().apply {
                    put("saved", true)
                    put("uri", uri.toString())
                }.toString()
                runOnUiThread { dispatchNativeCallback(pending.requestId, true, res) }
            } catch (e: Exception) {
                runOnUiThread {
                    dispatchNativeCallback(
                        pending.requestId,
                        false,
                        e.message ?: "Fehler beim Speichern."
                    )
                }
            }
        }.start()
    }

    private val createBackupTargetLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/zip")
    ) { uri ->
        val pending = pendingBackupWrite
        pendingBackupWrite = null
        if (pending == null) return@registerForActivityResult

        if (uri != null) {
            storeManager.savePersistedBackupUri(uri)
            executeBackupOnBackground(pending.requestId, pending.jsonPayload, uri)
        } else {
            // Fallback to verified internal device backup if user dismissed picker
            executeBackupOnBackground(pending.requestId, pending.jsonPayload, null)
        }
    }

    private val openBackupRestoreLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        val reqId = pendingRestoreRequestId
        pendingRestoreRequestId = null
        if (reqId == null) return@registerForActivityResult

        if (uri == null) {
            dispatchNativeCallback(reqId, false, "Auswahl abgebrochen.")
            return@registerForActivityResult
        }

        storeManager.savePersistedBackupUri(uri)
        Thread {
            val restoredJson = storeManager.readVerifiedZipBackup(uri)
            runOnUiThread {
                if (restoredJson != null) {
                    dispatchNativeCallback(reqId, true, restoredJson)
                } else {
                    dispatchNativeCallback(reqId, false, "Sicherungsdatei ungültig oder leer.")
                }
            }
        }.start()
    }

    private val calendarPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val pending = pendingCalendarQuery
        pendingCalendarQuery = null
        if (pending == null) return@registerForActivityResult

        if (!granted) {
            dispatchNativeCallback(
                pending.requestId,
                false,
                "Kalenderberechtigung auf dem Pixel 10 Pro nicht freigegeben."
            )
            return@registerForActivityResult
        }

        executeCalendarQueryOnBackground(pending)
    }

    private val locationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        val webCallback = pendingWebGeoCallback
        val webOrigin = pendingWebGeoOrigin
        pendingWebGeoCallback = null
        pendingWebGeoOrigin = null
        if (webCallback != null && webOrigin != null) {
            webCallback.invoke(webOrigin, granted, false)
        }

        val reqId = pendingLocationRequestId
        pendingLocationRequestId = null
        if (reqId == null) return@registerForActivityResult

        if (!granted) {
            dispatchNativeCallback(
                reqId,
                false,
                "PERMISSION_DENIED: Bitte Standortfreigabe am Pixel 10 Pro erlauben, um Live-Wetter zu laden."
            )
            return@registerForActivityResult
        }

        resolveNativeLocationAndDispatch(reqId)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Native Edge-to-Edge Window Configuration for Google Pixel 10 Pro
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.WHITE
        window.navigationBarColor = Color.WHITE
        WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        storeManager = NativeStoreManager(applicationContext)
        documentManager = NativeDocumentManager(applicationContext)
        calendarReader = NativeCalendarReader(applicationContext)
        credentialStore = SecureMcpCredentialStore(applicationContext)
        mcpSyncManager = NativeMcpSyncManager(
            context = applicationContext,
            storeManager = storeManager,
            credentialStore = credentialStore,
            onRemoteStateApplied = { stateJson, revision, summary ->
                runOnUiThread {
                    NativeStoreManager.notifyWebViewSyncedRevision(revision)
                    dispatchRemoteMcpStateToWeb(stateJson, revision, summary)
                }
            },
            onStatusChanged = { statusJson ->
                runOnUiThread {
                    dispatchMcpStatusToWeb(statusJson)
                }
            }
        )
        NativeStoreManager.registerTunnelMutationListener(tunnelMutationListener)
        NativeStoreManager.registerStaticLocalSaveListener(staticLocalSaveListener)
        PixelTunnelService.registerStatusListener(pixelTunnelStatusListener)

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#F8F9FA"))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
        }

        val rootContainer = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            addView(
                webView,
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            )
        }

        // Exakte automatische Ausrichtung auf dem Pixel 10 Pro (Statusleiste + Kamera-Cutout oben, Gestenbalken & Tastatur unten)
        ViewCompat.setOnApplyWindowInsetsListener(rootContainer) { view, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or
                    WindowInsetsCompat.Type.displayCutout() or
                    WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        setContentView(rootContainer)

        val rawAssetsHandler = WebViewAssetLoader.AssetsPathHandler(this)
        val assetLoader = WebViewAssetLoader.Builder()
            .setDomain("appassets.androidplatform.net")
            .addPathHandler("/") { path ->
                val cleanPath = path.trimStart('/')
                val targetAssetPath = if (cleanPath.isEmpty()) {
                    "www/index.html"
                } else {
                    "www/$cleanPath"
                }
                rawAssetsHandler.handle(targetAssetPath)
                    ?: if (!cleanPath.contains('.')) rawAssetsHandler.handle("www/index.html") else null
            }
            .build()

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = false
            allowContentAccess = true
            mediaPlaybackRequiresUserGesture = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            textZoom = 100
        }

        webView.addJavascriptInterface(
            PixelNativeBridge(this, storeManager, documentManager, mcpSyncManager),
            "HafnerNative"
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val uri = request.url ?: return false
                val host = uri.host?.lowercase() ?: ""
                val scheme = uri.scheme?.lowercase() ?: ""

                if (scheme == "https" && host == "appassets.androidplatform.net") {
                    return false
                }

                // Launch external links (Phone, WhatsApp, Google Maps, Mail, Browser) natively
                launchExternalUri(uri.toString())
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                if (origin == null || callback == null) return
                val hasLocPerm = ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                if (hasLocPerm) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingWebGeoOrigin = origin
                    pendingWebGeoCallback = callback
                    locationPermissionLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                val accept = fileChooserParams?.acceptTypes?.firstOrNull()
                    ?.takeIf { it.isNotBlank() } ?: "image/*"

                if (fileChooserParams?.isCaptureEnabled == true && accept.startsWith("image")) {
                    try {
                        val captureDir = File(cacheDir, "camera_captures").apply { mkdirs() }
                        val photoFile = File(captureDir, "foto_${System.currentTimeMillis()}.jpg")
                        val photoUri = FileProvider.getUriForFile(
                            this@MainActivity,
                            "${applicationContext.packageName}.fileprovider",
                            photoFile
                        )
                        pendingCameraCaptureUri = photoUri
                        takePictureLauncher.launch(photoUri)
                        return true
                    } catch (_: Exception) {
                        pendingCameraCaptureUri = null
                    }
                }

                return try {
                    fileChooserLauncher.launch(accept)
                    true
                } catch (_: Exception) {
                    fileUploadCallback = null
                    false
                }
            }
        }

        // Pixel 10 Pro Predictive Back & Edge-Swipe:
        // Callback ist nur aktiv, solange innerhalb der App ein Zurück-Ziel existiert.
        // Auf der Startansicht ("Heute" ohne offene Dialoge) übernimmt Android 16 nativ Predictive Back zum Launcher.
        inAppBackCallback = object : OnBackPressedCallback(false) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(typeof window.__hafnerNativeBack === 'function' ? window.__hafnerNativeBack() : false)"
                ) { result ->
                    if (result != "true") {
                        isEnabled = false
                        moveTaskToBack(true)
                    }
                }
            }
        }
        onBackPressedDispatcher.addCallback(this, inAppBackCallback)

        handleIncomingPairingIntent(intent)
        webView.loadUrl("https://appassets.androidplatform.net/")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingPairingIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        if (::mcpSyncManager.isInitialized) {
            mcpSyncManager.onAppForegrounded()
        }
        resumePixelTunnelIfEnabled()
        dispatchPixelTunnelStatusToWeb(PixelTunnelService.status(this).toString())
    }

    override fun onStop() {
        if (::mcpSyncManager.isInitialized) {
            mcpSyncManager.onAppBackgrounded()
        }
        super.onStop()
    }

    private fun handleIncomingPairingIntent(incoming: Intent?) {
        val uri = incoming?.data ?: return
        if (uri.scheme?.lowercase() == "hafnermcp" && uri.host?.lowercase() == "pair") {
            val pairUrl = uri.getQueryParameter("url").orEmpty()
            val pairCode = uri.getQueryParameter("code").orEmpty()
            if (pairCode.isNotBlank()) {
                mcpSyncManager.pairWithOneTimeCode(pairUrl, pairCode)
            }
            // Bereinige Einmal-Kopplungscode sofort aus dem Activity-Intent im Arbeitsspeicher
            incoming.data = null
        }
    }

    fun updateCanGoBackInApp(canGoBack: Boolean) {
        if (::inAppBackCallback.isInitialized) {
            inAppBackCallback.isEnabled = canGoBack
        }
    }

    fun requestSaveDocumentToDevice(
        requestId: String,
        base64Data: String,
        filename: String,
        mimeType: String
    ) {
        try {
            val bytes = documentManager.decodeBase64(base64Data)
            pendingDocSave = PendingDocSave(requestId, bytes)
            val safeName = filename.ifBlank {
                if (mimeType.contains("pdf")) "Rechnung.pdf" else "Export.dat"
            }
            saveDocumentLauncher.launch(safeName)
        } catch (e: Exception) {
            dispatchNativeCallback(requestId, false, e.message ?: " Ungültige Dateidaten.")
        }
    }

    fun requestCalendarEvents(requestId: String, startDateIso: String, endDateIso: String) {
        val query = PendingCalendarQuery(requestId, startDateIso, endDateIso)
        val hasPerm = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALENDAR
        ) == PackageManager.PERMISSION_GRANTED

        if (hasPerm) {
            executeCalendarQueryOnBackground(query)
        } else {
            pendingCalendarQuery = query
            calendarPermissionLauncher.launch(Manifest.permission.READ_CALENDAR)
        }
    }

    private fun executeCalendarQueryOnBackground(query: PendingCalendarQuery) {
        Thread {
            try {
                val json = calendarReader.queryEventsJson(query.startDateIso, query.endDateIso)
                runOnUiThread { dispatchNativeCallback(query.requestId, true, json) }
            } catch (e: Exception) {
                runOnUiThread {
                    dispatchNativeCallback(
                        query.requestId,
                        false,
                        e.message ?: "Kalenderabfrage fehlgeschlagen."
                    )
                }
            }
        }.start()
    }

    fun requestDeviceLocation(requestId: String) {
        val hasPerm = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (hasPerm) {
            resolveNativeLocationAndDispatch(requestId)
        } else {
            pendingLocationRequestId = requestId
            locationPermissionLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        }
    }

    @SuppressLint("MissingPermission")
    private fun resolveNativeLocationAndDispatch(requestId: String) {
        try {
            val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
            val nowMs = System.currentTimeMillis()
            val maxAgeMs = 30L * 60L * 1000L

            val providers = listOf(
                LocationManager.FUSED_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.GPS_PROVIDER
            )

            var bestRecent: Location? = null
            for (provider in providers) {
                val loc = runCatching { lm.getLastKnownLocation(provider) }.getOrNull() ?: continue
                if (nowMs - loc.time <= maxAgeMs) {
                    if (bestRecent == null || loc.time > bestRecent.time) {
                        bestRecent = loc
                    }
                }
            }

            if (bestRecent != null) {
                val payload = JSONObject().apply {
                    put("latitude", bestRecent.latitude)
                    put("longitude", bestRecent.longitude)
                }.toString()
                dispatchNativeCallback(requestId, true, payload)
                return
            }

            val activeProvider = providers.firstOrNull { p ->
                runCatching { lm.isProviderEnabled(p) }.getOrDefault(false)
            }
            if (activeProvider == null) {
                dispatchNativeCallback(
                    requestId,
                    false,
                    "Standortdienst auf dem Pixel 10 Pro ist deaktiviert."
                )
                return
            }

            val cancelSignal = CancellationSignal()
            var completed = false
            window.decorView.postDelayed({
                if (!completed) {
                    completed = true
                    cancelSignal.cancel()
                    val fallback = providers.firstNotNullOfOrNull { p ->
                        runCatching { lm.getLastKnownLocation(p) }.getOrNull()
                    }
                    if (fallback != null) {
                        val payload = JSONObject().apply {
                            put("latitude", fallback.latitude)
                            put("longitude", fallback.longitude)
                        }.toString()
                        dispatchNativeCallback(requestId, true, payload)
                    } else {
                        dispatchNativeCallback(
                            requestId,
                            false,
                            "Smartphone-Standort konnte nicht rechtzeitig ermittelt werden."
                        )
                    }
                }
            }, 8000L)

            lm.getCurrentLocation(activeProvider, cancelSignal, mainExecutor) { loc ->
                if (completed) return@getCurrentLocation
                completed = true
                if (loc != null) {
                    val payload = JSONObject().apply {
                        put("latitude", loc.latitude)
                        put("longitude", loc.longitude)
                    }.toString()
                    dispatchNativeCallback(requestId, true, payload)
                } else {
                    dispatchNativeCallback(
                        requestId,
                        false,
                        "Kein aktueller Smartphone-Standort verfügbar."
                    )
                }
            }
        } catch (e: Exception) {
            dispatchNativeCallback(
                requestId,
                false,
                e.message ?: "Standortabfrage fehlgeschlagen."
            )
        }
    }

    fun requestVerifiedZipBackup(
        requestId: String,
        jsonPayload: String,
        forcePickTarget: Boolean
    ) {
        val persistedUri = storeManager.getPersistedBackupUri()
        if (forcePickTarget || persistedUri == null) {
            pendingBackupWrite = PendingBackupWrite(requestId, jsonPayload)
            createBackupTargetLauncher.launch("hausgarten-backup.zip")
        } else {
            executeBackupOnBackground(requestId, jsonPayload, persistedUri)
        }
    }

    private fun executeBackupOnBackground(
        requestId: String,
        jsonPayload: String,
        targetUri: Uri?
    ) {
        Thread {
            val result = storeManager.writeVerifiedZipBackup(jsonPayload, targetUri)
            runOnUiThread {
                if (result.ok) {
                    val resJson = JSONObject().apply {
                        put("ok", true)
                        put("isoTimestamp", result.isoTimestamp)
                        put("targetLabel", result.targetLabel)
                        put("verifiedBytes", result.verifiedBytes)
                    }.toString()
                    dispatchNativeCallback(requestId, true, resJson)
                } else {
                    dispatchNativeCallback(
                        requestId,
                        false,
                        result.error ?: "Sicherung fehlgeschlagen."
                    )
                }
            }
        }.start()
    }

    fun requestRestoreVerifiedZipBackup(requestId: String, pickExternalFile: Boolean) {
        if (pickExternalFile) {
            pendingRestoreRequestId = requestId
            openBackupRestoreLauncher.launch(
                arrayOf("application/zip", "application/octet-stream", "application/json", "*/*")
            )
            return
        }

        Thread {
            val restored = storeManager.readVerifiedZipBackup(null)
            runOnUiThread {
                if (restored != null) {
                    dispatchNativeCallback(requestId, true, restored)
                } else {
                    // If no stored backup exists yet, open picker so user can select hausgarten-backup.zip
                    pendingRestoreRequestId = requestId
                    openBackupRestoreLauncher.launch(
                        arrayOf("application/zip", "application/octet-stream", "application/json", "*/*")
                    )
                }
            }
        }.start()
    }

    fun launchExternalUri(rawUrl: String) {
        try {
            val uri = Uri.parse(rawUrl)
            val scheme = uri.scheme?.lowercase() ?: ""
            val intent = when (scheme) {
                "tel" -> Intent(Intent.ACTION_DIAL, uri)
                "mailto", "sms", "smsto" -> Intent(Intent.ACTION_SENDTO, uri)
                else -> Intent(Intent.ACTION_VIEW, uri)
            }
            startActivity(intent)
        } catch (_: Exception) {
            // Ignore malformed external URI
        }
    }

    fun dispatchNativeCallback(requestId: String, ok: Boolean, payloadOrError: String) {
        val safeReq = JSONObject.quote(requestId)
        val safeData = JSONObject.quote(payloadOrError)
        val js = "window.__onHafnerNativeCallback && window.__onHafnerNativeCallback($safeReq, $ok, $safeData);"
        webView.evaluateJavascript(js, null)
    }

    private fun dispatchRemoteMcpStateToWeb(stateJson: String, revision: Int, summary: String) {
        if (!::webView.isInitialized) return
        val safeJson = JSONObject.quote(stateJson)
        val safeSummary = JSONObject.quote(summary)
        val js =
            "window.__onHafnerNativeRemoteState && window.__onHafnerNativeRemoteState($safeJson, $revision, $safeSummary);"
        webView.evaluateJavascript(js, null)
    }

    private fun dispatchMcpStatusToWeb(statusJson: String) {
        if (!::webView.isInitialized) return
        val safeJson = JSONObject.quote(statusJson)
        val js = "window.__onHafnerNativeMcpStatus && window.__onHafnerNativeMcpStatus($safeJson);"
        webView.evaluateJavascript(js, null)
    }

    private fun dispatchPixelTunnelStatusToWeb(statusJson: String) {
        if (!::webView.isInitialized) return
        val safeJson = JSONObject.quote(statusJson)
        val js = "window.__onHafnerNativePixelTunnelStatus && window.__onHafnerNativePixelTunnelStatus($safeJson);"
        webView.evaluateJavascript(js, null)
    }

    private fun resumePixelTunnelIfEnabled() {
        try {
            val tunnelCfg = PixelTunnelConfig(this)
            if (tunnelCfg.enabled() && tunnelCfg.configured() && !PixelTunnelService.isServiceRunning()) {
                val hasNotifPerm = if (Build.VERSION.SDK_INT >= 33) {
                    ContextCompat.checkSelfPermission(
                        this,
                        Manifest.permission.POST_NOTIFICATIONS
                    ) == PackageManager.PERMISSION_GRANTED
                } else {
                    true
                }
                if (hasNotifPerm) {
                    startForegroundService(Intent(this, PixelTunnelService::class.java))
                }
            }
        } catch (_: Exception) {
        }
    }

    fun openPixelTunnelSetupActivity() {
        try {
            startActivity(Intent(this, PixelTunnelActivity::class.java))
        } catch (_: Exception) {
        }
    }

    fun setPixelTunnelEnabledFromWeb(enable: Boolean): String {
        try {
            val cfg = PixelTunnelConfig(this)
            if (!enable) {
                cfg.enabled(false)
                stopService(Intent(this, PixelTunnelService::class.java))
                PixelTunnelService.notifyStatusListeners(this)
                return PixelTunnelService.status(this).toString()
            }
            if (!cfg.configured()) {
                openPixelTunnelSetupActivity()
                return PixelTunnelService.status(this).toString()
            }
            if (
                Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
            ) {
                openPixelTunnelSetupActivity()
                return PixelTunnelService.status(this).toString()
            }
            cfg.enabled(true)
            startForegroundService(Intent(this, PixelTunnelService::class.java))
            PixelTunnelService.notifyStatusListeners(this)
        } catch (_: Exception) {
        }
        return PixelTunnelService.status(this).toString()
    }

    fun setPixelTunnelWriteEnabledFromWeb(writeEnable: Boolean): String {
        try {
            val cfg = PixelTunnelConfig(this)
            if (cfg.writeEnabled() != writeEnable) {
                cfg.writeEnabled(writeEnable)
                if (cfg.enabled() && cfg.configured() && PixelTunnelService.isServiceRunning()) {
                    stopService(Intent(this, PixelTunnelService::class.java))
                    startForegroundService(Intent(this, PixelTunnelService::class.java))
                }
                PixelTunnelService.notifyStatusListeners(this)
            }
        } catch (_: Exception) {
        }
        return PixelTunnelService.status(this).toString()
    }

    override fun onDestroy() {
        NativeStoreManager.unregisterTunnelMutationListener(tunnelMutationListener)
        NativeStoreManager.unregisterStaticLocalSaveListener(staticLocalSaveListener)
        PixelTunnelService.unregisterStatusListener(pixelTunnelStatusListener)
        if (::mcpSyncManager.isInitialized) {
            mcpSyncManager.shutdown()
        }
        webView.destroy()
        super.onDestroy()
    }
}
