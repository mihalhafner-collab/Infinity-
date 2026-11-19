package at.hafner.gruenraum.documents

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import android.widget.Toast
import androidx.core.content.ContextCompat
import at.hafner.gruenraum.MainActivity
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

class NativeMailSender(private val context: Context) {

    data class MailSendOutcome(
        val ok: Boolean,
        val method: String,
        val error: String? = null,
        val messageId: String? = null
    )

    fun sanitizeAttachmentFilename(filename: String): String {
        val safe = filename
            .replace("ä", "ae")
            .replace("ö", "oe")
            .replace("ü", "ue")
            .replace("Ä", "Ae")
            .replace("Ö", "Oe")
            .replace("Ü", "Ue")
            .replace("ß", "ss")
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
        return if (safe.endsWith(".pdf", ignoreCase = true)) safe else "$safe.pdf"
    }

    private fun wrapBase64(b64: String, lineLen: Int = 76): String {
        val clean = b64.replace("\r", "").replace("\n", "").trim()
        val sb = StringBuilder(clean.length + clean.length / lineLen * 2 + 8)
        var i = 0
        while (i < clean.length) {
            val end = minOf(i + lineLen, clean.length)
            sb.append(clean, i, end)
            if (end < clean.length) {
                sb.append("\r\n")
            }
            i = end
        }
        return sb.toString()
    }

    private fun encodeUtf8Base64SingleLine(text: String): String {
        return Base64.encodeToString(text.toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
    }

    fun buildRawMimeMessage(
        senderEmail: String,
        recipientEmail: String,
        subject: String,
        bodyText: String,
        filename: String,
        base64Pdf: String
    ): String {
        val cleanPdfB64 = base64Pdf.substringAfter("base64,", base64Pdf).trim()
        val wrappedPdfB64 = wrapBase64(cleanPdfB64)
        val wrappedBodyB64 = wrapBase64(encodeUtf8Base64SingleLine(bodyText))
        val encodedSubject = "=?UTF-8?B?${encodeUtf8Base64SingleLine(subject)}?="
        val safeFilename = sanitizeAttachmentFilename(filename)
        val boundary = "hafner_invoice_${System.currentTimeMillis().toString(36)}"
        val cleanFrom = senderEmail.trim().ifBlank { "mihalhafner@gmail.com" }
        val rfcMsgId = "<hafner-${System.currentTimeMillis()}@gruenraum.at>"

        val lines = listOf(
            "From: \"Hafner Gruenraum Handwerk\" <$cleanFrom>",
            "To: ${recipientEmail.trim()}",
            "Subject: $encodedSubject",
            "Message-ID: $rfcMsgId",
            "MIME-Version: 1.0",
            "Content-Type: multipart/mixed; boundary=\"$boundary\"",
            "",
            "--$boundary",
            "Content-Type: text/plain; charset=\"UTF-8\"",
            "Content-Transfer-Encoding: base64",
            "",
            wrappedBodyB64,
            "",
            "--$boundary",
            "Content-Type: application/pdf; name=\"$safeFilename\"",
            "Content-Disposition: attachment; filename=\"$safeFilename\"",
            "Content-Transfer-Encoding: base64",
            "",
            wrappedPdfB64,
            "--$boundary--",
            ""
        )
        return lines.joinToString("\r\n")
    }

    fun buildPlainTextMimeMessage(
        senderEmail: String,
        recipientEmail: String,
        subject: String,
        bodyText: String
    ): String {
        val wrappedBodyB64 = wrapBase64(encodeUtf8Base64SingleLine(bodyText))
        val encodedSubject = "=?UTF-8?B?${encodeUtf8Base64SingleLine(subject)}?="
        val cleanFrom = senderEmail.trim().ifBlank { "mihalhafner@gmail.com" }
        val rfcMsgId = "<hafner-${System.currentTimeMillis()}@gruenraum.at>"

        val lines = listOf(
            "From: \"Hafner Gruenraum Handwerk\" <$cleanFrom>",
            "To: ${recipientEmail.trim()}",
            "Subject: $encodedSubject",
            "Message-ID: $rfcMsgId",
            "MIME-Version: 1.0",
            "Content-Type: text/plain; charset=\"UTF-8\"",
            "Content-Transfer-Encoding: base64",
            "",
            wrappedBodyB64,
            ""
        )
        return lines.joinToString("\r\n")
    }

    /**
     * Sendet die E-Mail inkl. PDF direkt per Gmail REST API (OAuth2 Bearer Token).
     */
    fun sendViaGmailRestApi(
        oauthAccessToken: String,
        rawMimeMessage: String
    ): MailSendOutcome {
        val cleanToken = oauthAccessToken.trim()
        if (cleanToken.isEmpty()) {
            return MailSendOutcome(false, "gmail_api", "Kein OAuth-Token vorhanden.")
        }

        return try {
            val rawBase64Url = Base64.encodeToString(
                rawMimeMessage.toByteArray(Charsets.US_ASCII),
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
            )
            val payload = JSONObject().apply {
                put("raw", rawBase64Url)
            }.toString().toByteArray(Charsets.UTF_8)

            val url = URL("https://gmail.googleapis.com/gmail/v1/users/me/messages/send")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Authorization", "Bearer $cleanToken")
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
            }

            conn.outputStream.use { out ->
                out.write(payload)
                out.flush()
            }

            val code = conn.responseCode
            if (code in 200..299) {
                val respBody = runCatching {
                    conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                }.getOrDefault("")
                val apiMsgId = runCatching {
                    JSONObject(respBody).optString("id", "").trim()
                }.getOrDefault("").ifEmpty { "gmail-${System.currentTimeMillis()}" }
                MailSendOutcome(true, "gmail_api", null, apiMsgId)
            } else {
                val errBody = runCatching {
                    conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                }.getOrDefault("")
                MailSendOutcome(false, "gmail_api", "HTTP $code: $errBody")
            }
        } catch (e: Exception) {
            MailSendOutcome(false, "gmail_api", e.message ?: "Netzwerkfehler bei Gmail API.")
        }
    }

