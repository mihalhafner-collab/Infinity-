package at.hafner.gruenraum

import android.Manifest
import android.annotation.SuppressLint
import android.app.Dialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
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
import at.hafner.gruenraum.documents.NativeMailSender
import at.hafner.gruenraum.storage.NativeStoreManager
import at.hafner.gruenraum.sync.McpCredentials
import at.hafner.gruenraum.sync.SecureMcpCredentialStore
import at.hafner.gruenraum.tunnel.PixelTunnelActivity
import at.hafner.gruenraum.tunnel.PixelTunnelConfig
import at.hafner.gruenraum.tunnel.PixelTunnelService
import android.os.Build
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URLDecoder

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var storeManager: NativeStoreManager
    private lateinit var documentManager: NativeDocumentManager
    private lateinit var mailSender: NativeMailSender
    private lateinit var calendarReader: NativeCalendarReader
    private lateinit var credentialStore: SecureMcpCredentialStore
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

    private data class PendingCalendarWrite(
        val requestId: String,
        val payloadJson: String,
        val isDelete: Boolean
    )

    private data class PendingBackupWrite(
        val requestId: String,
        val jsonPayload: String
    )

    private var pendingDocSave: PendingDocSave? = null
    private var pendingCalendarQuery: PendingCalendarQuery? = null
    private var pendingCalendarWrite: PendingCalendarWrite? = null
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
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val readGranted = permissions[Manifest.permission.READ_CALENDAR] == true ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALENDAR) == PackageManager.PERMISSION_GRANTED
        val writeGranted = permissions[Manifest.permission.WRITE_CALENDAR] == true ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_CALENDAR) == PackageManager.PERMISSION_GRANTED

        val pendingQuery = pendingCalendarQuery
        pendingCalendarQuery = null
        if (pendingQuery != null) {
            if (!readGranted) {
                dispatchNativeCallback(
                    pendingQuery.requestId,
                    false,
                    "Kalenderberechtigung auf dem Pixel 10 Pro nicht freigegeben."
                )
            } else {
                executeCalendarQueryOnBackground(pendingQuery)
            }
        }

        val pendingWrite = pendingCalendarWrite
        pendingCalendarWrite = null
        if (pendingWrite != null) {
            if (!readGranted || !writeGranted) {
                dispatchNativeCallback(
                    pendingWrite.requestId,
                    false,
                    "Kalender-Schreibberechtigung auf dem Pixel 10 Pro nicht freigegeben."
                )
            } else {
                executeCalendarWriteOnBackground(pendingWrite)
            }
        }
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
        activeInstance = java.lang.ref.WeakReference(this)

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
        mailSender = NativeMailSender(applicationContext)
        calendarReader = NativeCalendarReader(applicationContext)
        credentialStore = SecureMcpCredentialStore(applicationContext)
        NativeStoreManager.registerTunnelMutationListener(tunnelMutationListener)
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
            PixelNativeBridge(this, storeManager, documentManager),
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

        webView.loadUrl("https://appassets.androidplatform.net/")
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        resumePixelTunnelIfEnabled()
        dispatchPixelTunnelStatusToWeb(PixelTunnelService.status(this).toString())
    }

    override fun onStop() {
        super.onStop()
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

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && ::credentialStore.isInitialized) {
            val creds = credentialStore.loadCredentials()
            if (creds.effectiveGmailAppPassword.length < 8) {
                val detected = extractGoogleAppPasswordFromClipboard()
                if (detected.length == 16) {
                    credentialStore.saveGmailConfig(
                        senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" },
                        appPassword = detected
                    )
                    dispatchGmailConfigUpdatedToWeb(getNativeGmailConfigJson(), autoDetected = true)
                }
            }
        }
    }

    fun extractGoogleAppPasswordFromClipboard(): String {
        return try {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
            val raw = cm?.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()?.trim().orEmpty()
            if (raw.isEmpty()) return ""
            // Google App-Passwörter bestehen aus 16 Buchstaben (oft als "abcd efgh ijkl mnop" kopiert)
            val groupedRegex = Regex("(?i)\\b([a-z]{4})\\s+([a-z]{4})\\s+([a-z]{4})\\s+([a-z]{4})\\b")
            val groupedMatch = groupedRegex.find(raw)
            if (groupedMatch != null) {
                return (groupedMatch.groupValues[1] +
                    groupedMatch.groupValues[2] +
                    groupedMatch.groupValues[3] +
                    groupedMatch.groupValues[4]).lowercase()
            }
            val compact = raw.replace("\\s+".toRegex(), "")
            if (compact.length == 16 && compact.all { it in 'a'..'z' || it in 'A'..'Z' }) {
                return compact.lowercase()
            }
            ""
        } catch (_: Exception) {
            ""
        }
    }

    fun pasteAndSaveGmailAppPasswordFromClipboard(senderEmail: String): String {
        val detected = extractGoogleAppPasswordFromClipboard()
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? android.content.ClipboardManager
        val fallbackRaw = cm?.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString()
            ?.replace("\\s+".toRegex(), "")
            .orEmpty()
        val candidate = if (detected.length == 16) detected else fallbackRaw
        if (candidate.length >= 8 && !candidate.contains("@") && !candidate.startsWith("http")) {
            credentialStore.saveGmailConfig(
                senderEmail = senderEmail.trim().ifBlank { "mihalhafner@gmail.com" },
                appPassword = candidate
            )
        }
        val json = getNativeGmailConfigJson()
        dispatchGmailConfigUpdatedToWeb(json, autoDetected = candidate.length >= 8)
        return json
    }

    fun getNativeGmailConfigJson(): String {
        val creds = credentialStore.loadCredentials()
        return JSONObject().apply {
            put("senderEmail", creds.gmailSenderEmail)
            put("hasAppPassword", creds.effectiveGmailAppPassword.length >= 8)
            put("hasOAuthToken", creds.gmailOAuthToken.isNotBlank())
        }.toString()
    }

    fun saveNativeGmailAppPassword(senderEmail: String, appPassword: String): String {
        credentialStore.saveGmailConfig(
            senderEmail = senderEmail.trim().ifBlank { "mihalhafner@gmail.com" },
            appPassword = appPassword.replace("\\s+".toRegex(), "")
        )
        val json = getNativeGmailConfigJson()
        dispatchGmailConfigUpdatedToWeb(json, autoDetected = false)
        return json
    }

    private fun dispatchGmailConfigUpdatedToWeb(configJson: String, autoDetected: Boolean) {
        if (!::webView.isInitialized) return
        val safeJson = JSONObject.quote(configJson)
        val js =
            "window.__onHafnerNativeGmailConfigUpdated && window.__onHafnerNativeGmailConfigUpdated($safeJson, $autoDetected);"
        webView.evaluateJavascript(js, null)
    }

    fun showNativeMailSentNotification(recipientEmail: String, invoiceNumber: String) {
        mailSender.showMailSentNotification(recipientEmail, invoiceNumber)
    }

    fun disconnectNativeGmail(): String {
        credentialStore.saveGmailConfig("mihalhafner@gmail.com", "", "")
        val json = getNativeGmailConfigJson()
        dispatchGmailConfigUpdatedToWeb(json, autoDetected = false)
        return json
    }

    private fun buildCleanChromeUserAgent(defaultUa: String?): String {
        val raw = defaultUa.orEmpty()
        val cleaned = raw
            .replace("; wv)", ")")
            .replace(" wv ", " ")
            .replace(Regex("Version/\\d+\\.\\d+\\s*"), "")
            .trim()
        return cleaned.ifBlank {
            "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
        }
    }

    private fun extractOAuthParam(fragmentOrQuery: String, key: String): String {
        val cleaned = fragmentOrQuery.trim().trimStart('#', '?')
        if (cleaned.isEmpty()) return ""
        for (pair in cleaned.split("&")) {
            val idx = pair.indexOf('=')
            if (idx > 0) {
                val k = pair.substring(0, idx)
                if (k == key) {
                    return runCatching {
                        URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
                    }.getOrDefault(pair.substring(idx + 1)).trim()
                }
            }
        }
        return ""
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun requestNativeGoogleSignIn(
        requestId: String,
        silentOnly: Boolean = false,
        onTokenResolved: ((token: String?, error: String?) -> Unit)? = null
    ) {
        runOnUiThread {
            val clientId = "523881801839-ri9atc7up257bck5p663hcleqo8d09u2.apps.googleusercontent.com"
            val redirectUri = "https://gen-lang-client-0369636054.firebaseapp.com/__/auth/handler"
            val scope = "openid email profile https://www.googleapis.com/auth/gmail.send"
            val promptParam = if (silentOnly) "none" else "select_account"
            val authUrl = "https://accounts.google.com/o/oauth2/v2/auth" +
                "?client_id=" + Uri.encode(clientId) +
                "&redirect_uri=" + Uri.encode(redirectUri) +
                "&response_type=token" +
                "&scope=" + Uri.encode(scope) +
                "&login_hint=" + Uri.encode("mihalhafner@gmail.com") +
                "&prompt=" + promptParam

            var completed = false
            var authDialog: Dialog? = null
            val oauthWebView = WebView(this)

            fun finishAuth(accessToken: String?, errorMsg: String?) {
                if (completed) return
                completed = true
                runOnUiThread {
                    runCatching { CookieManager.getInstance().flush() }
                    runCatching { authDialog?.dismiss() }
                    runCatching { oauthWebView.destroy() }

                    if (!accessToken.isNullOrBlank()) {
                        val saved = credentialStore.saveGmailConfig(
                            senderEmail = "mihalhafner@gmail.com",
                            appPassword = null,
                            oauthToken = accessToken.trim()
                        )
                        dispatchGmailConfigUpdatedToWeb(getNativeGmailConfigJson(), autoDetected = true)
                        onTokenResolved?.invoke(accessToken.trim(), null)
                        if (requestId.isNotBlank()) {
                            val payload = JSONObject().apply {
                                put("email", saved.gmailSenderEmail)
                                put("accessToken", accessToken.trim())
                            }.toString()
                            dispatchNativeCallback(requestId, true, payload)
                        }
                    } else {
                        val err = errorMsg ?: "Google-Anmeldung abgebrochen."
                        onTokenResolved?.invoke(null, err)
                        if (requestId.isNotBlank()) {
                            dispatchNativeCallback(requestId, false, err)
                        }
                    }
                }
            }

            fun inspectUrlForToken(urlStr: String, hashOverride: String = ""): Boolean {
                if (!urlStr.startsWith(redirectUri)) return false
                val combinedHash = hashOverride.ifBlank {
                    urlStr.substringAfter('#', "")
                }
                val combinedQuery = urlStr.substringAfter('?', "").substringBefore('#')
                val token = extractOAuthParam(combinedHash, "access_token")
                    .ifBlank { extractOAuthParam(combinedQuery, "access_token") }
                if (token.isNotBlank()) {
                    finishAuth(token, null)
                    return true
                }
                val err = extractOAuthParam(combinedHash, "error")
                    .ifBlank { extractOAuthParam(combinedQuery, "error") }
                if (err.isNotBlank()) {
                    finishAuth(null, err)
                    return true
                }
                return false
            }

            val cookieManager = CookieManager.getInstance()
            cookieManager.setAcceptCookie(true)
            cookieManager.setAcceptThirdPartyCookies(oauthWebView, true)

            oauthWebView.settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                userAgentString = buildCleanChromeUserAgent(userAgentString)
            }

            oauthWebView.addJavascriptInterface(
                object {
                    @JavascriptInterface
                    fun onRedirect(href: String, hash: String) {
                        if (!inspectUrlForToken(href, hash)) {
                            finishAuth(null, "Kein Zugriffstoken von Google erhalten.")
                        }
                    }
                },
                "HafnerOAuthPopup"
            )

            oauthWebView.webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest
                ): WebResourceResponse? {
                    val u = request.url?.toString().orEmpty()
                    if (u.startsWith(redirectUri)) {
                        val bridgeHtml = """
                            <!doctype html>
                            <html><head><meta charset="utf-8"></head>
                            <body><script>
                            if (window.HafnerOAuthPopup) {
                              window.HafnerOAuthPopup.onRedirect(window.location.href, window.location.hash || '');
                            }
                            </script></body></html>
                        """.trimIndent()
                        return WebResourceResponse(
                            "text/html",
                            "UTF-8",
                            ByteArrayInputStream(bridgeHtml.toByteArray(Charsets.UTF_8))
                        )
                    }
                    return super.shouldInterceptRequest(view, request)
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val u = request.url?.toString().orEmpty()
                    if (inspectUrlForToken(u)) return true
                    return false
                }

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    if (url != null) {
                        inspectUrlForToken(url)
                    }
                }
            }

            if (silentOnly) {
                window.decorView.postDelayed({
                    if (!completed) {
                        finishAuth(null, "timeout")
                    }
                }, 7000L)
                oauthWebView.loadUrl(authUrl)
            } else {
                val dialog = Dialog(this, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
                dialog.setContentView(
                    oauthWebView,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
                dialog.setOnCancelListener {
                    finishAuth(null, "Google-Anmeldung wurde abgebrochen.")
                }
                authDialog = dialog
                dialog.show()
                oauthWebView.loadUrl(authUrl)
            }
        }
    }

    fun requestSendGmailAutomatically(
        requestId: String,
        base64Pdf: String,
        filename: String,
        recipientEmail: String,
        subject: String,
        bodyText: String,
        invoiceNumber: String,
        webAccessToken: String
    ) {
        Thread {
            try {
                val creds = credentialStore.loadCredentials()
                val senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" }
                val rawMime = mailSender.buildRawMimeMessage(
                    senderEmail = senderEmail,
                    recipientEmail = recipientEmail,
                    subject = subject,
                    bodyText = bodyText,
                    filename = filename,
                    base64Pdf = base64Pdf
                )

                // 1. Direktversand über Gmail REST API mit gespeichertem oder übergebenem OAuth-Token
                val activeToken = webAccessToken.trim().ifBlank { creds.gmailOAuthToken.trim() }
                if (activeToken.isNotEmpty()) {
                    val apiOutcome = mailSender.sendViaGmailRestApi(activeToken, rawMime)
                    if (apiOutcome.ok) {
                        if (webAccessToken.isNotBlank()) {
                            credentialStore.saveGmailConfig(null, null, webAccessToken.trim())
                        }
                        runOnUiThread {
                            mailSender.showMailSentNotification(recipientEmail, invoiceNumber)
                            val res = JSONObject().apply {
                                put("ok", true)
                                put("method", "gmail_api")
                                put("messageId", apiOutcome.messageId ?: "gmail-${System.currentTimeMillis()}")
                            }.toString()
                            dispatchNativeCallback(requestId, true, res)
                        }
                        return@Thread
                    }
                }

                // 2. Falls noch ein SMTP App-Passwort hinterlegt ist, als zusätzlichen Weg nutzen
                val appPwd = creds.effectiveGmailAppPassword
                if (appPwd.length >= 8) {
                    val smtpOutcome = mailSender.sendViaDirectGmailSmtp(
                        senderEmail = senderEmail,
                        appPassword = appPwd,
                        recipientEmail = recipientEmail,
                        rawMimeMessage = rawMime
                    )
                    if (smtpOutcome.ok) {
                        runOnUiThread {
                            mailSender.showMailSentNotification(recipientEmail, invoiceNumber)
                            val res = JSONObject().apply {
                                put("ok", true)
                                put("method", "smtp_tls")
                                put("messageId", smtpOutcome.messageId ?: "smtp-${System.currentTimeMillis()}")
                            }.toString()
                            dispatchNativeCallback(requestId, true, res)
                        }
                        return@Thread
                    }
                }

                // 3. Stille Hintergrund-Erneuerung des Google-OAuth-Tokens über die gespeicherte Google-Sitzung
                val latch = java.util.concurrent.CountDownLatch(1)
                var refreshedToken: String? = null
                requestNativeGoogleSignIn(
                    requestId = "",
                    silentOnly = true
                ) { token, _ ->
                    refreshedToken = token
                    latch.countDown()
                }
                runCatching { latch.await(8, java.util.concurrent.TimeUnit.SECONDS) }

                val silentToken = refreshedToken?.trim().orEmpty()
                if (silentToken.isNotEmpty()) {
                    val retryOutcome = mailSender.sendViaGmailRestApi(silentToken, rawMime)
                    if (retryOutcome.ok) {
                        runOnUiThread {
                            mailSender.showMailSentNotification(recipientEmail, invoiceNumber)
                            val res = JSONObject().apply {
                                put("ok", true)
                                put("method", "gmail_api")
                                put("messageId", retryOutcome.messageId ?: "gmail-${System.currentTimeMillis()}")
                            }.toString()
                            dispatchNativeCallback(requestId, true, res)
                        }
                        return@Thread
                    }
                }

                // 4. Falls noch gar keine Google-Sitzung aktiv ist, 1-Tipp Google-Anmeldung öffnen und direkt senden
                requestNativeGoogleSignIn(
                    requestId = "",
                    silentOnly = false
                ) { interactiveToken, err ->
                    if (!interactiveToken.isNullOrBlank()) {
                        Thread {
                            val finalOutcome = mailSender.sendViaGmailRestApi(interactiveToken.trim(), rawMime)
                            runOnUiThread {
                                if (finalOutcome.ok) {
                                    mailSender.showMailSentNotification(recipientEmail, invoiceNumber)
                                    val res = JSONObject().apply {
                                        put("ok", true)
                                        put("method", "gmail_api")
                                        put("messageId", finalOutcome.messageId ?: "gmail-${System.currentTimeMillis()}")
                                    }.toString()
                                    dispatchNativeCallback(requestId, true, res)
                                } else {
                                    dispatchNativeCallback(
                                        requestId,
                                        false,
                                        finalOutcome.error ?: "Gmail-Versand fehlgeschlagen."
                                    )
                                }
                            }
                        }.start()
                    } else {
                        runOnUiThread {
                            dispatchNativeCallback(
                                requestId,
                                false,
                                err ?: "Bitte einmalig über „Sign in with Google“ anmelden."
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    dispatchNativeCallback(
                        requestId,
                        false,
                        e.message ?: "Fehler beim automatischen E-Mail-Versand."
                    )
                }
            }
        }.start()
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
            calendarPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_CALENDAR,
                    Manifest.permission.WRITE_CALENDAR
                )
            )
        }
    }

    fun requestUpsertCalendarEvent(requestId: String, payloadJson: String) {
        val writeReq = PendingCalendarWrite(requestId, payloadJson, isDelete = false)
        val hasRead = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALENDAR
        ) == PackageManager.PERMISSION_GRANTED
        val hasWrite = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.WRITE_CALENDAR
        ) == PackageManager.PERMISSION_GRANTED

        if (hasRead && hasWrite) {
            executeCalendarWriteOnBackground(writeReq)
        } else {
            pendingCalendarWrite = writeReq
            calendarPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_CALENDAR,
                    Manifest.permission.WRITE_CALENDAR
                )
            )
        }
    }

    fun requestDeleteCalendarEvent(requestId: String, googleEventId: String) {
        val writeReq = PendingCalendarWrite(requestId, googleEventId, isDelete = true)
        val hasRead = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.READ_CALENDAR
        ) == PackageManager.PERMISSION_GRANTED
        val hasWrite = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.WRITE_CALENDAR
        ) == PackageManager.PERMISSION_GRANTED

        if (hasRead && hasWrite) {
            executeCalendarWriteOnBackground(writeReq)
        } else {
            pendingCalendarWrite = writeReq
            calendarPermissionLauncher.launch(
                arrayOf(
                    Manifest.permission.READ_CALENDAR,
                    Manifest.permission.WRITE_CALENDAR
                )
            )
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

    private fun executeCalendarWriteOnBackground(writeReq: PendingCalendarWrite) {
        Thread {
            try {
                if (writeReq.isDelete) {
                    val deleted = calendarReader.deleteEvent(writeReq.payloadJson)
                    val res = JSONObject().apply { put("deleted", deleted) }.toString()
                    runOnUiThread { dispatchNativeCallback(writeReq.requestId, true, res) }
                } else {
                    val resJson = calendarReader.upsertEventJson(writeReq.payloadJson)
                    runOnUiThread { dispatchNativeCallback(writeReq.requestId, true, resJson) }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    dispatchNativeCallback(
                        writeReq.requestId,
                        false,
                        e.message ?: "Kalendersynchronisation fehlgeschlagen."
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
            val host = uri.host?.lowercase() ?: ""

            // WhatsApp-Links (wa.me / api.whatsapp.com / whatsapp://) direkt in der nativen WhatsApp-App öffnen
            if (scheme == "whatsapp" || host == "wa.me" || host == "api.whatsapp.com") {
                val waUri = if (scheme == "whatsapp") {
                    uri
                } else {
                    val pathPhone = uri.pathSegments.firstOrNull()?.replace(Regex("\\D"), "").orEmpty()
                    val queryPhone = uri.getQueryParameter("phone")?.replace(Regex("\\D"), "").orEmpty()
                    val phone = pathPhone.ifEmpty { queryPhone }
                    val text = uri.getQueryParameter("text").orEmpty()
                    Uri.Builder()
                        .scheme("whatsapp")
                        .authority("send")
                        .apply {
                            if (phone.isNotEmpty()) appendQueryParameter("phone", phone)
                            if (text.isNotEmpty()) appendQueryParameter("text", text)
                        }
                        .build()
                }
                for (waPkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
                    val directWa = Intent(Intent.ACTION_VIEW, waUri).setPackage(waPkg)
                    if (directWa.resolveActivity(packageManager) != null) {
                        startActivity(directWa)
                        return
                    }
                }
            }

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

    private fun dispatchPixelTunnelStatusToWeb(statusJson: String) {
        if (!::webView.isInitialized) return
        val safeJson = JSONObject.quote(statusJson)
        val js = "window.__onHafnerNativePixelTunnelStatus && window.__onHafnerNativePixelTunnelStatus($safeJson);"
        webView.evaluateJavascript(js, null)
    }

    private fun resumePixelTunnelIfEnabled() {
        try {
            val tunnelCfg = PixelTunnelConfig(this)
            if (tunnelCfg.enabled() && !tunnelCfg.configured()) {
                tunnelCfg.enabled(false)
                return
            }
            if (tunnelCfg.enabled() && tunnelCfg.configured() && !PixelTunnelService.isServiceRunning()) {
                if (
                    Build.VERSION.SDK_INT < 33 ||
                    ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                        PackageManager.PERMISSION_GRANTED
                ) {
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
        if (activeInstance?.get() === this) {
            activeInstance = null
        }
        NativeStoreManager.unregisterTunnelMutationListener(tunnelMutationListener)
        PixelTunnelService.unregisterStatusListener(pixelTunnelStatusListener)
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        @Volatile
        private var activeInstance: java.lang.ref.WeakReference<MainActivity>? = null

        private val pendingMcpPdfCallbacks =
            java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<String>>()

        fun completeMcpPdfCallback(callbackId: String, payloadJson: String) {
            pendingMcpPdfCallbacks.remove(callbackId)?.complete(payloadJson)
        }

        fun checkMailDeliveryReadiness(context: Context): JSONObject {
            val credentialStore = SecureMcpCredentialStore(context.applicationContext)
            val creds = credentialStore.loadCredentials()
            val senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" }
            val hasOAuth = creds.gmailOAuthToken.trim().isNotEmpty()
            val hasAppPwd = creds.effectiveGmailAppPassword.length >= 8
            val ready = hasOAuth || hasAppPwd
            val provider = when {
                hasOAuth -> "gmail_api"
                hasAppPwd -> "smtp_tls"
                else -> "none"
            }
            return JSONObject()
                .put("ready", ready)
                .put("sender_email", senderEmail)
                .put("provider", provider)
                .put("has_oauth_token", hasOAuth)
                .put("has_app_password", hasAppPwd)
                .apply {
                    if (!ready) {
                        put(
                            "error",
                            "Keine aktive Gmail-Anmeldung oder App-Passwort auf dem Pixel 10 Pro hinterlegt. Bitte in Infinity einmalig beim Rechnungsversand mit Google anmelden."
                        )
                    }
                }
        }

        fun buildInvoicePdfViaExistingEngineBlocking(
            context: Context,
            invoice: JSONObject,
            customers: org.json.JSONArray,
            workRecords: org.json.JSONArray
        ): JSONObject {
            var webViewFallbackReason: String? = null
            val activity = activeInstance?.get()
            val isActivityResumed = activity != null &&
                !activity.isFinishing &&
                !activity.isDestroyed &&
                activity.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)

            if (activity != null && isActivityResumed) {
                val callbackId = "mcp_pdf_${System.currentTimeMillis()}_${java.util.UUID.randomUUID()}"
                val pdfFuture = java.util.concurrent.CompletableFuture<String>()
                pendingMcpPdfCallbacks[callbackId] = pdfFuture

                val safeInv = JSONObject.quote(invoice.toString())
                val safeCust = JSONObject.quote(customers.toString())
                val safeWork = JSONObject.quote(workRecords.toString())
                val safeCb = JSONObject.quote(callbackId)

                activity.runOnUiThread {
                    if (!activity::webView.isInitialized) {
                        pendingMcpPdfCallbacks.remove(callbackId)?.complete(
                            JSONObject()
                                .put("ok", false)
                                .put("error", "WebView nicht initialisiert.")
                                .toString()
                        )
                        return@runOnUiThread
                    }
                    activity.webView.evaluateJavascript(
                        "(typeof window.__hafnerBuildInvoicePdfForMcp === 'function' ? (window.__hafnerBuildInvoicePdfForMcp($safeInv, $safeCust, $safeWork, $safeCb), 'DISPATCHED') : 'MISSING');",
                    ) { evalResult ->
                        val cleaned = evalResult?.trim()?.trim('"').orEmpty()
                        if (cleaned != "DISPATCHED") {
                            pendingMcpPdfCallbacks.remove(callbackId)?.complete(
                                JSONObject()
                                    .put("ok", false)
                                    .put("error", "WebView PDF-Generator noch nicht geladen ($cleaned).")
                                    .toString()
                            )
                        }
                    }
                }

                val pdfJsonStr = try {
                    pdfFuture.get(2500, java.util.concurrent.TimeUnit.MILLISECONDS)
                } catch (e: java.util.concurrent.TimeoutException) {
                    pendingMcpPdfCallbacks.remove(callbackId)
                    webViewFallbackReason = "WebView im Hintergrund pausiert (2,5s Timeout) – Native Android PdfDocument-Engine verwendet."
                    null
                } catch (e: Exception) {
                    pendingMcpPdfCallbacks.remove(callbackId)
                    webViewFallbackReason = "WebView-Abruf unterbrochen (${e.message}) – Native Android PdfDocument-Engine verwendet."
                    null
                }

                if (pdfJsonStr != null) {
                    val pdfPayload = runCatching { JSONObject(pdfJsonStr) }.getOrNull()
                    if (pdfPayload != null && pdfPayload.optBoolean("ok", false)) {
                        val b64 = pdfPayload.optString("base64Pdf", "")
                        if (b64.isNotEmpty()) {
                            pdfPayload.put("engine", "webview_jspdf")
                            return pdfPayload
                        }
                    }
                    webViewFallbackReason = pdfPayload?.optString("error")
                        ?.takeIf { it.isNotBlank() }
                        ?: "WebView lieferte kein gültiges PDF – Native Android PdfDocument-Engine verwendet."
                }
            } else {
                webViewFallbackReason = "App im Hintergrund oder Bildschirm gesperrt – Native Android PdfDocument-Engine direkt verwendet."
            }

            return buildNativeAndroidInvoicePdfFallback(
                context = context.applicationContext,
                invoice = invoice,
                customers = customers,
                workRecords = workRecords,
                fallbackNote = webViewFallbackReason
            )
        }

        private fun detectNativeSalutationLine(recipientName: String, company: String): String {
            val raw = recipientName.trim()
            val comp = company.trim()
            if (raw.isEmpty()) return "Sehr geehrte Damen und Herren,"
            val combined = "$raw $comp".lowercase(java.util.Locale.GERMAN)
            val legalRegex = Regex("\\b(gesbr|gbr|gmbh|gesmbh|kg|og|ag|e\\.?u\\.?|weg|arge|verein|gemeinde|stadtgemeinde|praxis|ordination|kanzlei|hausverwaltung)\\b")
            if (legalRegex.containsMatchIn(combined)) {
                return "Sehr geehrte Damen und Herren,"
            }
            val withoutParens = raw.replace(Regex("\\s*\\([^)]*\\)\\s*"), " ").trim()
            val famMatch = Regex("^(?:familie|fam\\.?|ehepaar)\\s+(.+)$", RegexOption.IGNORE_CASE).find(withoutParens)
            if (famMatch != null) {
                val last = famMatch.groupValues[1].trim().split(Regex("\\s+")).lastOrNull() ?: withoutParens
                return "Sehr geehrte Familie $last,"
            }
            val frauMatch = Regex("^(?:frau|fr\\.?)\\s+(.+)$", RegexOption.IGNORE_CASE).find(withoutParens)
            if (frauMatch != null) {
                val last = frauMatch.groupValues[1].trim().split(Regex("\\s+")).lastOrNull() ?: withoutParens
                return "Sehr geehrte Frau $last,"
            }
            val herrMatch = Regex("^(?:herrn?|hr\\.?)\\s+(.+)$", RegexOption.IGNORE_CASE).find(withoutParens)
            if (herrMatch != null) {
                val last = herrMatch.groupValues[1].trim().split(Regex("\\s+")).lastOrNull() ?: withoutParens
                return "Sehr geehrter Herr $last,"
            }

            val femaleNames = setOf(
                "andrea", "angelika", "anita", "anja", "anna", "annemarie", "astrid", "barbara", "beate",
                "bettina", "bianca", "birgit", "brigitte", "carina", "carmen", "christa", "christina",
                "christine", "claudia", "cornelia", "dagmar", "daniela", "doris", "edith", "elfriede",
                "elisabeth", "elke", "erika", "eva", "franziska", "gabriele", "gerda", "gertrude",
                "gisela", "gudrun", "hanna", "hannah", "heidi", "heike", "helga", "herta", "hildegard",
                "ilse", "ines", "ingeborg", "ingrid", "irene", "iris", "irmgard", "isabella", "jasmin",
                "johanna", "julia", "jutta", "karin", "katharina", "kathrin", "katrin", "kerstin",
                "klara", "kornelia", "lara", "laura", "lea", "lena", "lisa", "luise", "magdalena",
                "manuela", "margarete", "margit", "maria", "marianne", "marie", "marina", "marion",
                "marlies", "martina", "melanie", "michaela", "monika", "nadine", "natalie", "nicole",
                "nina", "patricia", "petra", "regina", "renate", "rita", "rosemarie", "ruth", "sabine",
                "sabrina", "sandra", "sarah", "silke", "silvia", "simone", "sonja", "sophie", "stefanie",
                "susanne", "sylvia", "tamara", "tanja", "theresia", "ulrike", "ursula", "valentina",
                "vanessa", "vera", "verena", "veronika", "viktoria", "waltraud", "yvonne"
            )
            val maleNames = setOf(
                "alexander", "alfred", "alois", "andreas", "anton", "armin", "arnold", "bernd",
                "bernhard", "christian", "christoph", "clemens", "daniel", "david", "dieter", "dietmar",
                "dominik", "eduard", "emil", "erich", "ernst", "erwin", "fabian", "felix", "ferdinand",
                "florian", "franz", "friedrich", "fritz", "georg", "gerald", "gerd", "gerhard", "gernot",
                "gregor", "gunter", "günther", "günter", "gustav", "hannes", "hans", "harald", "heinrich",
                "heinz", "helmut", "herbert", "hermann", "herwig", "horst", "hubert", "jakob", "jan",
                "johann", "johannes", "jonas", "jörg", "josef", "julian", "jürgen", "karl", "klaus",
                "konrad", "kurt", "leo", "leon", "leonhard", "leopold", "lorenz", "ludwig", "lukas",
                "manfred", "manuel", "marc", "marcel", "marco", "mario", "markus", "martin", "mathias",
                "matthias", "max", "maximilian", "michael", "mihal", "mihael", "nikolaus", "norbert",
                "oliver", "oskar", "otmar", "otto", "patrick", "paul", "peter", "philipp", "raimund",
                "rainer", "reinhard", "reinhold", "rene", "richard", "robert", "roland", "roman",
                "rudolf", "sebastian", "sepp", "siegfried", "simon", "stefan", "stephan", "thomas",
                "tobias", "ulrich", "valentin", "viktor", "walter", "werner", "wilfried", "wilhelm",
                "wolfgang"
            )

            val tokens = withoutParens
                .split(Regex("\\s+"))
                .map { it.trim().replace(",", "") }
                .filter { it.isNotEmpty() && !it.equals("Dr.", true) && !it.equals("Mag.", true) && !it.equals("Ing.", true) && !it.equals("DI", true) }

            if (tokens.size >= 2) {
                val firstLow = tokens.first().lowercase(java.util.Locale.GERMAN)
                val lastLow = tokens.last().lowercase(java.util.Locale.GERMAN)
                return when {
                    femaleNames.contains(firstLow) -> "Sehr geehrte Frau ${tokens.last()},"
                    maleNames.contains(firstLow) -> "Sehr geehrter Herr ${tokens.last()},"
                    femaleNames.contains(lastLow) -> "Sehr geehrte Frau ${tokens.first()},"
                    maleNames.contains(lastLow) -> "Sehr geehrter Herr ${tokens.first()},"
                    else -> "Sehr geehrte Damen und Herren,"
                }
            }
            return "Sehr geehrte Damen und Herren,"
        }

        private fun buildNativeAndroidInvoicePdfFallback(
            context: Context,
            invoice: JSONObject,
            customers: org.json.JSONArray,
            workRecords: org.json.JSONArray,
            fallbackNote: String? = null
        ): JSONObject {
            val custId = invoice.optString("customer_id", "")
            var customer: JSONObject? = null
            for (i in 0 until customers.length()) {
                val c = customers.optJSONObject(i) ?: continue
                if (c.optString("id") == custId) {
                    customer = c
                    break
                }
            }

            val invId = invoice.optString("id", "")
            val invNum = invoice.optString("invoice_number", invId.ifBlank { "RE-2026" })
            val isStorno = invoice.optBoolean("is_storno", false) ||
                invoice.optString("document_type", "") == "STORNO"
            val isPauschal = invoice.optBoolean("is_pauschal", false)
            val paidInCash = invoice.optBoolean("paid_in_cash", false)

            val custName = invoice.optString("billing_customer_name", "").ifBlank {
                customer?.optString("name", "")?.ifBlank {
                    invoice.optString("customer_name_snapshot", "Kunde")
                } ?: invoice.optString("customer_name_snapshot", "Kunde")
            }
            val custStreet = invoice.optString("recipient_street", "").ifBlank {
                customer?.optString("street", "").orEmpty()
            }.trim()
            val custZip = invoice.optString("recipient_zip", "").ifBlank {
                customer?.optString("zip", "").orEmpty()
            }.trim()
            val custCity = invoice.optString("recipient_city", "").ifBlank {
                customer?.optString("city", "").orEmpty()
            }.trim()
            val custNum = invoice.optString("customer_number", "").ifBlank {
                customer?.optString("customer_number", "")?.ifBlank { "1001" } ?: "1001"
            }
            val recipientEmail = customer?.optString("email", "")?.trim()?.ifBlank {
                invoice.optString("sent_to", "").trim()
            } ?: invoice.optString("sent_to", "").trim()
            val recipientPhone = customer?.optString("phone", "")?.trim().orEmpty()

            fun fmtDate(iso: String): String {
                val clean = iso.trim().take(10)
                val parts = clean.split("-")
                return if (parts.size == 3) "${parts[2]}.${parts[1]}.${parts[0]}" else clean.ifEmpty { "—" }
            }

            fun fmtEuro(amount: Double): String {
                val nf = java.text.NumberFormat.getNumberInstance(java.util.Locale.GERMANY).apply {
                    minimumFractionDigits = 2
                    maximumFractionDigits = 2
                }
                return "${nf.format(if (amount.isFinite()) amount else 0.0)} EUR"
            }

            fun fmtQty(qty: Double): String {
                val nf = java.text.NumberFormat.getNumberInstance(java.util.Locale.GERMANY).apply {
                    minimumFractionDigits = 2
                    maximumFractionDigits = 2
                }
                return nf.format(if (qty.isFinite()) qty else 0.0)
            }

            val issueDateIso = invoice.optString("issue_date", "").ifBlank {
                invoice.optString("date", "")
            }.take(10)
            val invDate = fmtDate(issueDateIso)
            val dueDateIso = invoice.optString("due_date", "").take(10)
            val dueDate = fmtDate(dueDateIso)

            // Verknüpfte Arbeitsaufzeichnungen ermitteln
            val boundIds = mutableSetOf<String>()
            val wrIdsArr = invoice.optJSONArray("work_record_ids")
            if (wrIdsArr != null) {
                for (i in 0 until wrIdsArr.length()) {
                    val wid = wrIdsArr.optString(i, "").trim()
                    if (wid.isNotEmpty()) boundIds.add(wid)
                }
            }
            val boundRecords = mutableListOf<JSONObject>()
            for (i in 0 until workRecords.length()) {
                val wr = workRecords.optJSONObject(i) ?: continue
                val wid = wr.optString("id", "")
                if (boundIds.contains(wid) || (invId.isNotEmpty() && wr.optString("settlement_id") == invId)) {
                    boundRecords.add(wr)
                }
            }
            boundRecords.sortBy { it.optString("work_date", it.optString("date", "")) }

            val explicitPeriod = invoice.optString("service_period", "").trim()
            val periodDisplay = if (explicitPeriod.isNotEmpty()) {
                explicitPeriod
            } else {
                val dates = boundRecords
                    .map { it.optString("work_date", it.optString("date", "")).take(10) }
                    .filter { it.isNotEmpty() }
                    .sorted()
                when {
                    dates.isEmpty() -> invDate
                    dates.first() == dates.last() -> fmtDate(dates.first())
                    else -> "${fmtDate(dates.first())} - ${fmtDate(dates.last())}"
                }
            }

            // Rechnungspositionen auflösen (analog zu resolveInvoiceDisplayData in invoicePdf.ts)
            data class NativeLineItem(
                val description: String,
                val quantityLabel: String,
                val unitPriceLabel: String,
                val amount: Double
            )

            val resolvedItems = mutableListOf<NativeLineItem>()
            val rawLineItems = invoice.optJSONArray("line_items") ?: invoice.optJSONArray("items")
            if (rawLineItems != null && rawLineItems.length() > 0) {
                for (i in 0 until rawLineItems.length()) {
                    val item = rawLineItems.optJSONObject(i) ?: continue
                    val desc = item.optString("description", "Leistung").trim().ifEmpty { "Leistung" }
                    val qtyLabel = item.optString("quantity_label", "").trim().ifBlank {
                        val q = item.optDouble("quantity", 1.0)
                        val u = item.optString("unit", "Std").trim().ifEmpty { "Std" }
                        "${fmtQty(q)} $u"
                    }.replace(Regex("\\s*Std\\.$"), " Std")
                    val unitPriceLabel = item.optString("unit_price_label", "").trim().ifBlank {
                        if (item.has("unit_price") && !item.isNull("unit_price")) {
                            fmtEuro(item.optDouble("unit_price", 0.0))
                        } else {
                            "Pauschal"
                        }
                    }.replace(Regex("\\s*€$"), " EUR")
                    val amt = if (item.has("amount") && !item.isNull("amount")) {
                        item.optDouble("amount", 0.0)
                    } else {
                        item.optDouble("total", 0.0)
                    }
                    resolvedItems.add(NativeLineItem(desc, qtyLabel, unitPriceLabel, amt))
                }
            } else if (boundRecords.isNotEmpty()) {
                for (rec in boundRecords) {
                    val hrs = rec.optDouble("hours", 0.0)
                    val hasRate = rec.has("hourly_rate") && !rec.isNull("hourly_rate") &&
                        rec.optDouble("hourly_rate", Double.NaN).isFinite()
                    val rate = if (hasRate) rec.optDouble("hourly_rate", 0.0) else null
                    val rawWorkAmt = if (rate != null) {
                        Math.round(hrs * rate * 100.0) / 100.0
                    } else {
                        rec.optDouble("accounting_amount", 0.0)
                    }
                    val workAmt = if (isStorno) -kotlin.math.abs(rawWorkAmt) else rawWorkAmt
                    resolvedItems.add(
                        NativeLineItem(
                            description = rec.optString("title", "Gartenarbeit").ifBlank { "Gartenarbeit" },
                            quantityLabel = "${fmtQty(hrs)} Std",
                            unitPriceLabel = if (rate != null) fmtEuro(rate) else "Pauschal",
                            amount = workAmt
                        )
                    )
                    val mats = rec.optJSONArray("materials")
                    if (mats != null) {
                        for (mIdx in 0 until mats.length()) {
                            val mat = mats.optJSONObject(mIdx) ?: continue
                            val mQty = mat.optDouble("quantity", 1.0)
                            val mUnit = mat.optString("unit", "Stück").ifBlank { "Stück" }
                            val hasPpu = mat.has("price_per_unit") && !mat.isNull("price_per_unit") &&
                                mat.optDouble("price_per_unit", Double.NaN).isFinite()
                            val ppu = if (hasPpu) mat.optDouble("price_per_unit", 0.0) else null
                            val hasTot = mat.has("total") && !mat.isNull("total") &&
                                mat.optDouble("total", Double.NaN).isFinite()
                            val rawMatTot = when {
                                hasTot -> mat.optDouble("total", 0.0)
                                ppu != null -> Math.round(mQty * ppu * 100.0) / 100.0
                                else -> 0.0
                            }
                            val matTot = if (isStorno) -kotlin.math.abs(rawMatTot) else rawMatTot
                            resolvedItems.add(
                                NativeLineItem(
                                    description = mat.optString("name", "Material").ifBlank { "Material" },
                                    quantityLabel = "${fmtQty(mQty)} $mUnit",
                                    unitPriceLabel = if (ppu != null) fmtEuro(ppu) else "inkl.",
                                    amount = matTot
                                )
                            )
                        }
                    }
                }
            }

            val totalAmount = if (invoice.has("total_amount") && !invoice.isNull("total_amount")) {
                invoice.optDouble("total_amount", 0.0)
            } else if (invoice.has("total_gross") && !invoice.isNull("total_gross")) {
                invoice.optDouble("total_gross", 0.0)
            } else {
                resolvedItems.sumOf { it.amount }
            }

            if (resolvedItems.isEmpty()) {
                resolvedItems.add(
                    NativeLineItem(
                        description = if (isStorno) "Storno (${invoice.optString("storno_reason", "Korrektur")})" else "Gartenpflege",
                        quantityLabel = "1,00 Psch",
                        unitPriceLabel = fmtEuro(totalAmount),
                        amount = totalAmount
                    )
                )
            }

            val salutationLine = detectNativeSalutationLine(custName, customer?.optString("company", "").orEmpty())
            val resolvedSubjectText = invoice.optString("subject_text", "").trim().ifEmpty {
                when {
                    isStorno -> "Stornorechnung Nr. $invNum"
                    isPauschal -> "Pauschalrechnung Nr. $invNum"
                    else -> "Rechnungs Nr. $invNum"
                }
            }
            val defaultIntroBody = if (isPauschal) {
                "vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!\nVereinbarungsgemäß stelle ich Ihnen für die durchgeführten Arbeiten folgende Pauschale in Rechnung:"
            } else {
                "vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!\nHiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:"
            }
            val resolvedIntroText = invoice.optString("intro_text", "").trim().ifEmpty {
                "$salutationLine\n$defaultIntroBody"
            }

            // A4 in Punkt (595 x 842 pt = 210 x 297 mm; Umrechnungsfaktor 1 mm = 2.8346457 pt)
            fun mm(v: Float): Float = v * 2.8346457f

            val paintRegular = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(20, 20, 20)
                typeface = android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.NORMAL)
            }
            val paintBold = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(10, 10, 10)
                typeface = android.graphics.Typeface.create(android.graphics.Typeface.SANS_SERIF, android.graphics.Typeface.BOLD)
            }
            val paintFillGrey = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(230, 232, 235)
                style = android.graphics.Paint.Style.FILL
            }
            val paintMarkLine = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                color = android.graphics.Color.rgb(45, 45, 45)
                strokeWidth = 1.4f
            }

            fun wrapTextLines(text: String, paint: android.graphics.Paint, maxWidthPt: Float): List<String> {
                val out = mutableListOf<String>()
                for (para in text.split(Regex("\\r?\\n"))) {
                    val trimmed = para.trim()
                    if (trimmed.isEmpty()) {
                        out.add("")
                        continue
                    }
                    val words = trimmed.split(Regex("\\s+"))
                    var currentLine = ""
                    for (word in words) {
                        val candidate = if (currentLine.isEmpty()) word else "$currentLine $word"
                        if (paint.measureText(candidate) <= maxWidthPt || currentLine.isEmpty()) {
                            currentLine = candidate
                        } else {
                            out.add(currentLine)
                            currentLine = word
                        }
                    }
                    if (currentLine.isNotEmpty()) {
                        out.add(currentLine)
                    }
                }
                return if (out.isEmpty()) listOf("") else out
            }

            // Original-Logo aus dem APK-Bundle laden
            val logoBitmap: android.graphics.Bitmap? = runCatching {
                context.assets.open("www/assets/aistudio/Hafner_Rechnungslogo_Original_236f7b3b.png").use { stream ->
                    android.graphics.BitmapFactory.decodeStream(stream)
                }
            }.getOrNull()

            // Seiteninhalt aufbauen (unterstützt automatischen Seitenumbruch)
            val pageBitmaps = mutableListOf<android.graphics.Bitmap>()
            var currentBitmap = android.graphics.Bitmap.createBitmap(595, 842, android.graphics.Bitmap.Config.ARGB_8888)
            var canvas = android.graphics.Canvas(currentBitmap).apply {
                drawColor(android.graphics.Color.WHITE)
            }
            pageBitmaps.add(currentBitmap)

            fun startNewPage() {
                currentBitmap = android.graphics.Bitmap.createBitmap(595, 842, android.graphics.Bitmap.Config.ARGB_8888)
                canvas = android.graphics.Canvas(currentBitmap).apply {
                    drawColor(android.graphics.Color.WHITE)
                }
                pageBitmaps.add(currentBitmap)
            }

            // Logo rechts oben (X=150mm, Y=6mm, 42x42mm)
            if (logoBitmap != null) {
                val dstRect = android.graphics.RectF(mm(150f), mm(6f), mm(192f), mm(48f))
                canvas.drawBitmap(logoBitmap, null, dstRect, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
            } else {
                paintBold.textSize = 14f
                paintBold.color = android.graphics.Color.rgb(34, 122, 59)
                canvas.drawText("HAFNER – GRÜNRAUM HANDWERK", mm(128f), mm(36f), paintBold)
                paintBold.color = android.graphics.Color.rgb(10, 10, 10)
            }

            // Absender-Rücksendeangabe über dem Adressfeld
            paintRegular.textSize = 7.2f
            paintRegular.color = android.graphics.Color.rgb(30, 30, 30)
            canvas.drawText("Hafner Michael - Goethestrasse 2 - 9560 Feldkirchen in Kärnten", mm(20f), mm(49f), paintRegular)

            // Empfängeradresse links (DIN-Sichtfenster)
            var addrY = 61f
            paintRegular.textSize = 10f
            paintRegular.color = android.graphics.Color.rgb(15, 15, 15)
            canvas.drawText(custName, mm(20f), mm(addrY), paintRegular)
            if (custStreet.isNotEmpty()) {
                addrY += 4.6f
                canvas.drawText(custStreet, mm(20f), mm(addrY), paintRegular)
            }
            val cityLine = listOf(custZip, custCity).filter { it.isNotEmpty() }.joinToString(" ")
            if (cityLine.isNotEmpty()) {
                addrY += 4.6f
                canvas.drawText(cityLine, mm(20f), mm(addrY), paintRegular)
            }
            if (custStreet.isNotEmpty() || cityLine.isNotEmpty()) {
                addrY += 4.6f
                canvas.drawText("Österreich", mm(20f), mm(addrY), paintRegular)
            }

            // Rechnungs-Metadatenblock rechts
            val metaLeftX = mm(128f)
            val metaRightX = mm(192f)
            fun drawRightAligned(text: String, xRightPt: Float, yPt: Float, paint: android.graphics.Paint) {
                val w = paint.measureText(text)
                canvas.drawText(text, xRightPt - w, yPt, paint)
            }

            paintRegular.textSize = 12f
            paintRegular.color = android.graphics.Color.rgb(15, 15, 15)
            canvas.drawText("Rechnungs-Nr.", metaLeftX, mm(56.5f), paintRegular)
            drawRightAligned(invNum, metaRightX, mm(56.5f), paintRegular)

            paintRegular.textSize = 8.2f
            paintRegular.color = android.graphics.Color.rgb(35, 35, 35)
            canvas.drawText("Rechnungsdatum", metaLeftX, mm(61.5f), paintRegular)
            drawRightAligned(invDate, metaRightX, mm(61.5f), paintRegular)

            canvas.drawText("Leistungszeitraum", metaLeftX, mm(65.5f), paintRegular)
            drawRightAligned(periodDisplay, metaRightX, mm(65.5f), paintRegular)

            canvas.drawText("Ihre Kundennummer", metaLeftX, mm(73f), paintRegular)
            drawRightAligned(custNum, metaRightX, mm(73f), paintRegular)

            canvas.drawText("Ihr Ansprechpartner", metaLeftX, mm(77f), paintRegular)
            drawRightAligned("Michael Hafner", metaRightX, mm(77f), paintRegular)

            // Betreffzeile
            val contentLeftMm = 22f
            val contentRightMm = 192f
            val tableWidthMm = contentRightMm - contentLeftMm
            val contentLeftPt = mm(contentLeftMm)
            val contentRightPt = mm(contentRightMm)
            val tableWidthPt = mm(tableWidthMm)

            var yMm = 97f
            paintBold.textSize = 12.5f
            paintBold.color = android.graphics.Color.rgb(10, 10, 10)
            canvas.drawText(resolvedSubjectText, contentLeftPt, mm(yMm), paintBold)

            // Einleitungstext
            yMm = 109f
            paintRegular.textSize = 9.5f
            paintRegular.color = android.graphics.Color.rgb(20, 20, 20)
            if (isStorno) {
                canvas.drawText(salutationLine, contentLeftPt, mm(yMm), paintRegular)
                yMm += 7.5f
                val stornoReason = invoice.optString("storno_reason", "Korrektur").ifBlank { "Korrektur" }
                canvas.drawText("hiermit stornieren wir die betreffende Abrechnung ($stornoReason):", contentLeftPt, mm(yMm), paintRegular)
                yMm += 7f
            } else {
                val paragraphs = resolvedIntroText.split(Regex("\\r?\\n"))
                for ((pIdx, rawPara) in paragraphs.withIndex()) {
                    val line = rawPara.trim()
                    if (line.isEmpty()) {
                        yMm += 3f
                        continue
                    }
                    val wrapped = wrapTextLines(line, paintRegular, tableWidthPt)
                    for (wLine in wrapped) {
                        canvas.drawText(wLine, contentLeftPt, mm(yMm), paintRegular)
                        yMm += 4.5f
                    }
                    yMm += if (pIdx == 0 && line.endsWith(",")) 2.5f else 0.5f
                }
                yMm += 3f
            }

            // Positionstabelle Kopfzeile
            val colPosPt = mm(contentLeftMm + 1.5f)
            val colDescPt = mm(contentLeftMm + 11f)
            val colMengeRightPt = mm(contentLeftMm + 113f)
            val colUnitRightPt = mm(contentLeftMm + 140f)
            val colTotalRightPt = mm(contentRightMm - 1.5f)

            canvas.drawRect(contentLeftPt, mm(yMm), contentRightPt, mm(yMm + 6.8f), paintFillGrey)
            paintBold.textSize = 9f
            paintBold.color = android.graphics.Color.rgb(10, 10, 10)
            val headerBasePt = mm(yMm + 4.7f)
            canvas.drawText("Pos.", colPosPt, headerBasePt, paintBold)
            canvas.drawText("Beschreibung", colDescPt, headerBasePt, paintBold)
            drawRightAligned("Menge", colMengeRightPt, headerBasePt, paintBold)
            drawRightAligned("Einzelpreis", colUnitRightPt, headerBasePt, paintBold)
            drawRightAligned("Gesamtpreis", colTotalRightPt, headerBasePt, paintBold)
            yMm += 8.5f

            // Positionen rendern
            paintBold.textSize = 9.5f
            paintRegular.textSize = 9.5f
            for ((idx, item) in resolvedItems.withIndex()) {
                val descLines = wrapTextLines(item.description, paintBold, mm(75f))
                val rowHMm = kotlin.math.max(8.5f, descLines.size * 4.5f + 4f)
                if (yMm + rowHMm > 230f) {
                    startNewPage()
                    yMm = 25f
                }
                val rowBaseMm = yMm + 4.2f
                canvas.drawText("${idx + 1}.", colPosPt, mm(rowBaseMm), paintRegular)
                for ((dIdx, dLine) in descLines.withIndex()) {
                    canvas.drawText(dLine, colDescPt, mm(rowBaseMm + dIdx * 4.5f), paintBold)
                }
                drawRightAligned(item.quantityLabel, colMengeRightPt, mm(rowBaseMm), paintRegular)
                drawRightAligned(item.unitPriceLabel, colUnitRightPt, mm(rowBaseMm), paintRegular)
                drawRightAligned(fmtEuro(item.amount), colTotalRightPt, mm(rowBaseMm), paintRegular)
                yMm += rowHMm
            }

            // Summenblock
            yMm += 2f
            if (yMm + 52f > 258f) {
                startNewPage()
                yMm = 25f
            }

            // Zeile 1: Gesamtbetrag netto
            canvas.drawRect(contentLeftPt, mm(yMm), contentRightPt, mm(yMm + 6.5f), paintFillGrey)
            paintRegular.textSize = 9.5f
            canvas.drawText("Gesamtbetrag netto", colDescPt, mm(yMm + 4.5f), paintRegular)
            drawRightAligned(fmtEuro(totalAmount), colTotalRightPt, mm(yMm + 4.5f), paintRegular)
            yMm += 6.5f

            // Zeile 2: Kleinunternehmerregelung
            paintRegular.textSize = 9f
            canvas.drawText(
                "Der Rechnungsbetrag enthält gem. §6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer",
                colDescPt,
                mm(yMm + 4.6f),
                paintRegular
            )
            yMm += 6.8f

            // Zeile 3: Gesamtbetrag brutto
            canvas.drawRect(contentLeftPt, mm(yMm), contentRightPt, mm(yMm + 6.8f), paintFillGrey)
            paintBold.textSize = 9.5f
            canvas.drawText("Gesamtbetrag brutto", colDescPt, mm(yMm + 4.7f), paintBold)
            drawRightAligned(fmtEuro(totalAmount), colTotalRightPt, mm(yMm + 4.7f), paintBold)

            // Zahlungsbedingungen & Grußformel
            yMm += 14f
            paintRegular.textSize = 9.2f
            paintRegular.color = android.graphics.Color.rgb(20, 20, 20)
            if (!isStorno) {
                if (paidInCash) {
                    val cashTerms = invoice.optString("payment_terms_text", "").trim()
                        .ifEmpty { "Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten." }
                    for (line in wrapTextLines(cashTerms, paintRegular, tableWidthPt)) {
                        canvas.drawText(line, contentLeftPt, mm(yMm), paintRegular)
                        yMm += 4.5f
                    }
                    yMm += 4f
                } else {
                    val terms = invoice.optString("payment_terms_text", "").trim()
                        .ifEmpty { "Zahlungsbedingungen: Zahlung innerhalb von 14 Tagen ab Rechnungseingang ohne Abzüge." }
                    for (line in wrapTextLines(terms, paintRegular, tableWidthPt)) {
                        canvas.drawText(line, contentLeftPt, mm(yMm), paintRegular)
                        yMm += 4.5f
                    }
                    yMm += 3f

                    val customClosing = invoice.optString("closing_text", "").trim()
                    if (customClosing.isNotEmpty()) {
                        for (line in wrapTextLines(customClosing, paintRegular, tableWidthPt)) {
                            canvas.drawText(line, contentLeftPt, mm(yMm), paintRegular)
                            yMm += 4.5f
                        }
                        yMm += 4f
                    } else {
                        canvas.drawText(
                            "Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das unten angegebene",
                            contentLeftPt,
                            mm(yMm),
                            paintRegular
                        )
                        yMm += 4.3f
                        canvas.drawText("Konto.", contentLeftPt, mm(yMm), paintRegular)
                        yMm += 4.5f
                        canvas.drawText("Der Rechnungsbetrag ist bis zum $dueDate fällig.", contentLeftPt, mm(yMm), paintRegular)
                        yMm += 8.5f
                    }
                }
            } else {
                yMm += 4f
            }

            canvas.drawText("Mit freundlichen Grüßen", contentLeftPt, mm(yMm), paintRegular)
            yMm += 4.5f
            canvas.drawText("Michael Hafner", contentLeftPt, mm(yMm), paintRegular)

            // DIN 5008 Falzmarken, Seitenzahlen & 4-spaltige Original-Fußzeile auf allen Seiten zeichnen
            val pdfDoc = android.graphics.pdf.PdfDocument()
            val totalPages = pageBitmaps.size
            for ((pIdx, bmp) in pageBitmaps.withIndex()) {
                val pageCanvas = android.graphics.Canvas(bmp)
                pageCanvas.drawLine(0f, mm(105f), mm(4f), mm(105f), paintMarkLine)
                pageCanvas.drawLine(0f, mm(148.5f), mm(6.5f), mm(148.5f), paintMarkLine)
                pageCanvas.drawLine(0f, mm(210f), mm(4f), mm(210f), paintMarkLine)

                paintRegular.textSize = 8f
                paintRegular.color = android.graphics.Color.rgb(35, 35, 35)
                val pageLabel = "${pIdx + 1}/$totalPages"
                pageCanvas.drawText(pageLabel, mm(192f) - paintRegular.measureText(pageLabel), mm(267f), paintRegular)

                val fy = 275f
                val lh = 3.5f
                paintRegular.textSize = 7.2f
                paintRegular.color = android.graphics.Color.rgb(40, 40, 40)

                pageCanvas.drawText("Hafner Michael", mm(20f), mm(fy), paintRegular)
                pageCanvas.drawText("Goethestrasse 2", mm(20f), mm(fy + lh), paintRegular)
                pageCanvas.drawText("9560 Feldkirchen in Kärnten", mm(20f), mm(fy + lh * 2), paintRegular)
                pageCanvas.drawText("Österreich", mm(20f), mm(fy + lh * 3), paintRegular)

                pageCanvas.drawText("Tel. 06802376503", mm(63f), mm(fy), paintRegular)
                pageCanvas.drawText("E-Mail hafnerm@gmx.at", mm(63f), mm(fy + lh), paintRegular)

                pageCanvas.drawText("Amtsgericht Feldkirchen", mm(105f), mm(fy), paintRegular)
                pageCanvas.drawText("Steuer-Nr. 59 0640553", mm(105f), mm(fy + lh), paintRegular)
                pageCanvas.drawText("Inhaber/-in Michael Hafner", mm(105f), mm(fy + lh * 2), paintRegular)

                pageCanvas.drawText("Bank N26", mm(149f), mm(fy), paintRegular)
                pageCanvas.drawText("IBAN DE41100110012348393811", mm(149f), mm(fy + lh), paintRegular)
                pageCanvas.drawText("BIC NTSBDEB1XXX", mm(149f), mm(fy + lh * 2), paintRegular)

                val pageInfo = android.graphics.pdf.PdfDocument.PageInfo.Builder(595, 842, pIdx + 1).create()
                val pdfPage = pdfDoc.startPage(pageInfo)
                pdfPage.canvas.drawBitmap(bmp, 0f, 0f, null)
                pdfDoc.finishPage(pdfPage)
                bmp.recycle()
            }
            logoBitmap?.recycle()

            val out = java.io.ByteArrayOutputStream()
            pdfDoc.writeTo(out)
            pdfDoc.close()

            val pdfBytes = out.toByteArray()
            val base64Pdf = android.util.Base64.encodeToString(pdfBytes, android.util.Base64.NO_WRAP)
            val safeNum = invNum.trim().replace("/", "-").replace(Regex("[^a-zA-Z0-9_-]"), "_")
            val prefix = if (isStorno) "Storno" else "Rechnung"
            val datePrefix = issueDateIso.ifEmpty { "2026-01-01" }
            val filename = "${datePrefix}_${prefix}_${safeNum.ifEmpty { "Beleg" }}.pdf"
            val docTitle = if (isStorno) "Stornorechnung Nr. $invNum" else "Rechnungs Nr. $invNum"
            val subject = "$docTitle – Hafner Michael – Grünraum Handwerk"
            val bodyText = listOf(
                salutationLine,
                "",
                "vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen! Anbei erhalten Sie die $docTitle vom $invDate als PDF-Dokument.",
                "",
                "Leistungszeitraum: $periodDisplay",
                "Gesamtbetrag brutto: ${fmtEuro(totalAmount)}",
                "Fällig bis zum: $dueDate (innerhalb von 14 Tagen ohne Abzüge)",
                "Bankverbindung: Bank N26 · IBAN DE41100110012348393811 · BIC NTSBDEB1XXX",
                "",
                "Mit freundlichen Grüßen",
                "Michael Hafner",
                "Goethestrasse 2, 9560 Feldkirchen in Kärnten",
                "Tel. 06802376503"
            ).joinToString("\n")

            return JSONObject()
                .put("ok", true)
                .put("engine", "native_android_pdf")
                .apply {
                    if (!fallbackNote.isNullOrBlank()) {
                        put("engineNote", fallbackNote)
                    }
                }
                .put("base64Pdf", base64Pdf)
                .put("pdfSizeBytes", pdfBytes.size)
                .put("filename", filename)
                .put("subject", subject)
                .put("bodyText", bodyText)
                .put("recipientEmail", recipientEmail)
                .put("recipientPhone", recipientPhone)
                .put("recipientName", custName)
                .put("totalAmount", totalAmount)
        }

        fun sendInvoiceViaExistingEngineBlocking(
            context: Context,
            invoice: JSONObject,
            customers: org.json.JSONArray,
            workRecords: org.json.JSONArray,
            recipientEmail: String
        ): JSONObject {
            val activity = activeInstance?.get()
            val pdfPayload = buildInvoicePdfViaExistingEngineBlocking(context, invoice, customers, workRecords)
            val base64Pdf = pdfPayload.optString("base64Pdf", "")
            val pdfSizeBytes = pdfPayload.optInt("pdfSizeBytes", 0)
            if (!pdfPayload.optBoolean("ok", false) || base64Pdf.isEmpty() || pdfSizeBytes <= 0) {
                val errDetail = pdfPayload.optString("error", "PDF-Erzeugung lieferte keine gültigen Daten.")
                throw IllegalStateException("Rechnungsversand abgebrochen: Original-Rechnungs-PDF konnte nicht erzeugt werden ($errDetail).")
            }
            val filename = pdfPayload.optString("filename", "Rechnung.pdf")
            val subject = pdfPayload.optString("subject", "Rechnung – Hafner Grünraum Handwerk")
            val bodyText = pdfPayload.optString("bodyText", "")
            val invNumber = invoice.optString("invoice_number", "Rechnung")

            val credentialStore = SecureMcpCredentialStore(context.applicationContext)
            val mailSender = NativeMailSender(context.applicationContext)
            val creds = credentialStore.loadCredentials()
            val senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" }

            val rawMime = mailSender.buildRawMimeMessage(
                senderEmail = senderEmail,
                recipientEmail = recipientEmail,
                subject = subject,
                bodyText = bodyText,
                filename = filename,
                base64Pdf = base64Pdf
            )

            return dispatchRawMimeViaNativeMail(
                activity = activity,
                mailSender = mailSender,
                creds = creds,
                senderEmail = senderEmail,
                recipientEmail = recipientEmail,
                rawMime = rawMime,
                notificationLabel = invNumber,
                filename = filename
            ).apply {
                put("pdfSizeBytes", pdfSizeBytes)
                put("pdfEngine", pdfPayload.optString("engine", "native_android_pdf"))
            }
        }

        fun sendPlainEmailViaExistingEngineBlocking(
            context: Context,
            recipientEmail: String,
            subject: String,
            bodyText: String,
            notificationLabel: String
        ): JSONObject {
            val activity = activeInstance?.get()
            val credentialStore = SecureMcpCredentialStore(context.applicationContext)
            val mailSender = NativeMailSender(context.applicationContext)
            val creds = credentialStore.loadCredentials()
            val senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" }

            val rawMime = mailSender.buildPlainTextMimeMessage(
                senderEmail = senderEmail,
                recipientEmail = recipientEmail,
                subject = subject,
                bodyText = bodyText
            )

            return dispatchRawMimeViaNativeMail(
                activity = activity,
                mailSender = mailSender,
                creds = creds,
                senderEmail = senderEmail,
                recipientEmail = recipientEmail,
                rawMime = rawMime,
                notificationLabel = notificationLabel,
                filename = null
            )
        }

        private fun dispatchRawMimeViaNativeMail(
            activity: MainActivity?,
            mailSender: NativeMailSender,
            creds: McpCredentials,
            senderEmail: String,
            recipientEmail: String,
            rawMime: String,
            notificationLabel: String,
            filename: String?
        ): JSONObject {
            val attemptErrors = mutableListOf<String>()

            // 1. Gespeichertes Google OAuth-Token
            val storedToken = creds.gmailOAuthToken.trim()
            if (storedToken.isNotEmpty()) {
                val apiOutcome = mailSender.sendViaGmailRestApi(storedToken, rawMime)
                if (apiOutcome.ok) {
                    activity?.runOnUiThread {
                        mailSender.showMailSentNotification(recipientEmail, notificationLabel)
                    }
                    return JSONObject()
                        .put("ok", true)
                        .put("method", "gmail_api")
                        .put("messageId", apiOutcome.messageId ?: "gmail-${System.currentTimeMillis()}")
                        .apply { if (filename != null) put("filename", filename) }
                } else {
                    attemptErrors.add("Gmail REST API: ${apiOutcome.error ?: "Unbekannter Fehler"}")
                }
            }

            // 2. Falls SMTP App-Passwort hinterlegt ist
            val appPwd = creds.effectiveGmailAppPassword
            if (appPwd.length >= 8) {
                val smtpOutcome = mailSender.sendViaDirectGmailSmtp(
                    senderEmail = senderEmail,
                    appPassword = appPwd,
                    recipientEmail = recipientEmail,
                    rawMimeMessage = rawMime
                )
                if (smtpOutcome.ok) {
                    activity?.runOnUiThread {
                        mailSender.showMailSentNotification(recipientEmail, notificationLabel)
                    }
                    return JSONObject()
                        .put("ok", true)
                        .put("method", "smtp_tls")
                        .put("messageId", smtpOutcome.messageId ?: "smtp-${System.currentTimeMillis()}")
                        .apply { if (filename != null) put("filename", filename) }
                } else {
                    attemptErrors.add("Gmail SMTP TLS: ${smtpOutcome.error ?: "Unbekannter Fehler"}")
                }
            }

            // 3. Stille Hintergrund-Erneuerung des Google-OAuth-Tokens (nur wenn Activity im Vordergrund aktiv ist)
            val isActivityResumed = activity != null &&
                !activity.isFinishing &&
                !activity.isDestroyed &&
                activity.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)

            if (activity != null && isActivityResumed) {
                val latch = java.util.concurrent.CountDownLatch(1)
                var refreshedToken: String? = null
                var refreshErr: String? = null
                activity.requestNativeGoogleSignIn(
                    requestId = "",
                    silentOnly = true
                ) { token, err ->
                    refreshedToken = token
                    refreshErr = err
                    latch.countDown()
                }
                runCatching { latch.await(5, java.util.concurrent.TimeUnit.SECONDS) }

                val silentToken = refreshedToken?.trim().orEmpty()
                if (silentToken.isNotEmpty()) {
                    val retryOutcome = mailSender.sendViaGmailRestApi(silentToken, rawMime)
                    if (retryOutcome.ok) {
                        activity.runOnUiThread {
                            mailSender.showMailSentNotification(recipientEmail, notificationLabel)
                        }
                        return JSONObject()
                            .put("ok", true)
                            .put("method", "gmail_api")
                            .put("messageId", retryOutcome.messageId ?: "gmail-${System.currentTimeMillis()}")
                            .apply { if (filename != null) put("filename", filename) }
                    } else {
                        attemptErrors.add("Gmail REST API (Token-Refresh): ${retryOutcome.error ?: "Unbekannter Fehler"}")
                    }
                } else if (!refreshErr.isNullOrBlank()) {
                    attemptErrors.add("Stiller OAuth-Refresh: $refreshErr")
                }
            }

            val detailSuffix = if (attemptErrors.isNotEmpty()) {
                " Details: ${attemptErrors.joinToString(" | ")}"
            } else {
                " Keine gespeicherte Google-Anmeldung oder App-Passwort auf dem Gerät gefunden."
            }
            throw IllegalStateException(
                "Gmail-Versand für $notificationLabel an $recipientEmail fehlgeschlagen.$detailSuffix Bitte in Infinity unter Einstellungen → Gmail prüfen."
            )
        }
    }
}
