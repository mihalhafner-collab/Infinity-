package at.hafner.gruenraum.tunnel

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.IOException
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Hardware-geschützte Speicherung der direkten OpenAI-Pixel-Tunnel-Zugangsdaten
 * im Android Keystore für die Infinity-App.
 * Der Runtime-Schlüssel verlässt niemals den nativen Android-Code und wird
 * niemals an WebView / JavaScript weitergegeben.
 */
class PixelTunnelConfig(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore")
        store.load(null)
        if (!store.containsAlias(ALIAS)) {
            val generator =
                KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(
                    ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
                )
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build()
            )
            generator.generateKey()
        }
        return store.getKey(ALIAS, null) as SecretKey
    }

    @Synchronized
    @Throws(Exception::class)
    fun save(id: String, secret: String?) {
        save(id, organization(), secret)
    }

    @Synchronized
    @Throws(Exception::class)
    fun save(id: String, organization: String?, secret: String?) {
        val cleanId = id.trim()
        val cleanOrg = organization?.trim() ?: ""
        validateId(cleanId)
        validateOrganization(cleanOrg)
        if (
            secret == null ||
            secret.length < 20 ||
            secret.length > 4096 ||
            secret.matches(Regex("(?s).*\\s.*"))
        ) {
            throw IllegalArgumentException("Bitte den Runtime-Schlüssel vollständig eingeben.")
        }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ciphertext = cipher.doFinal(secret.toByteArray(Charsets.UTF_8))
        if (
            !prefs
                .edit()
                .putString("id", cleanId)
                .putString("organization", cleanOrg)
                .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString("secret", Base64.encodeToString(ciphertext, Base64.NO_WRAP))
                .commit()
        ) {
            throw IOException("Die Verbindungseinstellungen konnten nicht gespeichert werden.")
        }
    }

    fun id(): String = prefs.getString("id", "") ?: ""

    fun maskedId(): String {
        val raw = id().trim()
        if (raw.length < 16) return raw
        return "${raw.take(11)}••••${raw.takeLast(6)}"
    }

    fun organization(): String = prefs.getString("organization", "") ?: ""

    @SuppressLint("ApplySharedPref")
    fun organization(value: String?) {
        val cleanOrg = value?.trim() ?: ""
        validateOrganization(cleanOrg)
        if (!prefs.edit().putString("organization", cleanOrg).commit()) {
            throw IllegalStateException("Die Organisationsangabe konnte nicht gespeichert werden.")
        }
    }

    fun configured(): Boolean =
        id().isNotEmpty() && !(prefs.getString("secret", "") ?: "").isEmpty()

    @Throws(Exception::class)
    internal fun secret(): String {
        validateId(id())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            key(),
            GCMParameterSpec(128, Base64.decode(prefs.getString("iv", ""), Base64.NO_WRAP)),
        )
        return String(
            cipher.doFinal(Base64.decode(prefs.getString("secret", ""), Base64.NO_WRAP)),
            Charsets.UTF_8,
        )
    }

    fun enabled(): Boolean = prefs.getBoolean("enabled", false)

    fun writeEnabled(): Boolean = prefs.getBoolean("infinity_write_enabled", true)

    @SuppressLint("ApplySharedPref")
    fun writeEnabled(value: Boolean) {
        if (!prefs.edit().putBoolean("infinity_write_enabled", value).commit()) {
            throw IllegalStateException("Die Schreibfreigabe konnte nicht gespeichert werden.")
        }
    }

    @SuppressLint("ApplySharedPref")
    fun enabled(value: Boolean) {
        if (!prefs.edit().putBoolean("enabled", value).commit()) {
            throw IllegalStateException("Die Verbindungsfreigabe konnte nicht gespeichert werden.")
        }
    }

    fun bindingHash(): String = sha256Hex("${id()}\n${organization()}")

    companion object {
        private const val ALIAS = "infinity_pixel_tunnel_v1"
        const val PREFS = "infinity_pixel_tunnel_private"
        const val STATUS_PREFS = "infinity_pixel_tunnel_status"

        @JvmStatic
        fun validateId(id: String) {
            if (!id.matches(Regex("tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}"))) {
                throw IllegalArgumentException(
                    "Bitte die vollständige private Tunnel-ID im Format tunnel_… eingeben."
                )
            }
        }

        @JvmStatic
        fun validateOrganization(organization: String?) {
            if (
                organization == null ||
                (organization.isNotEmpty() && !organization.matches(Regex("org-[a-zA-Z0-9]{4,64}")))
            ) {
                throw IllegalArgumentException(
                    "Bitte die OpenAI-Organisations-ID im Format org-… eingeben (oder leer lassen)."
                )
            }
        }

        @JvmStatic
        fun sha256Hex(input: String): String {
            val digest = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
            return digest.joinToString("") { "%02x".format(it) }
        }
    }
}