    /**
     * Sendet die E-Mail inkl. PDF direkt per TLS über smtp.gmail.com:465 (Google App-Passwort).
     */
    fun sendViaDirectGmailSmtp(
        senderEmail: String,
        appPassword: String,
        recipientEmail: String,
        rawMimeMessage: String
    ): MailSendOutcome {
        val cleanSender = senderEmail.trim().ifBlank { "mihalhafner@gmail.com" }
        val cleanPassword = appPassword.replace("\\s+".toRegex(), "")
        val cleanRecipient = recipientEmail.trim()

        if (cleanPassword.length < 8) {
            return MailSendOutcome(false, "smtp_tls", "Kein gültiges App-Passwort hinterlegt.")
        }

        val smtpHost = when {
            cleanSender.endsWith("@gmx.at", ignoreCase = true) ||
                cleanSender.endsWith("@gmx.de", ignoreCase = true) ||
                cleanSender.endsWith("@gmx.net", ignoreCase = true) -> "mail.gmx.net"
            else -> "smtp.gmail.com"
        }

        return try {
            val socketFactory = SSLSocketFactory.getDefault() as SSLSocketFactory
            (socketFactory.createSocket(smtpHost, 465) as SSLSocket).use { socket ->
                socket.soTimeout = 20000
                socket.startHandshake()

                val reader = BufferedReader(InputStreamReader(socket.inputStream, Charsets.UTF_8))
                val writer = BufferedWriter(OutputStreamWriter(socket.outputStream, Charsets.UTF_8))

                fun readSmtpResponse(): Pair<Int, String> {
                    val full = StringBuilder()
                    var code = -1
                    while (true) {
                        val line = reader.readLine() ?: break
                        full.append(line).append("\n")
                        if (line.length >= 3) {
                            code = line.substring(0, 3).toIntOrNull() ?: code
                        }
                        if (line.length < 4 || line[3] != '-') {
                            break
                        }
                    }
                    return code to full.toString().trim()
                }

                fun sendCommand(cmd: String, expectedPrefix: Int): Pair<Boolean, String> {
                    writer.write("$cmd\r\n")
                    writer.flush()
                    val (code, resp) = readSmtpResponse()
                    return (code / 100 == expectedPrefix) to "$code $resp"
                }

                // Server Greeting (220)
                val (greetCode, greetMsg) = readSmtpResponse()
                if (greetCode / 100 != 2) {
                    return MailSendOutcome(false, "smtp_tls", "SMTP-Greeting fehlgeschlagen: $greetMsg")
                }

                // EHLO
                val (ehloOk, ehloMsg) = sendCommand("EHLO pixel10pro.local", 2)
                if (!ehloOk) {
                    return MailSendOutcome(false, "smtp_tls", "SMTP EHLO fehlgeschlagen: $ehloMsg")
                }

                // AUTH PLAIN \0user\0password in Base64
                val authPlainBytes = "\u0000$cleanSender\u0000$cleanPassword".toByteArray(Charsets.UTF_8)
                val authPlainB64 = Base64.encodeToString(authPlainBytes, Base64.NO_WRAP)
                val (authOk, authMsg) = sendCommand("AUTH PLAIN $authPlainB64", 2)
                if (!authOk) {
                    return MailSendOutcome(false, "smtp_tls", "SMTP-Anmeldung fehlgeschlagen: $authMsg")
                }

                // MAIL FROM
                val (fromOk, fromMsg) = sendCommand("MAIL FROM:<$cleanSender>", 2)
                if (!fromOk) {
                    return MailSendOutcome(false, "smtp_tls", "MAIL FROM abgelehnt: $fromMsg")
                }

                // RCPT TO
                val (rcptOk, rcptMsg) = sendCommand("RCPT TO:<$cleanRecipient>", 2)
                if (!rcptOk) {
                    return MailSendOutcome(false, "smtp_tls", "Empfänger abgelehnt: $rcptMsg")
                }

                // DATA (354)
                val (dataOk, dataMsg) = sendCommand("DATA", 3)
                if (!dataOk) {
                    return MailSendOutcome(false, "smtp_tls", "DATA fehlgeschlagen: $dataMsg")
                }

                // Dot-stuffing according to RFC 5321
                val stuffedMime = rawMimeMessage
                    .split("\r\n")
                    .joinToString("\r\n") { line -> if (line.startsWith(".")) ".$line" else line }

                writer.write(stuffedMime)
                if (!stuffedMime.endsWith("\r\n")) {
                    writer.write("\r\n")
                }
                writer.write(".\r\n")
                writer.flush()

                val (sendCode, sendResp) = readSmtpResponse()
                runCatching { sendCommand("QUIT", 2) }

                if (sendCode / 100 == 2) {
                    MailSendOutcome(true, "smtp_tls", null, "smtp-${System.currentTimeMillis()}")
                } else {
                    MailSendOutcome(false, "smtp_tls", "SMTP-Versand abgelehnt ($sendCode): $sendResp")
                }
            }
        } catch (e: Exception) {
            MailSendOutcome(false, "smtp_tls", e.message ?: "SMTP-Verbindungsfehler.")
        }
    }

