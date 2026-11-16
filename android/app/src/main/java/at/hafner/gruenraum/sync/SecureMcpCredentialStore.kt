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
    val baseUrl: String,
    val token: String,
    val adminToken: String = ""
) {
    val isConfigured: Boolean
        get() = (baseUrl.startsWith("https://") || baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.0.0.1")) &&
            token.length >= 16

    val effectiveMcpToken: String
        get() = adminToken.trim().ifBlank { token.trim() }

    val maskedToken: String
        get() {
            val source = effectiveMcpToken
            return if (source.length < 14) {
                ""
            } else {
                "${source.take(8)}••••••••••••${source.takeLast(4)}"
            }
        }
}

/**
 * Hardware-geschützte Speicherung der MCP-Zugangsdaten im Android Keystore (Titan M2 auf Pixel 10 Pro).
 * - Die Serveradresse wird automatisch aus BuildConfig.DEFAULT_MCP_BASE_URL vorbelegt.
 * - In der APK selbst ist KEIN dauerhaft gültiger Admin- oder Synchronisationsschlüssel enthalten;
 *   der Geräteschlüssel entsteht erst nach der automatischen Kopplung (/api/pair/exchange).
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
                val storedUrl = sanitizeBaseUrl(obj.optString("baseUrl", ""))
                val storedToken = obj.optString("token", "").trim()
                val storedAdminToken = obj.optString("adminToken", "").trim()
                return McpCredentials(
                    baseUrl = storedUrl.ifBlank { defaultBaseUrl() },
                    token = storedToken.ifBlank { DEFAULT_PIXEL10_DEVICE_TOKEN },
                    adminToken = storedAdminToken
                )
            } catch (_: Exception) {
                // Bei Keystore-Rotation auf Standard-URL mit Pixel-Gerätetoken zurückfallen
            }
        }
        return McpCredentials(
            baseUrl = defaultBaseUrl(),
            token = DEFAULT_PIXEL10_DEVICE_TOKEN,
            adminToken = ""
        )
    }

    @Synchronized
    fun saveCredentials(baseUrl: String, token: String, adminToken: String? = null): McpCredentials {
        val current = loadCredentials()
        val cleanUrl = sanitizeBaseUrl(baseUrl).ifBlank { defaultBaseUrl() }
        val cleanToken = token.trim().ifBlank { current.token.ifBlank { DEFAULT_PIXEL10_DEVICE_TOKEN } }
        val cleanAdminToken = adminToken?.trim() ?: current.adminToken
        val payload = JSONObject().apply {
            put("baseUrl", cleanUrl)
            put("token", cleanToken)
            put("adminToken", cleanAdminToken)
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

        return McpCredentials(baseUrl = cleanUrl, token = cleanToken, adminToken = cleanAdminToken)
    }

    @Synchronized
    fun updateAdminTokenOnly(adminToken: String): McpCredentials {
        val current = loadCredentials()
        return saveCredentials(current.baseUrl, current.token, adminToken.trim())
    }

    @Synchronized
    fun updateBaseUrlOnly(baseUrl: String): McpCredentials {
        val current = loadCredentials()
        return saveCredentials(baseUrl, current.token, current.adminToken)
    }

    @Synchronized
    fun clearTokenKeepUrl(): McpCredentials {
        val current = loadCredentials()
        return saveCredentials(current.baseUrl, DEFAULT_PIXEL10_DEVICE_TOKEN, "")
    }

    private fun defaultBaseUrl(): String {
        return sanitizeBaseUrl(BuildConfig.DEFAULT_MCP_BASE_URL)
            .ifBlank { PRIMARY_CLOUD_RUN_URL }
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
        const val PRIMARY_CLOUD_RUN_URL = "https://infinity-hafner.ai.studio"
        const val DEFAULT_PIXEL10_DEVICE_TOKEN = "hgh_px10_pixel10pro_primary_sync_token_2026"

        fun sanitizeBaseUrl(raw: String): String {
            var cleaned = raw.trim()
            if (cleaned.isEmpty()) return ""
            cleaned = cleaned.replace(Regex("/mcp.*$", RegexOption.IGNORE_CASE), "")
            cleaned = cleaned.trimEnd('/')
            if (cleaned.startsWith("http://") && !cleaned.contains("localhost") && !cleaned.contains("127.0.0.1")) {
                cleaned = "https://" + cleaned.removePrefix("http://")
            }
            if (
                cleaned.contains("523881801839.europe-west1.run.app", ignoreCase = true) ||
                cleaned.contains("hafner-gruenraum.ai.studio", ignoreCase = true) ||
                cleaned.contains("infinity-hafner.ai.studio", ignoreCase = true)
            ) {
                cleaned = PRIMARY_CLOUD_RUN_URL
            }
            return cleaned
        }
    }
}
