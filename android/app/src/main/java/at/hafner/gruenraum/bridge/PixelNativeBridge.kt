package at.hafner.gruenraum.bridge

import android.webkit.JavascriptInterface
import at.hafner.gruenraum.MainActivity
import at.hafner.gruenraum.documents.NativeDocumentManager
import at.hafner.gruenraum.storage.NativeStoreManager
import at.hafner.gruenraum.tunnel.PixelTunnelService

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
    fun getPixelTunnelStatusJson(): String {
        return PixelTunnelService.status(activity.applicationContext).toString()
    }

    @JavascriptInterface
    fun openPixelTunnelSetup(): Boolean {
        activity.runOnUiThread {
            activity.openPixelTunnelSetupActivity()
        }
        return true
    }

    @JavascriptInterface
    fun setPixelTunnelEnabled(enabled: Boolean): String {
        var result = PixelTunnelService.status(activity.applicationContext).toString()
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            try {
                result = activity.setPixelTunnelEnabledFromWeb(enabled)
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
        }
        return result
    }

    @JavascriptInterface
    fun setPixelTunnelWriteEnabled(writeEnabled: Boolean): String {
        var result = PixelTunnelService.status(activity.applicationContext).toString()
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            try {
                result = activity.setPixelTunnelWriteEnabledFromWeb(writeEnabled)
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
        }
        return result
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
    fun sendGmailAutomatically(
        requestId: String,
        base64Data: String,
        filename: String,
        recipientEmail: String,
        subject: String,
        bodyText: String,
        invoiceNumber: String,
        webAccessToken: String
    ) {
        activity.runOnUiThread {
            activity.requestSendGmailAutomatically(
                requestId = requestId,
                base64Pdf = base64Data,
                filename = filename,
                recipientEmail = recipientEmail,
                subject = subject,
                bodyText = bodyText,
                invoiceNumber = invoiceNumber,
                webAccessToken = webAccessToken
            )
        }
    }

    @JavascriptInterface
    fun notifyMailSent(recipientEmail: String, invoiceNumber: String): Boolean {
        activity.runOnUiThread {
            activity.showNativeMailSentNotification(recipientEmail, invoiceNumber)
        }
        return true
    }

    @JavascriptInterface
    fun getGmailConfigJson(): String {
        return activity.getNativeGmailConfigJson()
    }

    @JavascriptInterface
    fun signInWithGoogle(requestId: String) {
        activity.requestNativeGoogleSignIn(requestId, silentOnly = false)
    }

    @JavascriptInterface
    fun disconnectGmail(): String {
        return activity.disconnectNativeGmail()
    }

    @JavascriptInterface
    fun saveGmailAppPassword(senderEmail: String, appPassword: String): String {
        return activity.saveNativeGmailAppPassword(senderEmail, appPassword)
    }

    @JavascriptInterface
    fun pasteGmailAppPasswordFromClipboard(senderEmail: String): String {
        var result = activity.getNativeGmailConfigJson()
        val latch = java.util.concurrent.CountDownLatch(1)
        activity.runOnUiThread {
            try {
                result = activity.pasteAndSaveGmailAppPasswordFromClipboard(senderEmail)
            } finally {
                latch.countDown()
            }
        }
        try {
            latch.await(2, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) {
        }
        return result
    }

    @JavascriptInterface
    fun readDeviceCalendar(requestId: String, startDateIso: String, endDateIso: String) {
        activity.runOnUiThread {
            activity.requestCalendarEvents(requestId, startDateIso, endDateIso)
        }
    }

    @JavascriptInterface
    fun upsertDeviceCalendarEvent(requestId: String, payloadJson: String) {
        activity.runOnUiThread {
            activity.requestUpsertCalendarEvent(requestId, payloadJson)
        }
    }

    @JavascriptInterface
    fun deleteDeviceCalendarEvent(requestId: String, googleEventId: String) {
        activity.runOnUiThread {
            activity.requestDeleteCalendarEvent(requestId, googleEventId)
        }
    }

    @JavascriptInterface
    fun readDeviceLocation(requestId: String) {
        activity.runOnUiThread {
            activity.requestDeviceLocation(requestId)
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

    @JavascriptInterface
    fun setCanGoBackInApp(canGoBack: Boolean) {
        activity.runOnUiThread {
            activity.updateCanGoBackInApp(canGoBack)
        }
    }

    @JavascriptInterface
    fun onMcpInvoicePdfReady(callbackId: String, payloadJson: String) {
        MainActivity.completeMcpPdfCallback(callbackId, payloadJson)
    }
}
