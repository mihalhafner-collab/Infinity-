package at.hafner.gruenraum.sync

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import at.hafner.gruenraum.BuildConfig
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class McpCredentials(
    val gmailSenderEmail: String = SecureMcpCredentialStore.DEFAULT_GMAIL_SENDER,
    val gmailAppPassword: String = "",
    val gmailOAuthToken: String = ""
) {
    val effectiveGmailAppPassword: String
        get() = gmailAppPassword.replace("\\s+".toRegex(), "").ifBlank {
            BuildConfig.DEFAULT_GMAIL_APP_PASSWORD.replace("\\s+".toRegex(), "")
        }
}

/**
 * Hardware-geschützte Speicherung der Gmail-Versandzugangsdaten im Android Keystore (Titan M2 auf Pixel 10 Pro).
 */
class SecureMcpCredentialStore(private val context: Context) {

    private val encryptedFile = File(context.noBackupFilesDir, "mcp_credentials_v1.enc")

    @Synchronized
    fun loadCredentials(): McpCredentials {
        if (encryptedFile.exists() && encryptedFile.length() > IV_LENGTH_BYTES) {
            try {
                val raw = encryptedFile.readBytes()
                val iv = raw.copyOfRange(0, IV_LENGTH_BYTES)
                val ciphertext = raw.copyOfRange(IV_LENGTH_BYTES, raw.size)
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
                val jsonStr = cipher.doFinal(ciphertext).toString(Charsets.UTF_8)
                val obj = JSONObject(jsonStr)
                val storedGmailSender = obj.optString("gmailSenderEmail", "").trim().ifBlank { DEFAULT_GMAIL_SENDER }
                val storedGmailAppPwd = obj.optString("gmailAppPassword", "").trim()
                val storedGmailOAuth = obj.optString("gmailOAuthToken", "").trim()
                return McpCredentials(
                    gmailSenderEmail = storedGmailSender,
                    gmailAppPassword = storedGmailAppPwd,
                    gmailOAuthToken = storedGmailOAuth
                )
            } catch (_: Exception) {
                // Fallback auf Standard-Absender bei Keystore-Rotation
            }
        }
        return McpCredentials()
    }

    @Synchronized
    fun saveGmailConfig(senderEmail: String?, appPassword: String?, oauthToken: String? = null): McpCredentials {
        val current = loadCredentials()
        val cleanGmailSender = senderEmail?.trim()?.ifBlank { DEFAULT_GMAIL_SENDER } ?: current.gmailSenderEmail
        val cleanGmailAppPwd = appPassword?.replace("\\s+".toRegex(), "") ?: current.gmailAppPassword
        val cleanGmailOAuth = oauthToken?.trim() ?: current.gmailOAuthToken

        val payload = JSONObject().apply {
            put("gmailSenderEmail", cleanGmailSender)
            put("gmailAppPassword", cleanGmailAppPwd)
            put("gmailOAuthToken", cleanGmailOAuth)
        }.toString().toByteArray(Charsets.UTF_8)

        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
        val iv = cipher.iv
        val ciphertext = cipher.doFinal(payload)

        val outBytes = ByteArray(iv.size + ciphertext.size)
        System.arraycopy(iv, 0, outBytes, 0, iv.size)
        System.arraycopy(ciphertext, 0, outBytes, iv.size, ciphertext.size)

        val tmpFile = File(context.noBackupFilesDir, "mcp_credentials_v1.enc.tmp")
        tmpFile.writeBytes(outBytes)
        if (!tmpFile.renameTo(encryptedFile)) {
            tmpFile.copyTo(encryptedFile, overwrite = true)
            tmpFile.delete()
        }

        return McpCredentials(
            gmailSenderEmail = cleanGmailSender,
            gmailAppPassword = cleanGmailAppPwd,
            gmailOAuthToken = cleanGmailOAuth
        )
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) {
            return existing.secretKey
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            ANDROID_KEYSTORE
        )
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    companion object {
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "hafner_pixel10pro_mcp_aes_key"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH_BYTES = 12
        private const val GCM_TAG_BITS = 128
        const val DEFAULT_GMAIL_SENDER = "mihalhafner@gmail.com"
    }
}
