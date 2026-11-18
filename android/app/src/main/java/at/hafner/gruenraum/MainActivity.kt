package at.hafner.gruenraum

import android.Manifest
import android.accounts.Account
import android.accounts.AccountManager
import android.annotation.SuppressLint
import android.app.Activity
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
import at.hafner.gruenraum.documents.NativeMailSender
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
    private lateinit var mailSender: NativeMailSender
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

    private data class PendingCalendarWrite(
        val requestId: String,
        val payloadJson: String,
        val isDelete: Boolean
    )

    private data class PendingBackupWrite(
        val requestId: String,
        val jsonPayload: String
    )

    private data class PendingMailSend(
        val requestId: String,
        val base64Pdf: String,
        val filename: String,
        val recipientEmail: String,
        val subject: String,
        val bodyText: String,
        val invoiceNumber: String,
        val rawMimeMessage: String,
        val selectedAccountName: String? = null
    )

    private var pendingDocSave: PendingDocSave? = null
    private var pendingCalendarQuery: PendingCalendarQuery? = null
    private var pendingCalendarWrite: PendingCalendarWrite? = null
    private var pendingLocationRequestId: String? = null
    private var pendingWebGeoOrigin: String? = null
    private var pendingWebGeoCallback: GeolocationPermissions.Callback? = null
    private var pendingBackupWrite: PendingBackupWrite? = null
    private var pendingRestoreRequestId: String? = null
    private var pendingMailSend: PendingMailSend? = null

    private val tunnelMutationListener: (String, Int, String) -> Unit = { stateJson, revision, summary ->
        runOnUiThread {
            NativeStoreManager.notifyWebViewSyncedRevision(revision)
            dispatchRemoteMcpStateToWeb(stateJson, revision, summary)
        }
    }

    private val staticLocalSaveListener: () -> Unit = {
        // Lokale Speicherung bleibt ausschließlich auf dem Pixel 10 Pro (keine Web-App-Synchronisation)
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

    private val gmailAccountPickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val pending = pendingMailSend
        if (pending == null) return@registerForActivityResult
        if (result.resultCode == Activity.RESULT_OK && result.data != null) {
            val accName = result.data?.getStringExtra(AccountManager.KEY_ACCOUNT_NAME)?.trim().orEmpty()
            if (accName.isNotEmpty()) {
                credentialStore.saveGmailConfig(accName, null, null)
                val updated = pending.copy(selectedAccountName = accName)
                pendingMailSend = updated
                requestAccountManagerTokenAndSend(updated, Account(accName, "com.google"))
                return@registerForActivityResult
            }
        }
        pendingMailSend = null
        dispatchNativeCallback(
            pending.requestId,
            false,
            "APP_PASSWORD_REQUIRED:Für den automatischen Hintergrund-Versand bitte einmalig Ihr 16-stelliges Google App-Passwort hinterlegen."
        )
    }

    private val gmailAuthConsentLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val pending = pendingMailSend
        if (pending == null) return@registerForActivityResult
        if (result.resultCode == Activity.RESULT_OK) {
            val accName = pending.selectedAccountName ?: credentialStore.loadCredentials().gmailSenderEmail
            requestAccountManagerTokenAndSend(
                pending,
                Account(accName.ifBlank { "mihalhafner@gmail.com" }, "com.google"),
                allowConsentIntent = false
            )
        } else {
            pendingMailSend = null
            dispatchNativeCallback(
                pending.requestId,
                false,
                "APP_PASSWORD_REQUIRED:Google-Freigabe abgelehnt. Bitte einmalig das 16-stellige Google App-Passwort für den Direktversand hinterlegen."
            )
        }
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
        mailSender = NativeMailSender(applicationContext)
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
                var creds = credentialStore.loadCredentials()
                val senderEmail = creds.gmailSenderEmail.ifBlank { "mihalhafner@gmail.com" }

                // Falls noch kein App-Passwort gespeichert ist, vorab prüfen ob ein 16-stelliger Google-Code in der Zwischenablage liegt
                if (creds.effectiveGmailAppPassword.length < 8) {
                    val clipCode = extractGoogleAppPasswordFromClipboard()
                    if (clipCode.length == 16) {
                        creds = credentialStore.saveGmailConfig(senderEmail, clipCode)
                        runOnUiThread {
                            dispatchGmailConfigUpdatedToWeb(getNativeGmailConfigJson(), autoDetected = true)
                        }
                    }
                }

                val rawMime = mailSender.buildRawMimeMessage(
                    senderEmail = senderEmail,
                    recipientEmail = recipientEmail,
                    subject = subject,
                    bodyText = bodyText,
                    filename = filename,
                    base64Pdf = base64Pdf
                )

                // 1. Direktversand über TLS SMTP (smtp.gmail.com:465), falls App-Passwort hinterlegt
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
                            }.toString()
                            dispatchNativeCallback(requestId, true, res)
                        }
                        return@Thread
                    }
                }

                // 2. Direktversand über Gmail REST API mit aktivem OAuth-Token
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
                            }.toString()
                            dispatchNativeCallback(requestId, true, res)
                        }
                        return@Thread
                    } else if (apiOutcome.error?.contains("401") == true || apiOutcome.error?.contains("403") == true) {
                        credentialStore.saveGmailConfig(null, null, "")
                    }
                }

                // 3. Direktversand über gekoppeltes Infinity Cloud-Backend (/api/internal/send-invoice-mail)
                val relayOutcome = mailSender.sendViaBackendRelay(
                    baseUrl = creds.baseUrl,
                    deviceToken = creds.effectiveMcpToken,
                    recipientEmail = recipientEmail,
                    subject = subject,
                    bodyText = bodyText,
                    filename = filename,
                    base64Pdf = base64Pdf
                )
                if (relayOutcome.ok) {
                    runOnUiThread {
                        mailSender.showMailSentNotification(recipientEmail, invoiceNumber)
                        val res = JSONObject().apply {
                            put("ok", true)
                            put("method", "backend_relay")
                        }.toString()
                        dispatchNativeCallback(requestId, true, res)
                    }
                    return@Thread
                }

                // 4. Nativer Android AccountManager OAuth2-Versand über das auf dem Pixel 10 Pro angemeldete Google-Konto
                val pending = PendingMailSend(
                    requestId = requestId,
                    base64Pdf = base64Pdf,
                    filename = filename,
                    recipientEmail = recipientEmail,
                    subject = subject,
                    bodyText = bodyText,
                    invoiceNumber = invoiceNumber,
                    rawMimeMessage = rawMime,
                    selectedAccountName = senderEmail
                )
                pendingMailSend = pending

                val am = AccountManager.get(this)
                val visibleAccounts = am.getAccountsByType("com.google")
                val targetAccount = visibleAccounts.firstOrNull {
                    it.name.equals(senderEmail, ignoreCase = true)
                } ?: visibleAccounts.firstOrNull()

                if (targetAccount != null) {
                    requestAccountManagerTokenAndSend(pending, targetAccount, allowConsentIntent = true)
                } else {
                    runOnUiThread {
                        try {
                            @Suppress("DEPRECATION")
                            val chooseIntent = AccountManager.newChooseAccountIntent(
                                null,
                                null,
                                arrayOf("com.google"),
                                null,
                                null,
                                null,
                                null
                            )
                            gmailAccountPickerLauncher.launch(chooseIntent)
                        } catch (_: Exception) {
                            pendingMailSend = null
                            dispatchNativeCallback(
                                requestId,
                                false,
                                "APP_PASSWORD_REQUIRED:Einmalige Google-Verknüpfung erforderlich."
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

    private fun requestAccountManagerTokenAndSend(
        pending: PendingMailSend,
        account: Account,
        allowConsentIntent: Boolean = true
    ) {
        Thread {
            try {
                val am = AccountManager.get(this)
                val scope = "oauth2:https://www.googleapis.com/auth/gmail.send"
                val future = if (allowConsentIntent) {
                    am.getAuthToken(account, scope, null, this@MainActivity, null, null)
                } else {
                    am.getAuthToken(account, scope, null, false, null, null)
                }
                val bundle = future.result

                val consentIntent = if (Build.VERSION.SDK_INT >= 33) {
                    bundle.getParcelable(AccountManager.KEY_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    bundle.getParcelable(AccountManager.KEY_INTENT)
                }

                if (consentIntent != null && allowConsentIntent) {
                    runOnUiThread {
                        try {
                            gmailAuthConsentLauncher.launch(consentIntent)
                        } catch (_: Exception) {
                            pendingMailSend = null
                            dispatchNativeCallback(
                                pending.requestId,
                                false,
                                "APP_PASSWORD_REQUIRED:Einmalige Google-Verknüpfung erforderlich."
                            )
                        }
                    }
                    return@Thread
                }

                val token = bundle.getString(AccountManager.KEY_AUTHTOKEN)?.trim().orEmpty()
                if (token.isNotEmpty()) {
                    var outcome = mailSender.sendViaGmailRestApi(token, pending.rawMimeMessage)
                    if (!outcome.ok && (outcome.error?.contains("401") == true || outcome.error?.contains("403") == true)) {
                        am.invalidateAuthToken("com.google", token)
                        val retryBundle = am.getAuthToken(account, scope, null, false, null, null).result
                        val freshToken = retryBundle.getString(AccountManager.KEY_AUTHTOKEN)?.trim().orEmpty()
                        if (freshToken.isNotEmpty()) {
                            outcome = mailSender.sendViaGmailRestApi(freshToken, pending.rawMimeMessage)
                            if (outcome.ok) {
                                credentialStore.saveGmailConfig(account.name, null, freshToken)
                            }
                        }
                    } else if (outcome.ok) {
                        credentialStore.saveGmailConfig(account.name, null, token)
                    }

                    pendingMailSend = null
                    runOnUiThread {
                        if (outcome.ok) {
                            mailSender.showMailSentNotification(pending.recipientEmail, pending.invoiceNumber)
                            val res = JSONObject().apply {
                                put("ok", true)
                                put("method", "android_account_manager")
                            }.toString()
                            dispatchNativeCallback(pending.requestId, true, res)
                        } else {
                            dispatchNativeCallback(
                                pending.requestId,
                                false,
                                "APP_PASSWORD_REQUIRED:${outcome.error ?: "Einmalige Google-Verknüpfung erforderlich."}"
                            )
                        }
                    }
                } else {
                    pendingMailSend = null
                    runOnUiThread {
                        dispatchNativeCallback(
                            pending.requestId,
                            false,
                            "APP_PASSWORD_REQUIRED:Einmalige Google-Verknüpfung erforderlich."
                        )
                    }
                }
            } catch (_: Exception) {
                pendingMailSend = null
                runOnUiThread {
                    dispatchNativeCallback(
                        pending.requestId,
                        false,
                        "APP_PASSWORD_REQUIRED:Einmalige Google-Verknüpfung erforderlich."
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
