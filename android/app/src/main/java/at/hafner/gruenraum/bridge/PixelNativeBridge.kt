package at.hafner.gruenraum.bridge

import android.webkit.JavascriptInterface
import at.hafner.gruenraum.MainActivity
import at.hafner.gruenraum.documents.NativeDocumentManager
import at.hafner.gruenraum.storage.NativeStoreManager

class PixelNativeBridge(
    private val activity: MainActivity,
    private val storeManager: NativeStoreManager,
    private val documentManager: NativeDocumentManager
) {

    @JavascriptInterface
    fun isNativeAndroid(): Boolean = true

    @JavascriptInterface
    fun getDeviceProfile(): String = "Google Pixel 10 Pro (Native Kotlin)"

    @JavascriptInterface
    fun loadStateJson(): String? {
        return storeManager.loadAppState()
    }

    @JavascriptInterface
    fun saveStateJson(json: String): Boolean {
        return storeManager.saveAppState(json)
    }

    @JavascriptInterface
    fun getBackupMetaJson(): String {
        return storeManager.getBackupMetaJson()
    }

    @JavascriptInterface
    fun saveDocumentToDevice(
        requestId: String,
        base64Data: String,
        filename: String,
        mimeType: String
    ) {
        activity.runOnUiThread {
            activity.requestSaveDocumentToDevice(requestId, base64Data, filename, mimeType)
        }
    }

    @JavascriptInterface
    fun shareDocument(
        base64Data: String,
        filename: String,
        mimeType: String,
        subject: String,
        bodyText: String,
        channel: String,
        recipientEmail: String
    ): Boolean {
        var launched = false
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            launched = documentManager.shareDocument(
                activityContext = activity,
                base64Data = base64Data,
                filename = filename,
                mimeType = mimeType,
                subject = subject,
                bodyText = bodyText,
                channel = channel,
                recipientEmail = recipientEmail.takeIf { it.isNotBlank() }
            )
            latch.countDown()
        }
        try {
            latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
        }
        return launched
    }

    @JavascriptInterface
    fun readDeviceCalendar(requestId: String, startDateIso: String, endDateIso: String) {
        activity.runOnUiThread {
            activity.requestCalendarEvents(requestId, startDateIso, endDateIso)
        }
    }

    @JavascriptInterface
    fun runVerifiedZipBackup(requestId: String, jsonPayload: String, forcePickTarget: Boolean) {
        activity.runOnUiThread {
            activity.requestVerifiedZipBackup(requestId, jsonPayload, forcePickTarget)
        }
    }

    @JavascriptInterface
    fun restoreVerifiedZipBackup(requestId: String, pickExternalFile: Boolean) {
        activity.runOnUiThread {
            activity.requestRestoreVerifiedZipBackup(requestId, pickExternalFile)
        }
    }

    @JavascriptInterface
    fun openExternalUrl(url: String): Boolean {
        activity.runOnUiThread {
            activity.launchExternalUri(url)
        }
        return true
    }
}
