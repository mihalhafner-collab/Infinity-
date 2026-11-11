package at.hafner.gruenraum.documents

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Base64
import androidx.core.content.FileProvider
import java.io.File

class NativeDocumentManager(private val context: Context) {

    fun decodeBase64(base64Data: String): ByteArray {
        val clean = base64Data.substringAfter("base64,", base64Data).trim()
        return Base64.decode(clean, Base64.DEFAULT)
    }

    fun writeSharedTempFile(base64Data: String, filename: String): Uri {
        val safeName = filename.replace(Regex("[^a-zA-Z0-9._äöüÄÖÜß-]"), "_")
            .ifBlank { "Dokument.pdf" }
        val sharedDir = File(context.cacheDir, "shared_docs").apply { mkdirs() }
        val outFile = File(sharedDir, safeName)
        outFile.writeBytes(decodeBase64(base64Data))
        return FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            outFile
        )
    }

    fun shareDocument(
        activityContext: Context,
        base64Data: String,
        filename: String,
        mimeType: String,
        subject: String,
        bodyText: String,
        channel: String,
        recipientEmail: String?
    ): Boolean {
        return try {
            val uri = writeSharedTempFile(base64Data, filename)
            val baseIntent = Intent(Intent.ACTION_SEND).apply {
                type = mimeType.ifBlank { "application/pdf" }
                putExtra(Intent.EXTRA_STREAM, uri)
                if (subject.isNotBlank()) {
                    putExtra(Intent.EXTRA_SUBJECT, subject)
                    putExtra(Intent.EXTRA_TITLE, subject)
                }
                if (bodyText.isNotBlank()) {
                    putExtra(Intent.EXTRA_TEXT, bodyText)
                }
                if (!recipientEmail.isNullOrBlank()) {
                    putExtra(Intent.EXTRA_EMAIL, arrayOf(recipientEmail.trim()))
                }
                clipData = ClipData.newRawUri(filename, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            val preferredPackage = when (channel.lowercase()) {
                "gmail" -> "com.google.android.gm"
                "whatsapp" -> "com.whatsapp"
                "sms", "rcs" -> "com.google.android.apps.messaging"
                else -> null
            }

            if (preferredPackage != null) {
                val targeted = Intent(baseIntent).setPackage(preferredPackage)
                if (targeted.resolveActivity(context.packageManager) != null) {
                    activityContext.startActivity(targeted)
                    return true
                }
                if (channel.lowercase() == "whatsapp") {
                    val waBusiness = Intent(baseIntent).setPackage("com.whatsapp.w4b")
                    if (waBusiness.resolveActivity(context.packageManager) != null) {
                        activityContext.startActivity(waBusiness)
                        return true
                    }
                }
            }

            val chooser = Intent.createChooser(baseIntent, subject.ifBlank { filename }).apply {
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activityContext.startActivity(chooser)
            true
        } catch (_: Exception) {
            false
        }
    }
}
