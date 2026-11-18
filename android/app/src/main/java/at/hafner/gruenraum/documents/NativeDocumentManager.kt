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

    fun normalizeWhatsAppDigits(rawPhone: String?): String {
        val raw = rawPhone?.trim().orEmpty()
        if (raw.isEmpty() || raw.contains("@")) return ""
        val stripped = raw.replace(Regex("[\\s\\-()/]"), "")
        if (stripped.isEmpty()) return ""
        val e164 = when {
            stripped.startsWith("00") -> "+${stripped.drop(2)}"
            stripped.startsWith("0") -> "+43${stripped.drop(1)}"
            !stripped.startsWith("+") -> "+$stripped"
            else -> stripped
        }
        return e164.replace(Regex("\\D"), "")
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
            val cleanChannel = channel.lowercase().trim()
            val targetStr = recipientEmail?.trim().orEmpty()

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
                if (targetStr.isNotEmpty() && targetStr.contains("@")) {
                    putExtra(Intent.EXTRA_EMAIL, arrayOf(targetStr))
                }
                clipData = ClipData.newRawUri(filename, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            if (cleanChannel == "whatsapp") {
                val waDigits = normalizeWhatsAppDigits(targetStr)
                for (waPkg in listOf("com.whatsapp", "com.whatsapp.w4b")) {
                    runCatching {
                        context.grantUriPermission(
                            waPkg,
                            uri,
                            Intent.FLAG_GRANT_READ_URI_PERMISSION
                        )
                    }
                    // 1. Direkt in den WhatsApp-Chat des Empfängers springen (mit angehängtem Original-PDF + Begleittext)
                    if (waDigits.length >= 6) {
                        val directChatIntent = Intent(baseIntent).apply {
                            setPackage(waPkg)
                            putExtra("jid", "$waDigits@s.whatsapp.net")
                        }
                        if (directChatIntent.resolveActivity(context.packageManager) != null) {
                            val openedDirect = runCatching {
                                activityContext.startActivity(directChatIntent)
                                true
                            }.getOrDefault(false)
                            if (openedDirect) return true
                        }
                    }
                    // 2. Fallback: WhatsApp direkt öffnen (falls keine Nummer hinterlegt ist)
                    val pkgIntent = Intent(baseIntent).setPackage(waPkg)
                    if (pkgIntent.resolveActivity(context.packageManager) != null) {
                        val openedPkg = runCatching {
                            activityContext.startActivity(pkgIntent)
                            true
                        }.getOrDefault(false)
                        if (openedPkg) return true
                    }
                }
            }

            val preferredPackage = when (cleanChannel) {
                "gmail" -> "com.google.android.gm"
                "sms", "rcs" -> "com.google.android.apps.messaging"
                else -> null
            }

            if (preferredPackage != null) {
                runCatching {
                    context.grantUriPermission(
                        preferredPackage,
                        uri,
                        Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                }
                val targeted = Intent(baseIntent).setPackage(preferredPackage).apply {
                    if ((cleanChannel == "sms" || cleanChannel == "rcs") && targetStr.isNotEmpty() && !targetStr.contains("@")) {
                        putExtra("address", targetStr)
                    }
                }
                if (targeted.resolveActivity(context.packageManager) != null) {
                    val opened = runCatching {
                        activityContext.startActivity(targeted)
                        true
                    }.getOrDefault(false)
                    if (opened) return true
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
