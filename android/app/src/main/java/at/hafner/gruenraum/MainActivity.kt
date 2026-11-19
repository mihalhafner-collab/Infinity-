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

        if (intent?.getBooleanExtra(EXTRA_AUTO_GMAIL_SIGNIN, false) == true) {
            intent?.removeExtra(EXTRA_AUTO_GMAIL_SIGNIN)
            window.decorView.postDelayed({
                requestNativeGoogleSignIn("", silentOnly = false)
            }, 350L)
        } else {
            val initialCreds = credentialStore.loadCredentials()
            if (initialCreds.gmailOAuthToken.isBlank() && initialCreds.effectiveGmailAppPassword.length < 8) {
                window.decorView.postDelayed({
                    requestNativeGoogleSignIn("", silentOnly = true)
                }, 900L)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.getBooleanExtra(EXTRA_AUTO_GMAIL_SIGNIN, false)) {
            intent.removeExtra(EXTRA_AUTO_GMAIL_SIGNIN)
            window.decorView.postDelayed({
                requestNativeGoogleSignIn("", silentOnly = false)
            }, 200L)
        }
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
                        val cleanTok = accessToken.trim()
                        val saved = credentialStore.saveGmailConfig(
                            senderEmail = "mihalhafner@gmail.com",
                            appPassword = null,
                            oauthToken = cleanTok
                        )
                        dispatchGmailConfigUpdatedToWeb(getNativeGmailConfigJson(), autoDetected = true)
                        pendingInteractiveOAuthFuture?.complete(cleanTok)
                        onTokenResolved?.invoke(cleanTok, null)
                        if (requestId.isNotBlank()) {
                            val payload = JSONObject().apply {
                                put("email", saved.gmailSenderEmail)
                                put("accessToken", cleanTok)
                            }.toString()
                            dispatchNativeCallback(requestId, true, payload)
                        }
                    } else {
                        val err = errorMsg ?: "Google-Anmeldung abgebrochen."
                        if (!silentOnly) {
                            pendingInteractiveOAuthFuture?.complete("")
                        }
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
        const val EXTRA_AUTO_GMAIL_SIGNIN = "extra_auto_gmail_signin"

        @Volatile
        private var activeInstance: java.lang.ref.WeakReference<MainActivity>? = null

        @Volatile
        private var pendingInteractiveOAuthFuture: java.util.concurrent.CompletableFuture<String>? = null

        private val pendingMcpPdfCallbacks =
            java.util.concurrent.ConcurrentHashMap<String, java.util.concurrent.CompletableFuture<String>>()

        fun completeMcpPdfCallback(callbackId: String, payloadJson: String) {
            pendingMcpPdfCallbacks.remove(callbackId)?.complete(payloadJson)
        }

        private fun extractStaticOAuthParam(fragmentOrQuery: String, key: String): String {
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

        /**
         * Erneuert das Google-OAuth-Token still im Hintergrund über den systemweiten WebView-CookieManager.
         * Funktioniert auch dann, wenn der Nutzer gerade in der ChatGPT-App ist und MainActivity im Hintergrund liegt.
         */
        @SuppressLint("SetJavaScriptEnabled")
        fun silentRefreshGoogleOAuthTokenBlocking(
            context: Context,
            timeoutMs: Long = 6500L
        ): Pair<String?, String?> {
            val appCtx = context.applicationContext
            val credentialStore = SecureMcpCredentialStore(appCtx)
            val future = java.util.concurrent.CompletableFuture<Pair<String?, String?>>()
            val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

            mainHandler.post {
                try {
                    val clientId = "523881801839-ri9atc7up257bck5p663hcleqo8d09u2.apps.googleusercontent.com"
                    val redirectUri = "https://gen-lang-client-0369636054.firebaseapp.com/__/auth/handler"
                    val scope = "openid email profile https://www.googleapis.com/auth/gmail.send"
                    val authUrl = "https://accounts.google.com/o/oauth2/v2/auth" +
                        "?client_id=" + Uri.encode(clientId) +
                        "&redirect_uri=" + Uri.encode(redirectUri) +
                        "&response_type=token" +
                        "&scope=" + Uri.encode(scope) +
                        "&login_hint=" + Uri.encode("mihalhafner@gmail.com") +
                        "&prompt=none"

                    var completed = false
                    val bgWebView = WebView(appCtx)

                    fun finishSilent(token: String?, err: String?) {
                        if (completed) return
                        completed = true
                        mainHandler.post {
                            runCatching { CookieManager.getInstance().flush() }
                            runCatching { bgWebView.destroy() }
                        }
                        if (!token.isNullOrBlank()) {
                            val cleanTok = token.trim()
                            credentialStore.saveGmailConfig(
                                senderEmail = "mihalhafner@gmail.com",
                                appPassword = null,
                                oauthToken = cleanTok
                            )
                            activeInstance?.get()?.let { act ->
                                act.runOnUiThread {
                                    act.dispatchGmailConfigUpdatedToWeb(
                                        act.getNativeGmailConfigJson(),
                                        autoDetected = true
                                    )
                                }
                            }
                            future.complete(cleanTok to null)
                        } else {
                            future.complete(null to (err ?: "Keine aktive Google-Sitzung im WebView-Speicher."))
                        }
                    }

                    fun inspectRedirect(urlStr: String, hashOverride: String = ""): Boolean {
                        if (!urlStr.startsWith(redirectUri)) return false
                        val combinedHash = hashOverride.ifBlank { urlStr.substringAfter('#', "") }
                        val combinedQuery = urlStr.substringAfter('?', "").substringBefore('#')
                        val token = extractStaticOAuthParam(combinedHash, "access_token")
                            .ifBlank { extractStaticOAuthParam(combinedQuery, "access_token") }
                        if (token.isNotBlank()) {
                            finishSilent(token, null)
                            return true
                        }
                        val err = extractStaticOAuthParam(combinedHash, "error")
                            .ifBlank { extractStaticOAuthParam(combinedQuery, "error") }
                        if (err.isNotBlank()) {
                            finishSilent(null, err)
                            return true
                        }
                        return false
                    }

                    val cm = CookieManager.getInstance()
                    cm.setAcceptCookie(true)
                    cm.setAcceptThirdPartyCookies(bgWebView, true)

                    bgWebView.settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        userAgentString = bgWebView.settings.userAgentString
                            .orEmpty()
                            .replace("; wv)", ")")
                            .replace(" wv ", " ")
                            .replace(Regex("Version/\\d+\\.\\d+\\s*"), "")
                            .trim()
                            .ifBlank {
                                "Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
                            }
                    }

                    bgWebView.addJavascriptInterface(
                        object {
                            @JavascriptInterface
                            fun onRedirect(href: String, hash: String) {
                                if (!inspectRedirect(href, hash)) {
                                    finishSilent(null, "Kein OAuth-Token in Redirect erhalten.")
                                }
                            }
                        },
                        "HafnerOAuthPopup"
                    )

                    bgWebView.webViewClient = object : WebViewClient() {
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
                            if (inspectRedirect(u)) return true
                            return false
                        }

                        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                            if (url != null) {
                                inspectRedirect(url)
                            }
                        }
                    }

                    mainHandler.postDelayed({
                        if (!completed) {
                            finishSilent(null, "timeout")
                        }
                    }, timeoutMs)

                    bgWebView.loadUrl(authUrl)
                } catch (e: Exception) {
                    future.complete(null to (e.message ?: "Fehler beim Hintergrund-OAuth-Refresh"))
                }
            }

            return try {
                future.get(timeoutMs + 1000L, java.util.concurrent.TimeUnit.MILLISECONDS)
            } catch (_: Exception) {
                null to "timeout"
            }
        }

        fun checkMailDeliveryReadiness(context: Context): JSONObject {
            val credentialStore = SecureMcpCredentialStore(context.applicationContext)
            var creds = credentialStore.loadCredentials()
            val senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" }
            var hasOAuth = creds.gmailOAuthToken.trim().isNotEmpty()
            val hasAppPwd = creds.effectiveGmailAppPassword.length >= 8

            if (!hasOAuth && !hasAppPwd) {
                val (refreshedToken, _) = silentRefreshGoogleOAuthTokenBlocking(context.applicationContext, 4500L)
                if (!refreshedToken.isNullOrBlank()) {
                    creds = credentialStore.loadCredentials()
                    hasOAuth = creds.gmailOAuthToken.trim().isNotEmpty()
                }
            }

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
                            "Keine aktive Gmail-Anmeldung oder App-Passwort auf dem Pixel 10 Pro hinterlegt. Bitte in Infinity unter Einstellungen → Gmail einmalig auf „Sign in with Google“ tippen oder ein 16-stelliges Google App-Passwort speichern."
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
            return at.hafner.gruenraum.documents.NativeInvoicePdfGenerator.buildInvoicePdf(
                context = context.applicationContext,
                invoice = invoice,
                customers = customers,
                workRecords = workRecords,
                fallbackNote = null
            )
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
                context = context.applicationContext,
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
                context = context.applicationContext,
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
            context: Context,
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
            val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

            // 1. Gespeichertes Google OAuth-Token
            val storedToken = creds.gmailOAuthToken.trim()
            if (storedToken.isNotEmpty()) {
                val apiOutcome = mailSender.sendViaGmailRestApi(storedToken, rawMime)
                if (apiOutcome.ok) {
                    mainHandler.post {
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
                    mainHandler.post {
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

            // 3. Stille Hintergrund-Erneuerung des Google-OAuth-Tokens (funktioniert auch während ChatGPT im Vordergrund ist)
            val (refreshedToken, refreshErr) = silentRefreshGoogleOAuthTokenBlocking(context, 6500L)
            val silentToken = refreshedToken?.trim().orEmpty()
            if (silentToken.isNotEmpty()) {
                val retryOutcome = mailSender.sendViaGmailRestApi(silentToken, rawMime)
                if (retryOutcome.ok) {
                    mainHandler.post {
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

            // 4. Falls überhaupt noch keine Google-Anmeldung vorliegt:
            //    Sofortige 1-Tipp-Freigabe anzeigen (Dialog falls App offen, sonst Heads-Up-Banner für 20 Sek. warten)
            val interactiveFuture = java.util.concurrent.CompletableFuture<String>()
            pendingInteractiveOAuthFuture = interactiveFuture
            val currentAct = activeInstance?.get()
            val isActVisible = currentAct != null &&
                !currentAct.isFinishing &&
                !currentAct.isDestroyed &&
                currentAct.lifecycle.currentState.isAtLeast(androidx.lifecycle.Lifecycle.State.STARTED)

            if (currentAct != null && isActVisible) {
                currentAct.requestNativeGoogleSignIn(requestId = "", silentOnly = false)
            } else {
                mainHandler.post {
                    mailSender.showGmailSignInRequiredNotification(notificationLabel)
                }
            }

            val interactiveToken = try {
                interactiveFuture.get(20, java.util.concurrent.TimeUnit.SECONDS).trim()
            } catch (_: Exception) {
                ""
            } finally {
                if (pendingInteractiveOAuthFuture === interactiveFuture) {
                    pendingInteractiveOAuthFuture = null
                }
            }

            if (interactiveToken.isNotEmpty()) {
                val finalOutcome = mailSender.sendViaGmailRestApi(interactiveToken, rawMime)
                if (finalOutcome.ok) {
                    mainHandler.post {
                        mailSender.showMailSentNotification(recipientEmail, notificationLabel)
                    }
                    return JSONObject()
                        .put("ok", true)
                        .put("method", "gmail_api")
                        .put("messageId", finalOutcome.messageId ?: "gmail-${System.currentTimeMillis()}")
                        .apply { if (filename != null) put("filename", filename) }
                } else {
                    attemptErrors.add("Gmail REST API (nach Anmeldung): ${finalOutcome.error ?: "Unbekannter Fehler"}")
                }
            }

            val detailSuffix = if (attemptErrors.isNotEmpty()) {
                " Details: ${attemptErrors.joinToString(" | ")}"
            } else {
                " Keine gespeicherte Google-Anmeldung oder App-Passwort auf dem Gerät gefunden."
            }
            throw IllegalStateException(
                "Gmail-Versand für $notificationLabel an $recipientEmail fehlgeschlagen.$detailSuffix Bitte in Infinity unter Einstellungen → Gmail einmalig auf „Sign in with Google“ tippen oder ein App-Passwort speichern."
            )
        }
    }
}