    /**
     * Sendet die E-Mail inkl. PDF über das gekoppelte Infinity Cloud-Backend (/api/internal/send-invoice-mail).
     */
    fun sendViaBackendRelay(
        baseUrl: String,
        deviceToken: String,
        recipientEmail: String,
        subject: String,
        bodyText: String,
        filename: String,
        base64Pdf: String
    ): MailSendOutcome {
        val cleanBase = baseUrl.trim().trimEnd('/')
        if (!cleanBase.startsWith("https://")) {
            return MailSendOutcome(false, "backend_relay", "Keine gültige Backend-URL.")
        }

        return try {
            val payload = JSONObject().apply {
                put("to", recipientEmail.trim())
                put("subject", subject)
                put("bodyText", bodyText)
                put("filename", sanitizeAttachmentFilename(filename))
                put("base64Pdf", base64Pdf.substringAfter("base64,", base64Pdf).trim())
            }.toString().toByteArray(Charsets.UTF_8)

            val url = URL("$cleanBase/api/internal/send-invoice-mail")
            val conn = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15000
                readTimeout = 20000
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                setRequestProperty("X-Device-Model", "Google Pixel 10 Pro")
                if (deviceToken.isNotBlank()) {
                    setRequestProperty("Authorization", "Bearer ${deviceToken.trim()}")
                }
            }

            conn.outputStream.use { out ->
                out.write(payload)
                out.flush()
            }

            val code = conn.responseCode
            if (code in 200..299) {
                val respBody = runCatching {
                    conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                }.getOrDefault("")
                val relayMsgId = runCatching {
                    JSONObject(respBody).optString("id", "").trim()
                }.getOrDefault("").ifEmpty { "relay-${System.currentTimeMillis()}" }
                MailSendOutcome(true, "backend_relay", null, relayMsgId)
            } else {
                val errBody = runCatching {
                    conn.errorStream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                }.getOrDefault("")
                MailSendOutcome(false, "backend_relay", "HTTP $code: $errBody")
            }
        } catch (e: Exception) {
            MailSendOutcome(false, "backend_relay", e.message ?: "Backend nicht erreichbar.")
        }
    }

    /**
     * Zeigt auf dem Google Pixel 10 Pro eine kurze, klare Erfolgs-Benachrichtigung
     * (sowohl als nativen Android-Toast als auch als System-Benachrichtigung).
     */
    fun showMailSentNotification(recipientEmail: String, invoiceNumber: String) {
        val cleanEmail = recipientEmail.trim()
        val cleanInv = invoiceNumber.trim().ifBlank { "Rechnung" }
        val toastText = "✓ E-Mail ($cleanInv) an $cleanEmail versendet"

        try {
            Toast.makeText(context, toastText, Toast.LENGTH_LONG).show()
        } catch (_: Exception) {
        }

        try {
            if (
                Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                    PackageManager.PERMISSION_GRANTED
            ) {
                return
            }

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val channelId = "hafner_invoice_mail_sent"
            val channel = NotificationChannel(
                channelId,
                "Rechnungsversand",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Kurzbenachrichtigung bei erfolgreichem PDF-Rechnungsversand"
            }
            nm.createNotificationChannel(channel)

            val openIntent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingOpen = PendingIntent.getActivity(
                context,
                9201,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val notification = Notification.Builder(context, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_email)
                .setContentTitle("Rechnung $cleanInv versendet")
                .setContentText("PDF-Rechnung automatisch an $cleanEmail gesendet")
                .setContentIntent(pendingOpen)
                .setAutoCancel(true)
                .setTimeoutAfter(6500L)
                .build()

            nm.notify(9201, notification)
        } catch (_: Exception) {
        }
    }
}
