package at.hafner.gruenraum

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import at.hafner.gruenraum.bridge.PixelNativeBridge
import at.hafner.gruenraum.calendar.NativeCalendarReader
import at.hafner.gruenraum.documents.NativeDocumentManager
import at.hafner.gruenraum.storage.NativeStoreManager
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var storeManager: NativeStoreManager
    private lateinit var documentManager: NativeDocumentManager
    private lateinit var calendarReader: NativeCalendarReader
    private lateinit var inAppBackCallback: OnBackPressedCallback

    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null

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
    private var pendingBackupWrite: PendingBackupWrite? = null
    private var pendingRestoreRequestId: String? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.GetMultipleContents()
    ) { uris ->
        fileUploadCallback?.onReceiveValue(uris.toTypedArray())
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

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#F8F9FA"))
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            overScrollMode = WebView.OVER_SCROLL_NEVER
        }

        // Apply exact Pixel 10 Pro system-bar & keyboard (IME) insets natively
        ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
            val bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
            )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        setContentView(webView)

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
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileUploadCallback?.onReceiveValue(null)
                fileUploadCallback = filePathCallback
                val accept = fileChooserParams?.acceptTypes?.firstOrNull()
                    ?.takeIf { it.isNotBlank() } ?: "image/*"
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
                "mailto" -> Intent(Intent.ACTION_SENDTO, uri)
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

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
}
