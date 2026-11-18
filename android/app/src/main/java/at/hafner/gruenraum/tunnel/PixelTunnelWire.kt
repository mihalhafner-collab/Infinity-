package at.hafner.gruenraum.tunnel

import at.hafner.gruenraum.BuildConfig
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Collections
import java.util.LinkedHashMap
import java.util.Locale
import java.util.UUID
import java.util.regex.Pattern

/**
 * Direkter ausgehender HTTPS-Transport zu api.openai.com (/v1/tunnels/{id})
 * nach Gartenpirat-Referenz, angepasst auf Infinity und entkoppelt über Dispatcher.
 */
class PixelTunnelWire(
    private val id: String,
    private val transport: Transport,
    private val dispatcher: Dispatcher
) {
    fun interface Transport {
        @Throws(Exception::class)
        fun request(
            method: String,
            path: String,
            body: JSONObject?,
            shard: String?,
            timeoutMs: Int,
        ): Reply
    }

    fun interface Dispatcher {
        fun rpc(requestId: String, fingerprint: String, rpc: JSONObject): JSONObject?
    }

    class Reply(
        @JvmField val code: Int,
        @JvmField val json: JSONObject,
        @JvmField val receivedNanos: Long = System.nanoTime()
    )

    class AccessError(
        @JvmField val httpCode: Int,
        @JvmField val reason: String = "auth_denied"
    ) : IOException("Tunnel-ID oder Runtime-Berechtigung prüfen.") {

        fun userMessage(): String {
            return when (reason) {
                "organization_required" ->
                    "Die OpenAI-Organisationsangabe fehlt. Verbindungseinstellungen öffnen und die Organisation des Pixel-Tunnels bestätigen."
                "organization_mismatch" ->
                    "Der gespeicherte Schlüssel gehört zu einer anderen OpenAI-Organisation als der Pixel-Tunnel. Bitte einen Schlüssel aus der Organisation des Tunnels eingeben."
                "tunnel_access_denied" ->
                    "Der Schlüssel darf diesen Tunnel nicht verwenden. Im richtigen OpenAI-Konto Tunnels Read + Use prüfen."
                "invalid_api_key" ->
                    "OpenAI erkennt den gespeicherten Schlüssel nicht. Bitte den gültigen Runtime-Schlüssel erneut im privaten Einrichtungsfenster eingeben."
                else ->
                    "OpenAI verweigert die Tunnel-Anmeldung (HTTP $httpCode). Organisation, Schlüssel und Tunnels Read + Use prüfen."
            }
        }
    }

    class RateLimit(wait: Long) : IOException("Tunnel-Anfragen sind vorübergehend begrenzt.") {
        @JvmField
        val retryAfterMs: Long = Math.max(1000L, Math.min(900000L, wait))
    }

    private class Cached(
        @JvmField val fingerprint: String,
        @JvmField val response: JSONObject
    )

    private val results: MutableMap<String, Cached> =
        object : LinkedHashMap<String, Cached>() {
            override fun removeEldestEntry(e: MutableMap.MutableEntry<String, Cached>?): Boolean {
                return size > 128
            }
        }

    init {
        PixelTunnelConfig.validateId(id)
    }

    private fun path(suffix: String): String = "/v1/tunnels/$id$suffix"

    @Throws(Exception::class)
    fun verify() {
        check(transport.request("GET", path(""), null, null, 15000))
    }

    @Throws(Exception::class)
    fun cycle(): Int {
        val poll = transport.request("GET", path("/poll?limit=10&timeout_ms=25000"), null, null, 35000)
        check(poll)
        if (poll.code == 204) {
            return 0
        }
        val commands = poll.json.optJSONArray("commands") ?: return 0
        var delivered = 0
        for (i in 0 until commands.length()) {
            if (Thread.currentThread().isInterrupted) {
                throw InterruptedException()
            }
            val command = commands.getJSONObject(i)
            val expiry = deadline(command.opt("response_timeout"), poll.receivedNanos)
            if (expiry != Long.MAX_VALUE && System.nanoTime() >= expiry) {
                continue
            }
            val requestId = command.getString("request_id")
            val shard = command.getString("shard_token")
            if (
                requestId.isEmpty() ||
                requestId.length > 4096 ||
                shard.isEmpty() ||
                shard.length > 16384 ||
                shard.indexOf('\r') >= 0 ||
                shard.indexOf('\n') >= 0
            ) {
                throw IOException("Ungültige Tunnel-Antwort.")
            }
            val type = command.optString("command_type")
            val channel = command.optString("channel", "main")
            if (type != "jsonrpc" && type != "session_termination") {
                continue
            }
            val fingerprint = "$type\n$channel\n${canonical(command.optJSONObject("jsonrpc"))}"
            val cached = results[requestId]
            if (cached != null && cached.fingerprint != fingerprint) {
                throw IOException("Widersprüchliche Anfrage-ID. Verbindung wird erneut geprüft.")
            }
            var response = cached?.response
            if (response == null) {
                response = JSONObject().put("request_id", requestId).put("channel", channel)
                if (type == "session_termination") {
                    response.put("resp_code", 204).put("resp_type", "session_termination_response")
                } else {
                    val rpc = command.getJSONObject("jsonrpc")
                    val result: JSONObject? = if (channel != "main") {
                        JSONObject()
                            .put("jsonrpc", "2.0")
                            .put("id", rpc.opt("id") ?: JSONObject.NULL)
                            .put(
                                "error",
                                JSONObject()
                                    .put("code", -32601)
                                    .put("message", "Channel nicht unterstützt.")
                            )
                    } else {
                        dispatcher.rpc(requestId, fingerprint, rpc)
                    }
                    response
                        .put("resp_code", if (result == null) 202 else 200)
                        .put("resp_type", if (result == null) "notify_ack" else "jsonrpc_response")
                    if (result != null) {
                        response
                            .put("resp_json", result)
                            .put(
                                "resp_headers",
                                JSONObject().put("Content-Type", JSONArray().put("application/json"))
                            )
                    }
                }
                results[requestId] = Cached(fingerprint, response)
            }
            if (expiry != Long.MAX_VALUE && System.nanoTime() >= expiry) {
                continue
            }
            val timeout = if (expiry == Long.MAX_VALUE) {
                15000
            } else {
                Math.max(1L, Math.min(15000L, (expiry - System.nanoTime()) / 1000000L)).toInt()
            }
            check(transport.request("POST", path("/response"), response, shard, timeout))
            delivered++
        }
        return delivered
    }

    class HttpTransport(
        private val root: String,
        private val secret: String,
        test: Boolean = false,
        private val organization: String = ""
    ) : Transport {
        private val instance: String = UUID.randomUUID().toString()
        @Volatile
        private var active: HttpURLConnection? = null

        constructor(secret: String, organization: String = "") : this(
            "https://api.openai.com",
            secret,
            false,
            organization
        )

        init {
            if (
                root != "https://api.openai.com" &&
                !(test && root.matches(Regex("http://127\\.0\\.0\\.1:[0-9]{1,5}")))
            ) {
                throw IllegalArgumentException("Nicht erlaubtes Tunnel-Ziel.")
            }
            PixelTunnelConfig.validateOrganization(organization)
        }

        fun close() {
            active?.disconnect()
        }

        @Throws(Exception::class)
        override fun request(
            method: String,
            path: String,
            body: JSONObject?,
            shard: String?,
            timeoutMs: Int
        ): Reply {
            if (!path.startsWith("/v1/tunnels/") || path.contains("..")) {
                throw IOException("Ungültiger Tunnel-Pfad.")
            }
            val connection = URL(root + path).openConnection() as HttpURLConnection
            active = connection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = Math.min(timeoutMs, 15000)
                connection.readTimeout = timeoutMs
                connection.requestMethod = method
                connection.setRequestProperty("Authorization", "Bearer $secret")
                connection.setRequestProperty("Accept", "application/json")
                if (organization.isNotEmpty()) {
                    connection.setRequestProperty("OpenAI-Organization", organization)
                }
                connection.setRequestProperty("X-Tunnel-Client-Name", "infinity-android")
                connection.setRequestProperty("X-Tunnel-Client-Version", BuildConfig.VERSION_NAME)
                connection.setRequestProperty("X-Tunnel-Client-Instance-Id", instance)
                connection.setRequestProperty(
                    "X-Tunnel-MCP-Server-Info",
                    "{\"version\":1,\"channels\":[{\"name\":\"main\",\"proc_affinity\":true}]}"
                )
                if (shard != null) {
                    connection.setRequestProperty("X-Tunnel-Shard-Token", shard)
                }
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    val bytes = body.toString().toByteArray(StandardCharsets.UTF_8)
                    connection.setFixedLengthStreamingMode(bytes.size)
                    connection.outputStream.use { out -> out.write(bytes) }
                }
                val code = connection.responseCode
                val receipt = System.nanoTime()
                if (code == 204) {
                    return Reply(code, JSONObject(), receipt)
                }
                if (code < 200 || code >= 300) {
                    val safe = JSONObject()
                    if (code == 429) {
                        safe.put(
                            "retry_after_ms",
                            retryAfter(
                                connection.getHeaderField("Retry-After"),
                                System.currentTimeMillis()
                            )
                        )
                    }
                    if (code == 401 || code == 403) {
                        safe.put("access_reason", readAccessReason(connection))
                    }
                    return Reply(code, safe, receipt)
                }
                connection.inputStream.use { input ->
                    ByteArrayOutputStream().use { out ->
                        val buffer = ByteArray(8192)
                        var total = 0
                        while (true) {
                            val count = input.read(buffer)
                            if (count == -1) break
                            total += count
                            if (total > 2 * 1024 * 1024) {
                                throw IOException("Tunnel-Antwort zu groß.")
                            }
                            out.write(buffer, 0, count)
                        }
                        val value = String(out.toByteArray(), StandardCharsets.UTF_8)
                        return Reply(
                            code,
                            if (value.trim().isEmpty()) JSONObject() else JSONObject(value),
                            receipt
                        )
                    }
                }
            } finally {
                if (active === connection) {
                    active = null
                }
            }
        }

        companion object {
            @JvmStatic
            private fun readAccessReason(connection: HttpURLConnection): String {
                return try {
                    connection.errorStream.use { input ->
                        if (input == null) return "auth_denied"
                        ByteArrayOutputStream().use { out ->
                            val buffer = ByteArray(4096)
                            var total = 0
                            while (true) {
                                val count = input.read(buffer)
                                if (count == -1) break
                                total += count
                                if (total > 65536) return "auth_denied"
                                out.write(buffer, 0, count)
                            }
                            accessReason(JSONObject(String(out.toByteArray(), StandardCharsets.UTF_8)))
                        }
                    }
                } catch (_: Exception) {
                    "auth_denied"
                }
            }
        }
    }

    companion object {
        @JvmStatic
        fun retryAfter(value: String?, now: Long): Long {
            if (value == null) return 15000L
            return try {
                Math.max(
                    1000L,
                    Math.min(
                        900000L,
                        Math.multiplyExact( value.trim().toLong(), 1000L)
                    )
                )
            } catch (_: Exception) {
                try {
                    Math.max(
                        1000L,
                        Math.min(
                            900000L,
                            ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME)
                                .toInstant()
                                .toEpochMilli() - now
                        )
                    )
                } catch (_: Exception) {
                    15000L
                }
            }
        }

        @JvmStatic
        @Throws(Exception::class)
        private fun check(r: Reply) {
            if (r.code == 429) {
                throw RateLimit(r.json.optLong("retry_after_ms", 15000L))
            }
            if (r.code == 401 || r.code == 403) {
                throw AccessError(r.code, r.json.optString("access_reason", "auth_denied"))
            }
            if (r.code < 200 || r.code >= 300) {
                throw IOException("Tunnel vorübergehend nicht erreichbar (HTTP ${r.code}).")
            }
        }

        @JvmStatic
        fun deadline(timeout: Any?, receipt: Long): Long {
            if (timeout !is String || !timeout.matches(Regex("[0-9]+(?:ns|us|ms|s|m|h)"))) {
                return Long.MAX_VALUE
            }
            val m = Pattern.compile("([0-9]+)([a-z]+)").matcher(timeout)
            if (!m.matches()) return Long.MAX_VALUE
            return try {
                val amount = m.group(1)!!.toLong()
                val factor = when (m.group(2)) {
                    "ns" -> 1L
                    "us" -> 1000L
                    "ms" -> 1000000L
                    "s" -> 1000000000L
                    "m" -> 60000000000L
                    else -> 3600000000000L
                }
                Math.addExact(receipt, Math.multiplyExact(amount, factor))
            } catch (_: Exception) {
                Long.MAX_VALUE
            }
        }

        @JvmStatic
        @Throws(Exception::class)
        fun canonical(value: Any?): String {
            if (value is JSONObject) {
                val keys = ArrayList<String>()
                val iterator = value.keys()
                while (iterator.hasNext()) {
                    keys.add(iterator.next())
                }
                Collections.sort(keys)
                val out = StringBuilder("{")
                for (key in keys) {
                    out.append(JSONObject.quote(key))
                        .append(':')
                        .append(canonical(value.get(key)))
                        .append(',')
                }
                return out.append('}').toString()
            }
            if (value is JSONArray) {
                val out = StringBuilder("[")
                for (i in 0 until value.length()) {
                    out.append(canonical(value.get(i))).append(',')
                }
                return out.append(']').toString()
            }
            return if (value == null || value == JSONObject.NULL) {
                "null"
            } else if (value is String) {
                JSONObject.quote(value)
            } else {
                value.toString()
            }
        }

        @JvmStatic
        fun accessReason(json: JSONObject): String {
            val error = json.optJSONObject("error")
            var message = "${error?.optString("message") ?: ""} ${json.optString("detail")} ${json.optString("message")}"
            if (json.opt("error") is String) {
                message += " ${json.optString("error")}"
            }
            message = message.lowercase(Locale.ROOT)
            if (message.contains("openai-organization header should match organization for api key")) {
                return "organization_mismatch"
            }
            if (message.contains("requires an active organization context")) {
                return "organization_required"
            }
            if (message.contains("does not have permission to use this tunnel")) {
                return "tunnel_access_denied"
            }
            if (error != null && error.optString("code") == "invalid_api_key") {
                return "invalid_api_key"
            }
            return "auth_denied"
        }
    }
}
