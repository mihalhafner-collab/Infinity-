package at.hafner.gruenraum.tunnel

import android.content.Context
import at.hafner.gruenraum.BuildConfig
import at.hafner.gruenraum.storage.ConflictingRequestException
import at.hafner.gruenraum.storage.NativeStoreManager
import at.hafner.gruenraum.storage.StaleRevisionException
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Nativer MCP-JSON-RPC-Dispatcher für den direkten OpenAI-Pixel-Tunnel in Infinity.
 * Arbeitet direkt mit NativeStoreManager (atomare JSON-Speicherung, Revisionsprüfung
 * und dauerhafte Wiederholungsbelege) auch bei geschlossener Oberfläche.
 */
class InfinityMcpDispatcher(
    private val context: Context,
    private val storeManager: NativeStoreManager,
    private val isWriteEnabled: () -> Boolean
) : PixelTunnelWire.Dispatcher {

    override fun rpc(requestId: String, fingerprint: String, rpc: JSONObject): JSONObject? {
        val isNotification = !rpc.has("id")
        val idVal = if (rpc.has("id")) rpc.opt("id") else JSONObject.NULL
        val method = rpc.optString("method", "").trim()
        val params = rpc.optJSONObject("params") ?: JSONObject()

        if (method.isEmpty()) {
            return errorResponse(idVal, -32600, "Invalid Request: 'method' fehlt.")
        }
        if (method.startsWith("notifications/")) {
            return null
        }

        return try {
            when (method) {
                "initialize" -> {
                    val requestedVersion = params.optString("protocolVersion", "2025-03-26")
                    val negotiated = if (SUPPORTED_VERSIONS.contains(requestedVersion)) {
                        requestedVersion
                    } else {
                        "2025-03-26"
                    }
                    val result = JSONObject()
                        .put("protocolVersion", negotiated)
                        .put(
                            "capabilities",
                            JSONObject()
                                .put("tools", JSONObject().put("listChanged", false))
                                .put(
                                    "resources",
                                    JSONObject().put("subscribe", false).put("listChanged", false)
                                )
                                .put("prompts", JSONObject().put("listChanged", false))
                        )
                        .put(
                            "serverInfo",
                            JSONObject()
                                .put("name", "infinity-pixel-tunnel")
                                .put("version", BuildConfig.VERSION_NAME)
                        )
                        .put(
                            "instructions",
                            "Direkter privater OpenAI-Pixel-Tunnel auf dem Google Pixel 10 Pro (App: Infinity · Hafner Michael – Grünraum Handwerk, Paket: at.hafner.gruenraum). Nutze infinity_status für Status/Revisionsprüfung, pixel_abfrage für Lesezugriffe (Übersicht, Kundensuche, Einzeldatensätze, GuV), pixel_aktion für Schreibvorgänge (Anlegen, Ändern, Löschen, L.C.R., Wartung) und pixel_abrechnung für Rechnungen (RE-75/2026), Zahlungen und Storno."
                        )
                    okResponse(idVal, result)
                }

                "ping" -> okResponse(idVal, JSONObject())

                "tools/list" -> okResponse(idVal, JSONObject().put("tools", buildToolsList()))

                "tools/call" -> {
                    val toolName = params.optString("name", "").trim()
                    val toolArgs = params.optJSONObject("arguments") ?: JSONObject()
                    try {
                        val output = executeTool(requestId, fingerprint, toolName, toolArgs)
                        okResponse(
                            idVal,
                            JSONObject()
                                .put(
                                    "content",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("type", "text")
                                            .put("text", output.toString())
                                    )
                                )
                                .put("isError", false)
                        )
                    } catch (e: WriteDisabledException) {
                        okResponse(
                            idVal,
                            JSONObject()
                                .put(
                                    "content",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("type", "text")
                                            .put(
                                                "text",
                                                JSONObject()
                                                    .put("error", e.message)
                                                    .put("code", "WRITE_DISABLED")
                                                    .toString()
                                            )
                                    )
                                )
                                .put("isError", true)
                        )
                    } catch (e: ConflictingRequestException) {
                        okResponse(
                            idVal,
                            JSONObject()
                                .put(
                                    "content",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("type", "text")
                                            .put(
                                                "text",
                                                JSONObject()
                                                    .put("error", e.message)
                                                    .put("code", "CONFLICTING_REQUEST_ID")
                                                    .toString()
                                            )
                                    )
                                )
                                .put("isError", true)
                        )
                    } catch (e: StaleRevisionException) {
                        okResponse(
                            idVal,
                            JSONObject()
                                .put(
                                    "content",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("type", "text")
                                            .put(
                                                "text",
                                                JSONObject()
                                                    .put("error", e.message)
                                                    .put("code", "REVISION_CONFLICT")
                                                    .put("currentRevision", storeManager.getLocalRevision())
                                                    .toString()
                                            )
                                    )
                                )
                                .put("isError", true)
                        )
                    } catch (e: Exception) {
                        okResponse(
                            idVal,
                            JSONObject()
                                .put(
                                    "content",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("type", "text")
                                            .put(
                                                "text",
                                                JSONObject()
                                                    .put("error", e.message ?: "Werkzeugfehler")
                                                    .toString()
                                            )
                                    )
                                )
                                .put("isError", true)
                        )
                    }
                }

                "resources/list" -> {
                    val resources = JSONArray()
                    resources.put(
                        JSONObject()
                            .put("uri", "app://state/overview")
                            .put("name", "Infinity Betriebsübersicht & Status")
                            .put("mimeType", "application/json")
                            .put("description", "Aktueller Datenbestand, Revision und Kennzahlen.")
                    )
                    for (col in NativeStoreManager.COLLECTION_KEYS) {
                        resources.put(
                            JSONObject()
                                .put("uri", "app://collection/$col")
                                .put("name", "Collection: $col")
                                .put("mimeType", "application/json")
                                .put("description", "Einträge aus $col")
                        )
                    }
                    okResponse(idVal, JSONObject().put("resources", resources))
                }

                "resources/templates/list" ->
                    okResponse(idVal, JSONObject().put("resourceTemplates", JSONArray()))

                "resources/read" -> {
                    val uri = params.optString("uri", "")
                    if (uri == "app://state/overview") {
                        val overview = buildOverview(storeManager.loadOrInitStateObject())
                        okResponse(
                            idVal,
                            JSONObject().put(
                                "contents",
                                JSONArray().put(
                                    JSONObject()
                                        .put("uri", uri)
                                        .put("mimeType", "application/json")
                                        .put("text", overview.toString(2))
                                )
                            )
                        )
                    } else if (uri.startsWith("app://collection/")) {
                        val col = uri.removePrefix("app://collection/")
                        if (NativeStoreManager.COLLECTION_KEYS.contains(col)) {
                            val data = queryCollection(
                                storeManager.loadOrInitStateObject(),
                                JSONObject().put("collection", col).put("limit", 100)
                            )
                            okResponse(
                                idVal,
                                JSONObject().put(
                                    "contents",
                                    JSONArray().put(
                                        JSONObject()
                                            .put("uri", uri)
                                            .put("mimeType", "application/json")
                                            .put("text", data.toString(2))
                                    )
                                )
                            )
                        } else {
                            errorResponse(idVal, -32602, "Unbekannte Collection-URI: $uri")
                        }
                    } else {
                        errorResponse(idVal, -32602, "Unbekannte Resource-URI: $uri")
                    }
                }

                "prompts/list" -> okResponse(idVal, JSONObject().put("prompts", JSONArray()))

                else -> {
                    if (isNotification) null
                    else errorResponse(idVal, -32601, "Methode nicht gefunden: $method")
                }
            }
        } catch (e: Exception) {
            errorResponse(idVal, -32603, e.message ?: "Interner MCP-Fehler")
        }
    }

    private fun executeTool(
        tunnelRequestId: String,
        tunnelFingerprint: String,
        name: String,
        args: JSONObject
    ): JSONObject {
        return when (name) {
            "infinity_status" -> buildStatusPayload(storeManager.loadOrInitStateObject())

            "pixel_abfrage" -> executePixelQuery(args)

            "admin_get_overview" -> buildOverview(storeManager.loadOrInitStateObject())

            "admin_read_records" -> queryCollection(storeManager.loadOrInitStateObject(), args)

            "admin_calculate_guv" -> {
                val year = if (args.has("year")) args.optInt("year", 2026) else null
                calculateGuv(storeManager.loadOrInitStateObject(), year)
            }

            "pixel_aktion",
            "admin_upsert_record",
            "admin_delete_record",
            "admin_toggle_lcr",
            "admin_record_maintenance",
            "admin_update_tax_settings",
            "admin_batch_mutate" -> {
                assertWritePermitted()
                val normalizedArgs = normalizeLegacyActionArgs(name, args)
                val effectiveReqId = normalizedArgs.optString("request_id", "").trim()
                    .ifEmpty { tunnelRequestId }
                val effectiveFp =
                    "$name\n${PixelTunnelWire.canonical(normalizedArgsWithoutRequestId(normalizedArgs))}"
                val expectedRev = if (normalizedArgs.has("expected_revision") && !normalizedArgs.isNull("expected_revision")) {
                    normalizedArgs.optInt("expected_revision", -1).takeIf { it >= 0 }
                } else null
                val opLabel = normalizedArgs.optString("op", "upsert")
                val colLabel = normalizedArgs.optString("collection", "batch")
                storeManager.executeTunnelMutation(
                    requestId = effectiveReqId,
                    fingerprint = effectiveFp.ifEmpty { tunnelFingerprint },
                    expectedRevision = expectedRev,
                    summary = "Pixel-Tunnel: $opLabel ($colLabel)"
                ) { stateObj, _ ->
                    applyPixelActionMutation(stateObj, normalizedArgs)
                }
            }

            "pixel_abrechnung",
            "admin_create_invoice",
            "admin_pay_invoice",
            "admin_storno_invoice" -> {
                assertWritePermitted()
                val normalizedArgs = normalizeLegacyBillingArgs(name, args)
                val effectiveReqId = normalizedArgs.optString("request_id", "").trim()
                    .ifEmpty { tunnelRequestId }
                val effectiveFp =
                    "$name\n${PixelTunnelWire.canonical(normalizedArgsWithoutRequestId(normalizedArgs))}"
                val expectedRev = if (normalizedArgs.has("expected_revision") && !normalizedArgs.isNull("expected_revision")) {
                    normalizedArgs.optInt("expected_revision", -1).takeIf { it >= 0 }
                } else null
                val actLabel = normalizedArgs.optString("action", "create_invoice")
                storeManager.executeTunnelMutation(
                    requestId = effectiveReqId,
                    fingerprint = effectiveFp.ifEmpty { tunnelFingerprint },
                    expectedRevision = expectedRev,
                    summary = "Pixel-Tunnel Abrechnung: $actLabel"
                ) { stateObj, _ ->
                    applyPixelBillingMutation(stateObj, normalizedArgs)
                }
            }

            else -> throw IllegalArgumentException("Unbekanntes MCP-Werkzeug '$name'.")
        }
    }

    private fun assertWritePermitted() {
        if (!isWriteEnabled()) {
            throw WriteDisabledException(
                "Schreibzugriff ist am Pixel 10 Pro deaktiviert. Bitte in der Infinity-App unter ChatGPT-Tunnel die Option 'ChatGPT darf Daten ändern' einschalten."
            )
        }
    }

    private fun normalizedArgsWithoutRequestId(args: JSONObject): JSONObject {
        val copy = JSONObject(args.toString())
        copy.remove("request_id")
        return copy
    }

    private fun normalizeLegacyActionArgs(toolName: String, args: JSONObject): JSONObject {
        val copy = JSONObject(args.toString())
        when (toolName) {
            "admin_upsert_record" -> copy.put("op", "upsert")
            "admin_delete_record" -> copy.put("op", "delete")
            "admin_toggle_lcr" -> copy.put("op", "toggle_lcr")
            "admin_record_maintenance" -> copy.put("op", "maintenance")
            "admin_update_tax_settings" -> {
                copy.put("op", "tax_settings")
                if (copy.has("settings") && !copy.has("tax_settings")) {
                    copy.put("tax_settings", copy.opt("settings"))
                }
            }
        }
        return copy
    }

    private fun normalizeLegacyBillingArgs(toolName: String, args: JSONObject): JSONObject {
        val copy = JSONObject(args.toString())
        when (toolName) {
            "admin_create_invoice" -> copy.put("action", "create_invoice")
            "admin_storno_invoice" -> copy.put("action", "storno")
            "admin_pay_invoice" -> {
                if (!copy.has("action")) copy.put("action", "pay")
            }
        }
        return copy
    }

    private fun buildStatusPayload(state: JSONObject): JSONObject {
        val counts = JSONObject()
        for (col in NativeStoreManager.COLLECTION_KEYS) {
            counts.put(col, state.optJSONArray(col)?.length() ?: 0)
        }
        return JSONObject()
            .put("app", "Infinity")
            .put("business", "Hafner Michael – Grünraum Handwerk")
            .put("packageName", context.packageName)
            .put("versionName", BuildConfig.VERSION_NAME)
            .put("versionCode", BuildConfig.VERSION_CODE)
            .put("datasetId", storeManager.getDatasetId())
            .put("revision", storeManager.getLocalRevision())
            .put("updatedAt", storeManager.getLocalUpdatedAt())
            .put("lastActor", storeManager.getLocalLastActor())
            .put("lastActionSummary", storeManager.getLocalLastSummary())
            .put("writeEnabled", isWriteEnabled())
            .put("counts", counts)
    }

    private fun buildOverview(state: JSONObject): JSONObject {
        val status = buildStatusPayload(state)
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val appointments = state.optJSONArray("appointments") ?: JSONArray()
        val expenses = state.optJSONArray("expenses") ?: JSONArray()

        var openInvoiceTotal = 0.0
        var paidInvoiceTotal = 0.0
        var openInvoiceCount = 0
        for (i in 0 until invoices.length()) {
            val inv = invoices.optJSONObject(i) ?: continue
            if (inv.optBoolean("is_storno", false) || inv.optString("status") == "Storniert") continue
            val total = inv.optDouble("total_amount", 0.0)
            val paid = inv.optDouble("paid_amount", 0.0)
            paidInvoiceTotal += paid
            val remaining = max(0.0, total - paid)
            if (remaining > 0.009) {
                openInvoiceTotal += remaining
                openInvoiceCount++
            }
        }

        var unbilledOfficialTotal = 0.0
        var lcrTotal = 0.0
        var unbilledCount = 0
        for (i in 0 until workRecords.length()) {
            val wr = workRecords.optJSONObject(i) ?: continue
            val amt = wr.optDouble("total_amount", 0.0)
            val isLcr = wr.optBoolean("is_lcr", false)
            val billedId = wr.optString("billed_in_invoice_id", "")
            val statusStr = wr.optString("status", "")
            if (isLcr) {
                lcrTotal += amt
            } else if (billedId.isEmpty() && statusStr != "Abgerechnet") {
                unbilledOfficialTotal += amt
                unbilledCount++
            }
        }

        var expensesTotal = 0.0
        for (i in 0 until expenses.length()) {
            val exp = expenses.optJSONObject(i) ?: continue
            expensesTotal += exp.optDouble("amount", 0.0)
        }

        val todayStr = todayIso()
        val upcoming = JSONArray()
        val apptList = mutableListOf<JSONObject>()
        for (i in 0 until appointments.length()) {
            val a = appointments.optJSONObject(i) ?: continue
            if (a.optString("date", "") >= todayStr && a.optString("status") != "Abgesagt") {
                apptList.add(a)
            }
        }
        apptList.sortBy { "${it.optString("date", "")}T${it.optString("time", "99:99")}" }
        for (a in apptList.take(10)) {
            upcoming.put(a)
        }

        return status
            .put(
                "financials",
                JSONObject()
                    .put("paidInvoiceTotal", round2(paidInvoiceTotal))
                    .put("openInvoiceTotal", round2(openInvoiceTotal))
                    .put("openInvoiceCount", openInvoiceCount)
                    .put("unbilledOfficialWorkTotal", round2(unbilledOfficialTotal))
                    .put("unbilledWorkCount", unbilledCount)
                    .put("lcrTotal", round2(lcrTotal))
                    .put("expensesTotal", round2(expensesTotal))
            )
            .put("upcomingAppointments", upcoming)
    }

    private fun executePixelQuery(args: JSONObject): JSONObject {
        val state = storeManager.loadOrInitStateObject()
        val requested = mutableListOf<String>()
        val colsArr = args.optJSONArray("collections")
        if (colsArr != null) {
            for (i in 0 until colsArr.length()) {
                val c = colsArr.optString(i, "").trim()
                if (c.isNotEmpty() && !requested.contains(c)) requested.add(c)
            }
        }
        val singleCol = args.optString("collection", "").trim()
        if (singleCol.isNotEmpty() && !requested.contains(singleCol)) {
            requested.add(singleCol)
        }

        val includeOverview =
            args.optBoolean("include_overview", false) ||
            (requested.isEmpty() && !args.optBoolean("include_guv", false))
        val includeGuv = args.optBoolean("include_guv", false) || args.has("guv_year")

        val response = JSONObject()
            .put("app", "Infinity")
            .put("datasetId", storeManager.getDatasetId())
            .put("revision", storeManager.getLocalRevision())
            .put("updatedAt", storeManager.getLocalUpdatedAt())
            .put("lastActor", storeManager.getLocalLastActor())
            .put("writeEnabled", isWriteEnabled())

        if (includeOverview) {
            response.put("overview", buildOverview(state))
        }
        if (includeGuv) {
            val year = if (args.has("guv_year")) args.optInt("guv_year", 2026) else null
            response.put("guv", calculateGuv(state, year))
        }

        if (requested.size == 1) {
            val col = requested[0]
            response.put("result", queryCollection(state, JSONObject(args.toString()).put("collection", col)))
        } else if (requested.size > 1) {
            val multi = JSONObject()
            for (col in requested) {
                multi.put(col, queryCollection(state, JSONObject(args.toString()).put("collection", col)))
            }
            response.put("collections", multi)
        }
        return response
    }

    private fun queryCollection(state: JSONObject, args: JSONObject): JSONObject {
        val col = args.optString("collection", "").trim()
        if (col == "taxSettings") {
            return JSONObject()
                .put("collection", "taxSettings")
                .put("data", state.optJSONObject("taxSettings") ?: JSONObject())
        }
        if (col == "all") {
            val allObj = JSONObject()
            for (k in NativeStoreManager.COLLECTION_KEYS) {
                allObj.put(k, state.optJSONArray(k) ?: JSONArray())
            }
            return JSONObject().put("collection", "all").put("data", allObj)
        }
        if (!NativeStoreManager.COLLECTION_KEYS.contains(col)) {
            throw IllegalArgumentException("Unbekannte Collection '$col'.")
        }

        val sourceArr = state.optJSONArray(col) ?: JSONArray()
        val idFilter = args.optString("id", "").trim()
        val customerIdFilter = args.optString("customer_id", "").trim()
        val statusFilter = args.optString("status", "").trim()
        val hasLcrFilter = args.has("is_lcr") && !args.isNull("is_lcr")
        val lcrFilter = args.optBoolean("is_lcr", false)
        val unbilledOnly = args.optBoolean("unbilled_only", false)
        val dateFrom = args.optString("date_from", "").trim()
        val dateTo = args.optString("date_to", "").trim()
        val search = args.optString("search", "").trim().lowercase(Locale.ROOT)
        val limit = args.optInt("limit", 25).coerceIn(1, 500)
        val includePhotos = args.optBoolean("include_photos", false)

        val fieldsFilter = mutableListOf<String>()
        val fArr = args.optJSONArray("fields")
        if (fArr != null) {
            for (i in 0 until fArr.length()) {
                val f = fArr.optString(i, "").trim()
                if (f.isNotEmpty()) fieldsFilter.add(f)
            }
        }

        val matched = JSONArray()
        var totalMatched = 0
        for (i in 0 until sourceArr.length()) {
            val item = sourceArr.optJSONObject(i) ?: continue
            if (idFilter.isNotEmpty() && item.optString("id") != idFilter && item.optString("invoice_number") != idFilter) {
                continue
            }
            if (customerIdFilter.isNotEmpty() && item.optString("customer_id") != customerIdFilter) {
                continue
            }
            if (statusFilter.isNotEmpty() && !item.optString("status").equals(statusFilter, ignoreCase = true)) {
                continue
            }
            if (hasLcrFilter && item.optBoolean("is_lcr", false) != lcrFilter) {
                continue
            }
            if (unbilledOnly && col == "workRecords") {
                val billedId = item.optString("billed_in_invoice_id", "")
                if (billedId.isNotEmpty() || item.optString("status") == "Abgerechnet") {
                    continue
                }
            }
            if (dateFrom.isNotEmpty() || dateTo.isNotEmpty()) {
                val itemDate = item.optString("date", item.optString("issue_date", ""))
                if (dateFrom.isNotEmpty() && itemDate.isNotEmpty() && itemDate < dateFrom) continue
                if (dateTo.isNotEmpty() && itemDate.isNotEmpty() && itemDate > dateTo) continue
            }
            if (search.isNotEmpty()) {
                if (!item.toString().lowercase(Locale.ROOT).contains(search)) {
                    continue
                }
            }

            totalMatched++
            if (matched.length() < limit) {
                val projected = projectItem(item, fieldsFilter, includePhotos)
                matched.put(projected)
            }
        }

        return JSONObject()
            .put("collection", col)
            .put("totalMatched", totalMatched)
            .put("returnedCount", matched.length())
            .put("items", matched)
    }

    private fun projectItem(
        item: JSONObject,
        fields: List<String>,
        includePhotos: Boolean
    ): JSONObject {
        val copy = JSONObject(item.toString())
        if (!includePhotos && copy.has("photos")) {
            val photosArr = copy.optJSONArray("photos")
            copy.put("photo_count", photosArr?.length() ?: 0)
            copy.remove("photos")
        }
        if (fields.isEmpty()) return copy
        val out = JSONObject()
        out.put("id", copy.optString("id"))
        for (f in fields) {
            if (copy.has(f)) {
                out.put(f, copy.opt(f))
            }
        }
        return out
    }

    private fun applyPixelActionMutation(state: JSONObject, args: JSONObject): JSONObject {
        val opsArr = args.optJSONArray("operations")
        if (opsArr != null && opsArr.length() > 0) {
            val results = JSONArray()
            for (i in 0 until opsArr.length()) {
                val opItem = opsArr.optJSONObject(i) ?: continue
                results.put(applySingleActionMutation(state, opItem))
            }
            return JSONObject()
                .put("ok", true)
                .put("mode", "batch")
                .put("count", results.length())
                .put("results", results)
        }
        return applySingleActionMutation(state, args)
    }

    private fun applySingleActionMutation(state: JSONObject, args: JSONObject): JSONObject {
        return when (val op = args.optString("op", "upsert").trim()) {
            "upsert" -> {
                val col = args.optString("collection", "").trim()
                if (!NativeStoreManager.COLLECTION_KEYS.contains(col)) {
                    throw IllegalArgumentException("Unbekannte Collection '$col'.")
                }
                val record = args.optJSONObject("record")
                    ?: throw IllegalArgumentException("Parameter 'record' fehlt für op='upsert'.")
                upsertRecordInState(state, col, record)
            }

            "delete" -> {
                val col = args.optString("collection", "").trim()
                if (!NativeStoreManager.COLLECTION_KEYS.contains(col)) {
                    throw IllegalArgumentException("Unbekannte Collection '$col'.")
                }
                val id = args.optString("id", "").trim()
                if (id.isEmpty()) {
                    throw IllegalArgumentException("Parameter 'id' ist für op='delete' erforderlich.")
                }
                deleteRecordFromState(state, col, id)
            }

            "toggle_lcr" -> {
                val idsArr = args.optJSONArray("work_record_ids") ?: JSONArray()
                val targetHasValue = args.has("is_lcr") && !args.isNull("is_lcr")
                val targetValue = args.optBoolean("is_lcr", false)
                toggleLcrInState(state, idsArr, if (targetHasValue) targetValue else null)
            }

            "maintenance" -> {
                val eqId = args.optString("equipment_id", "").trim()
                val maintObj = args.optJSONObject("maintenance") ?: args
                recordMaintenanceInState(state, eqId, maintObj)
            }

            "tax_settings" -> {
                val settingsObj = args.optJSONObject("tax_settings") ?: args
                updateTaxSettingsInState(state, settingsObj)
            }

            else -> throw IllegalArgumentException("Unbekannte Aktion '$op'.")
        }
    }

    private fun upsertRecordInState(
        state: JSONObject,
        collection: String,
        inputRecord: JSONObject
    ): JSONObject {
        val arr = state.optJSONArray(collection) ?: JSONArray().also { state.put(collection, it) }
        val nowIso = Instant.now().toString()
        val rawId = inputRecord.optString("id", "").trim()

        var existingIdx = -1
        var existingObj: JSONObject? = null
        if (rawId.isNotEmpty()) {
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                if (item.optString("id") == rawId) {
                    existingIdx = i
                    existingObj = item
                    break
                }
            }
        }

        val id = if (rawId.isNotEmpty()) rawId else generateRecordId(collection)
        val merged = if (existingObj != null) JSONObject(existingObj.toString()) else JSONObject()
        val keys = inputRecord.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            merged.put(k, inputRecord.get(k))
        }
        merged.put("id", id)
        if (!merged.has("created_at") || merged.optString("created_at").isEmpty()) {
            merged.put("created_at", nowIso)
        }
        merged.put("updated_at", nowIso)

        when (collection) {
            "customers" -> {
                val name = merged.optString("name", "").trim()
                if (name.isEmpty()) {
                    throw IllegalArgumentException("Kundenname ('name') darf nicht leer sein.")
                }
                merged.put("name", name)
                if (merged.optString("customer_number", "").isBlank()) {
                    merged.put("customer_number", nextCustomerNumber(arr))
                }
                if (!merged.has("phone")) merged.put("phone", "")
                if (!merged.has("email")) merged.put("email", "")
                if (!merged.has("address")) merged.put("address", "")
                if (!merged.has("notes")) merged.put("notes", "")
                if (!merged.has("tags") || merged.optJSONArray("tags") == null) {
                    merged.put("tags", JSONArray())
                }
            }

            "workRecords" -> {
                if (existingObj != null) {
                    val billedId = existingObj.optString("billed_in_invoice_id", "")
                    if (existingObj.optBoolean("billing_Locked", false) || billedId.isNotEmpty()) {
                        throw IllegalStateException(
                            "Arbeitseintrag '$id' ist bereits in einer Rechnung gesperrt und kann nicht geändert werden."
                        )
                    }
                }
                val custId = merged.optString("customer_id", "").trim()
                if (custId.isEmpty()) {
                    throw IllegalArgumentException("customer_id ist für Arbeitsaufzeichnungen erforderlich.")
                }
                val hours = merged.optDouble("hours", 1.0).coerceAtLeast(0.0)
                val rate = merged.optDouble("hourly_rate", 50.0).coerceAtLeast(0.0)
                var matSum = 0.0
                val mats = merged.optJSONArray("materials_used") ?: JSONArray()
                for (i in 0 until mats.length()) {
                    val m = mats.optJSONObject(i) ?: continue
                    matSum += m.optDouble("total_price", m.optDouble("quantity", 0.0) * m.optDouble("unit_price", 0.0))
                }
                merged.put("hours", hours)
                merged.put("hourly_rate", rate)
                if (!inputRecord.has("total_amount")) {
                    merged.put("total_amount", round2(hours * rate + matSum))
                }
                if (merged.optString("date", "").isBlank()) {
                    merged.put("date", todayIso())
                }
                if (merged.optString("status", "").isBlank()) {
                    merged.put("status", "Offen")
                }
                if (!merged.has("is_lcr")) merged.put("is_lcr", false)
            }

            "appointments" -> {
                if (merged.optString("date", "").isBlank()) {
                    merged.put("date", todayIso())
                }
                if (merged.optString("status", "").isBlank()) {
                    merged.put("status", "Geplant")
                }
            }
        }

        if (existingIdx >= 0) {
            arr.put(existingIdx, merged)
        } else {
            arr.put(merged)
        }

        val deletedIds = state.optJSONObject("deletedIds")
        deletedIds?.remove("$collection:$id")

        return JSONObject()
            .put("ok", true)
            .put("op", if (existingIdx >= 0) "updated" else "created")
            .put("collection", collection)
            .put("id", id)
            .put("record", merged)
    }

    private fun deleteRecordFromState(
        state: JSONObject,
        collection: String,
        id: String
    ): JSONObject {
        val arr = state.optJSONArray(collection) ?: JSONArray()
        var targetIdx = -1
        var targetObj: JSONObject? = null
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            if (item.optString("id") == id) {
                targetIdx = i
                targetObj = item
                break
            }
        }
        if (targetIdx < 0 || targetObj == null) {
            throw IllegalArgumentException("Datensatz '$id' in '$collection' nicht gefunden.")
        }

        if (collection == "invoices") {
            throw IllegalStateException(
                "Rechnungen dürfen aus buchhalterischen Gründen nicht gelöscht werden. Bitte Storno über pixel_abrechnung (action='storno') verwenden."
            )
        }
        if (collection == "workRecords") {
            val billedId = targetObj.optString("billed_in_invoice_id", "")
            if (targetObj.optBoolean("billing_Locked", false) || billedId.isNotEmpty()) {
                throw IllegalStateException(
                    "Arbeitseintrag '$id' ist bereits abgerechnet und gesperrt."
                )
            }
        }
        if (collection == "customers") {
            val invoices = state.optJSONArray("invoices") ?: JSONArray()
            for (i in 0 until invoices.length()) {
                val inv = invoices.optJSONObject(i) ?: continue
                if (inv.optString("customer_id") == id && !inv.optBoolean("is_storno", false)) {
                    throw IllegalStateException(
                        "Kunde '$id' besitzt aktive Rechnungen und kann nicht gelöscht werden."
                    )
                }
            }
        }

        val updatedArr = JSONArray()
        for (i in 0 until arr.length()) {
            if (i != targetIdx) updatedArr.put(arr.get(i))
        }
        state.put(collection, updatedArr)

        val deletedIds = state.optJSONObject("deletedIds")
            ?: JSONObject().also { state.put("deletedIds", it) }
        deletedIds.put("$collection:$id", Instant.now().toString())

        return JSONObject()
            .put("ok", true)
            .put("op", "deleted")
            .put("collection", collection)
            .put("id", id)
    }

    private fun toggleLcrInState(
        state: JSONObject,
        idsArr: JSONArray,
        explicitTarget: Boolean?
    ): JSONObject {
        val ids = mutableSetOf<String>()
        for (i in 0 until idsArr.length()) {
            val id = idsArr.optString(i, "").trim()
            if (id.isNotEmpty()) ids.add(id)
        }
        if (ids.isEmpty()) {
            throw IllegalArgumentException("Keine work_record_ids für toggle_lcr angegeben.")
        }
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val nowIso = Instant.now().toString()
        val updatedIds = JSONArray()
        for (i in 0 until workRecords.length()) {
            val wr = workRecords.optJSONObject(i) ?: continue
            val id = wr.optString("id")
            if (!ids.contains(id)) continue
            if (wr.optBoolean("billing_Locked", false) || wr.optString("billed_in_invoice_id", "").isNotEmpty()) {
                throw IllegalStateException(
                    "Arbeitseintrag '$id' ist bereits in einer Rechnung gesperrt; L.C.R.-Status kann nicht geändert werden."
                )
            }
            val nextVal = explicitTarget ?: !wr.optBoolean("is_lcr", false)
            wr.put("is_lcr", nextVal)
            wr.put("updated_at", nowIso)
            updatedIds.put(id)
        }
        return JSONObject()
            .put("ok", true)
            .put("op", "toggle_lcr")
            .put("updatedIds", updatedIds)
    }

    private fun recordMaintenanceInState(
        state: JSONObject,
        equipmentId: String,
        maint: JSONObject
    ): JSONObject {
        if (equipmentId.isEmpty()) {
            throw IllegalArgumentException("equipment_id ist erforderlich.")
        }
        val equipments = state.optJSONArray("equipments") ?: JSONArray()
        var target: JSONObject? = null
        for (i in 0 until equipments.length()) {
            val eq = equipments.optJSONObject(i) ?: continue
            if (eq.optString("id") == equipmentId) {
                target = eq
                break
            }
        }
        if (target == null) {
            throw IllegalArgumentException("Gerät '$equipmentId' nicht gefunden.")
        }
        val dateStr = maint.optString("date", "").trim().ifEmpty { todayIso() }
        val noteStr = maint.optString("note", "").trim()
        val nextMaint = maint.optString("next_maintenance", "").trim()
        target.put("last_maintenance", dateStr)
        if (nextMaint.isNotEmpty()) target.put("next_maintenance", nextMaint)
        if (noteStr.isNotEmpty()) target.put("notes", noteStr)
        target.put("status", "Einsatzbereit")
        target.put("updated_at", Instant.now().toString())

        return JSONObject()
            .put("ok", true)
            .put("op", "maintenance")
            .put("equipment_id", equipmentId)
            .put("record", target)
    }

    private fun updateTaxSettingsInState(state: JSONObject, input: JSONObject): JSONObject {
        val current = state.optJSONObject("taxSettings") ?: JSONObject()
        if (input.has("selected_year")) current.put("selected_year", input.optInt("selected_year", 2026))
        if (input.has("preferred_method")) current.put("preferred_method", input.optString("preferred_method", "auto_best"))
        if (input.has("svs_paid")) current.put("svs_paid", input.optDouble("svs_paid", 0.0))
        if (input.has("workplace_allowance")) current.put("workplace_allowance", input.optDouble("workplace_allowance", 0.0))
        if (input.has("transit_ticket_full")) current.put("transit_ticket_full", input.optDouble("transit_ticket_full", 0.0))
        if (input.has("manual_extra_income")) current.put("manual_extra_income", input.optDouble("manual_extra_income", 0.0))
        state.put("taxSettings", current)
        return JSONObject()
            .put("ok", true)
            .put("op", "tax_settings")
            .put("taxSettings", current)
    }

    private fun applyPixelBillingMutation(state: JSONObject, args: JSONObject): JSONObject {
        return when (val action = args.optString("action", "create_invoice").trim()) {
            "create_invoice" -> createInvoiceInState(state, args)
            "storno" -> stornoInvoiceInState(state, args)
            "pay", "update_payment", "reverse_payment", "delete_payment", "refund" ->
                payInvoiceInState(state, action, args)
            else -> throw IllegalArgumentException("Unbekannte Abrechnungsaktion '$action'.")
        }
    }

    private fun createInvoiceInState(state: JSONObject, args: JSONObject): JSONObject {
        val customerId = args.optString("customer_id", "").trim()
        if (customerId.isEmpty()) {
            throw IllegalArgumentException("customer_id ist für create_invoice erforderlich.")
        }
        val customers = state.optJSONArray("customers") ?: JSONArray()
        var customer: JSONObject? = null
        for (i in 0 until customers.length()) {
            val c = customers.optJSONObject(i) ?: continue
            if (c.optString("id") == customerId) {
                customer = c
                break
            }
        }
        if (customer == null) {
            throw IllegalArgumentException("Kunde '$customerId' nicht gefunden.")
        }

        val requestedIds = mutableSetOf<String>()
        val reqArr = args.optJSONArray("work_record_ids")
        if (reqArr != null) {
            for (i in 0 until reqArr.length()) {
                val id = reqArr.optString(i, "").trim()
                if (id.isNotEmpty()) requestedIds.add(id)
            }
        }

        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val selectedRecords = mutableListOf<JSONObject>()
        for (i in 0 until workRecords.length()) {
            val wr = workRecords.optJSONObject(i) ?: continue
            val wrId = wr.optString("id")
            if (requestedIds.isNotEmpty()) {
                if (!requestedIds.contains(wrId)) continue
            } else {
                if (wr.optString("customer_id") != customerId) continue
                if (wr.optBoolean("is_lcr", false)) continue
                if (wr.optBoolean("billing_Locked", false) || wr.optString("billed_in_invoice_id", "").isNotEmpty()) continue
                if (wr.optString("status") == "Abgerechnet") continue
            }
            if (wr.optBoolean("is_lcr", false)) {
                throw IllegalStateException("L.C.R.-Eintrag '$wrId' darf nicht in einer offiziellen Rechnung abgerechnet werden.")
            }
            if (wr.optBoolean("billing_Locked", false) || wr.optString("billed_in_invoice_id", "").isNotEmpty()) {
                throw IllegalStateException("Arbeitseintrag '$wrId' wurde bereits abgerechnet.")
            }
            selectedRecords.add(wr)
        }

        val lineItems = JSONArray()
        var totalAmount = 0.0
        val dates = mutableListOf<String>()

        for (wr in selectedRecords) {
            val d = wr.optString("date", "")
            if (d.isNotEmpty()) dates.add(d)
            val amt = wr.optDouble("total_amount", 0.0)
            val hours = wr.optDouble("hours", 0.0)
            val rate = wr.optDouble("hourly_rate", 50.0)
            totalAmount += amt
            lineItems.put(
                JSONObject()
                    .put("description", wr.optString("activity", "Gartenpflege"))
                    .put("quantity_label", "${formatDec(hours)} Std.")
                    .put("unit_price_label", "${formatDec(rate)} €")
                    .put("amount", round2(amt))
            )
        }

        val extraArr = args.optJSONArray("extra_items")
        if (extraArr != null) {
            for (i in 0 until extraArr.length()) {
                val ex = extraArr.optJSONObject(i) ?: continue
                val amt = ex.optDouble("amount", 0.0)
                totalAmount += amt
                lineItems.put(
                    JSONObject()
                        .put("description", ex.optString("description", "Zusatzposition"))
                        .put("quantity_label", ex.optString("quantity_label", "1 pauschal"))
                        .put("unit_price_label", ex.optString("unit_price_label", "${formatDec(amt)} €"))
                        .put("amount", round2(amt))
                )
            }
        }

        if (lineItems.length() == 0) {
            throw IllegalStateException("Keine abrechenbaren Positionen für die Rechnung gefunden.")
        }

        val invoices = state.optJSONArray("invoices") ?: JSONArray().also { state.put("invoices", it) }
        val issueDate = args.optString("issue_date", "").trim().ifEmpty { todayIso() }
        val dueDays = args.optInt("due_days", 14).coerceAtLeast(0)
        val dueDate = addDaysIso(issueDate, dueDays)
        val invoiceNumber = args.optString("invoice_number", "").trim()
            .ifEmpty { nextInvoiceNumber(invoices, issueDate) }
        val invoiceId = "inv_${UUID.randomUUID().toString().take(8)}"
        val nowIso = Instant.now().toString()
        val paidInCash = args.optBoolean("paid_in_cash", false)
        val roundedTotal = round2(totalAmount)

        val lockedWorkIds = JSONArray()
        for (wr in selectedRecords) {
            wr.put("status", "Abgerechnet")
            wr.put("billing_Locked", true)
            wr.put("billed_in_invoice_id", invoiceId)
            wr.put("updated_at", nowIso)
            lockedWorkIds.put(wr.optString("id"))
        }

        val payments = JSONArray()
        if (paidInCash) {
            payments.put(
                JSONObject()
                    .put("id", "pay_${UUID.randomUUID().toString().take(8)}")
                    .put("amount", roundedTotal)
                    .put("date", issueDate)
                    .put("note", "Barzahlung")
                    .put("type", "payment")
            )
        }

        val servicePeriod = args.optString("service_period", "").trim().ifEmpty {
            if (dates.isEmpty()) formatDeDate(issueDate)
            else {
                dates.sort()
                val first = formatDeDate(dates.first())
                val last = formatDeDate(dates.last())
                if (first == last) first else "$first – $last"
            }
        }

        val newInvoice = JSONObject()
            .put("id", invoiceId)
            .put("invoice_number", invoiceNumber)
            .put("customer_id", customerId)
            .put("customer_number", args.optString("customer_number", customer.optString("customer_number", "K-001")))
            .put("issue_date", issueDate)
            .put("due_date", dueDate)
            .put("service_period", servicePeriod)
            .put("total_amount", roundedTotal)
            .put("paid_amount", if (paidInCash) roundedTotal else 0.0)
            .put("status", if (paidInCash) "Bezahlt" else "Offen")
            .put("paid_in_cash", paidInCash)
            .put("work_record_ids", lockedWorkIds)
            .put("line_items", lineItems)
            .put("payments", payments)
            .put("created_at", nowIso)
            .put("updated_at", nowIso)

        invoices.put(newInvoice)

        return JSONObject()
            .put("ok", true)
            .put("action", "create_invoice")
            .put("invoice", newInvoice)
    }

    private fun payInvoiceInState(
        state: JSONObject,
        action: String,
        args: JSONObject
    ): JSONObject {
        val invRef = args.optString("invoice_id", "").trim()
        if (invRef.isEmpty()) {
            throw IllegalArgumentException("invoice_id ist erforderlich.")
        }
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        var invoice: JSONObject? = null
        for (i in 0 until invoices.length()) {
            val inv = invoices.optJSONObject(i) ?: continue
            if (inv.optString("id") == invRef || inv.optString("invoice_number") == invRef) {
                invoice = inv
                break
            }
        }
        if (invoice == null) {
            throw IllegalArgumentException("Rechnung '$invRef' nicht gefunden.")
        }

        val payments = invoice.optJSONArray("payments") ?: JSONArray().also { invoice.put("payments", it) }
        val nowIso = Instant.now().toString()
        val dateStr = args.optString("date", "").trim().ifEmpty { todayIso() }
        val total = invoice.optDouble("total_amount", 0.0)

        when (action) {
            "pay" -> {
                val curPaid = invoice.optDouble("paid_amount", 0.0)
                val amt = if (args.has("amount") && !args.isNull("amount")) {
                    args.optDouble("amount", 0.0)
                } else {
                    max(0.0, round2(total - curPaid))
                }
                if (amt <= 0.0) {
                    throw IllegalArgumentException("Zahlungsbetrag muss größer als 0 sein.")
                }
                payments.put(
                    JSONObject()
                        .put("id", "pay_${UUID.randomUUID().toString().take(8)}")
                        .put("amount", round2(amt))
                        .put("date", dateStr)
                        .put("note", args.optString("note", "Zahlungseingang"))
                        .put("type", "payment")
                )
            }

            "refund", "reverse_payment" -> {
                val amt = args.optDouble("amount", invoice.optDouble("paid_amount", 0.0))
                payments.put(
                    JSONObject()
                        .put("id", "pay_${UUID.randomUUID().toString().take(8)}")
                        .put("amount", -round2(kotlin.math.abs(amt)))
                        .put("date", dateStr)
                        .put("note", args.optString("note", "Rückbuchung"))
                        .put("type", action)
                )
            }

            "delete_payment" -> {
                val payId = args.optString("payment_id", "").trim()
                val filtered = JSONArray()
                for (i in 0 until payments.length()) {
                    val p = payments.optJSONObject(i) ?: continue
                    if (p.optString("id") != payId) filtered.put(p)
                }
                invoice.put("payments", filtered)
            }

            "update_payment" -> {
                val payId = args.optString("payment_id", "").trim()
                for (i in 0 until payments.length()) {
                    val p = payments.optJSONObject(i) ?: continue
                    if (p.optString("id") == payId) {
                        if (args.has("amount")) p.put("amount", round2(args.optDouble("amount", 0.0)))
                        if (args.has("date")) p.put("date", dateStr)
                        if (args.has("note")) p.put("note", args.optString("note", ""))
                    }
                }
            }
        }

        val currentPayments = invoice.optJSONArray("payments") ?: JSONArray()
        var sumPaid = 0.0
        for (i in 0 until currentPayments.length()) {
            val p = currentPayments.optJSONObject(i) ?: continue
            sumPaid += p.optDouble("amount", 0.0)
        }
        sumPaid = round2(max(0.0, sumPaid))
        invoice.put("paid_amount", sumPaid)
        val status = when {
            invoice.optBoolean("is_storno", false) -> "Storniert"
            sumPaid >= total - 0.01 -> "Bezahlt"
            sumPaid > 0.0 -> "Teilbezahlt"
            else -> "Offen"
        }
        invoice.put("status", status)
        invoice.put("updated_at", nowIso)

        return JSONObject()
            .put("ok", true)
            .put("action", action)
            .put("invoice", invoice)
    }

    private fun stornoInvoiceInState(state: JSONObject, args: JSONObject): JSONObject {
        val invRef = args.optString("invoice_id", "").trim()
        if (invRef.isEmpty()) {
            throw IllegalArgumentException("invoice_id ist für storno erforderlich.")
        }
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        var orig: JSONObject? = null
        for (i in 0 until invoices.length()) {
            val inv = invoices.optJSONObject(i) ?: continue
            if (inv.optString("id") == invRef || inv.optString("invoice_number") == invRef) {
                orig = inv
                break
            }
        }
        if (orig == null) {
            throw IllegalArgumentException("Rechnung '$invRef' nicht gefunden.")
        }
        if (orig.optBoolean("is_storno", false) || orig.optString("status") == "Storniert") {
            throw IllegalStateException("Rechnung '${orig.optString("invoice_number")}' wurde bereits storniert.")
        }

        val nowIso = Instant.now().toString()
        val issueDate = args.optString("issue_date", "").trim().ifEmpty { todayIso() }
        val stornoId = "inv_storno_${UUID.randomUUID().toString().take(8)}"
        val stornoNumber = nextStornoNumber(invoices, issueDate)

        orig.put("status", "Storniert")
        orig.put("storno_invoice_id", stornoId)
        orig.put("updated_at", nowIso)

        val linkedWorkIds = orig.optJSONArray("work_record_ids") ?: JSONArray()
        val linkedSet = mutableSetOf<String>()
        for (i in 0 until linkedWorkIds.length()) {
            linkedSet.add(linkedWorkIds.optString(i))
        }
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        for (i in 0 until workRecords.length()) {
            val wr = workRecords.optJSONObject(i) ?: continue
            if (linkedSet.contains(wr.optString("id")) || wr.optString("billed_in_invoice_id") == orig.optString("id")) {
                wr.put("billing_Locked", false)
                wr.remove("billed_in_invoice_id")
                wr.put("status", "Offen")
                wr.put("updated_at", nowIso)
            }
        }

        val stornoTotal = -round2(kotlin.math.abs(orig.optDouble("total_amount", 0.0)))
        val stornoInv = JSONObject()
            .put("id", stornoId)
            .put("invoice_number", stornoNumber)
            .put("customer_id", orig.optString("customer_id"))
            .put("customer_number", orig.optString("customer_number", "K-001"))
            .put("issue_date", issueDate)
            .put("due_date", issueDate)
            .put("service_period", orig.optString("service_period", formatDeDate(issueDate)))
            .put("total_amount", stornoTotal)
            .put("paid_amount", stornoTotal)
            .put("status", "Storniert")
            .put("is_storno", true)
            .put("cancels_invoice_id", orig.optString("id"))
            .put("cancels_invoice_number", orig.optString("invoice_number"))
            .put("storno_reason", args.optString("reason", "Stornobeleg"))
            .put("work_record_ids", JSONArray())
            .put("line_items", JSONArray())
            .put("payments", JSONArray())
            .put("created_at", nowIso)
            .put("updated_at", nowIso)

        invoices.put(stornoInv)

        return JSONObject()
            .put("ok", true)
            .put("action", "storno")
            .put("originalInvoice", orig)
            .put("stornoInvoice", stornoInv)
    }

    private fun calculateGuv(state: JSONObject, explicitYear: Int?): JSONObject {
        val taxSettings = state.optJSONObject("taxSettings") ?: JSONObject()
        val year = explicitYear ?: taxSettings.optInt("selected_year", 2026)
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        val expenses = state.optJSONArray("expenses") ?: JSONArray()

        var paidRevenue = 0.0
        for (i in 0 until invoices.length()) {
            val inv = invoices.optJSONObject(i) ?: continue
            if (inv.optBoolean("is_storno", false) || inv.optString("status") == "Storniert") continue
            val issueYear = inv.optString("issue_date", "").take(4).toIntOrNull() ?: year
            if (issueYear == year) {
                paidRevenue += inv.optDouble("paid_amount", 0.0)
            }
        }
        val extraIncome = taxSettings.optDouble("manual_extra_income", 0.0)
        val totalRevenue = round2(paidRevenue + extraIncome)

        var totalExpenses = 0.0
        for (i in 0 until expenses.length()) {
            val exp = expenses.optJSONObject(i) ?: continue
            val expYear = exp.optString("date", "").take(4).toIntOrNull() ?: year
            if (expYear == year) {
                totalExpenses += exp.optDouble("amount", 0.0)
            }
        }
        totalExpenses = round2(totalExpenses)

        val svsPaid = taxSettings.optDouble("svs_paid", 0.0)
        val workplace = taxSettings.optDouble("workplace_allowance", 0.0)
        val transit = taxSettings.optDouble("transit_ticket_full", 0.0) * 0.5

        val flat45 = min(totalRevenue * 0.45, 24750.0)
        val flat20 = min(totalRevenue * 0.20, 11000.0)
        val flat15 = min(totalRevenue * 0.15, 49500.0)

        fun computeMethod(name: String, expenseDeduction: Double): JSONObject {
            val rawProfit = max(0.0, totalRevenue - expenseDeduction - svsPaid - workplace - transit)
            val gfb = min(rawProfit * 0.15, 4950.0)
            val taxable = round2(max(0.0, rawProfit - gfb))
            val est = round2(computeAustrianIncomeTax(taxable))
            val netAfterTax = round2(totalRevenue - totalExpenses - svsPaid - est)
            return JSONObject()
                .put("method", name)
                .put("taxableProfit", taxable)
                .put("incomeTax", est)
                .put("netAfterTax", netAfterTax)
        }

        val m45 = computeMethod("ku_pauschal_45", flat45)
        val m20 = computeMethod("ku_pauschal_20", flat20)
        val m15 = computeMethod("basis_pauschal_15", flat15)
        val mEar = computeMethod("ear_echt", totalExpenses)

        val methods = listOf(m45, m20, m15, mEar)
        val best = methods.minByOrNull { it.optDouble("incomeTax", Double.MAX_VALUE) } ?: m20

        return JSONObject()
            .put("year", year)
            .put("totalRevenue", totalRevenue)
            .put("totalExpenses", totalExpenses)
            .put("svsPaid", svsPaid)
            .put("recommendedMethod", best.optString("method"))
            .put("lowestIncomeTax", best.optDouble("incomeTax"))
            .put(
                "methods",
                JSONArray().apply {
                    methods.forEach { put(it) }
                }
            )
    }

    private fun computeAustrianIncomeTax(taxable: Double): Double {
        if (taxable <= 13308.0) return 0.0
        var tax = 0.0
        val brackets = listOf(
            Triple(13308.0, 21617.0, 0.20),
            Triple(21617.0, 35836.0, 0.30),
            Triple(35836.0, 69166.0, 0.40),
            Triple(69166.0, 103072.0, 0.48),
            Triple(103072.0, 1000000.0, 0.50),
            Triple(1000000.0, Double.MAX_VALUE, 0.55)
        )
        for ((low, high, rate) in brackets) {
            if (taxable > low) {
                val slice = min(taxable, high) - low
                tax += slice * rate
            }
        }
        return tax
    }

    private fun buildToolsList(): JSONArray {
        val tools = JSONArray()

        tools.put(
            JSONObject()
                .put("name", "infinity_status")
                .put(
                    "description",
                    "Liefert den eindeutigen Status der Infinity-App auf dem Google Pixel 10 Pro (App-Name, Paketkennung, Version, Datenbestandskennung datasetId, Revision, Schreibfreigabe und Datensatzzähler)."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Infinity Status & Datenbestandskennung")
                        .put("readOnlyHint", true)
                        .put("destructiveHint", false)
                        .put("idempotentHint", true)
                        .put("openWorldHint", false)
                )
                .put(
                    "inputSchema",
                    JSONObject()
                        .put("type", "object")
                        .put("additionalProperties", false)
                        .put("properties", JSONObject())
                )
        )

        tools.put(
            JSONObject()
                .put("name", "pixel_abfrage")
                .put(
                    "description",
                    "Gezielte Leseabfrage auf der lokalen Infinity-Datenbank des Pixel 10 Pro: Liest Betriebsübersicht, Kundensuche, einzelne Kunden/Einträge, mehrere Tabellen (customers, properties, appointments, workRecords, invoices, inquiries, offers, orders, equipments, materials, expenses, taxSettings) und österreichische GuV."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Infinity Daten & Übersicht gezielt abfragen")
                        .put("readOnlyHint", true)
                        .put("destructiveHint", false)
                        .put("idempotentHint", true)
                        .put("openWorldHint", false)
                )
                .put(
                    "inputSchema",
                    JSONObject()
                        .put("type", "object")
                        .put("additionalProperties", false)
                        .put(
                            "properties",
                            JSONObject()
                                .put("collection", JSONObject().put("type", "string"))
                                .put(
                                    "collections",
                                    JSONObject()
                                        .put("type", "array")
                                        .put("items", JSONObject().put("type", "string"))
                                )
                                .put("id", JSONObject().put("type", "string"))
                                .put("customer_id", JSONObject().put("type", "string"))
                                .put("status", JSONObject().put("type", "string"))
                                .put("is_lcr", JSONObject().put("type", "boolean"))
                                .put("unbilled_only", JSONObject().put("type", "boolean"))
                                .put("date_from", JSONObject().put("type", "string"))
                                .put("date_to", JSONObject().put("type", "string"))
                                .put("search", JSONObject().put("type", "string"))
                                .put(
                                    "fields",
                                    JSONObject()
                                        .put("type", "array")
                                        .put("items", JSONObject().put("type", "string"))
                                )
                                .put("limit", JSONObject().put("type", "number"))
                                .put("include_overview", JSONObject().put("type", "boolean"))
                                .put("include_guv", JSONObject().put("type", "boolean"))
                                .put("guv_year", JSONObject().put("type", "number"))
                        )
                )
        )

        tools.put(
            JSONObject()
                .put("name", "pixel_aktion")
                .put(
                    "description",
                    "Geprüfte Schreibfunktion für die lokale Infinity-Datenbank auf dem Pixel 10 Pro (erfordert aktive Schreibfreigabe am Gerät): Anlegen, Ändern und Löschen von Kunden, Objekten, Terminen, Arbeitsaufzeichnungen, Anfragen, Angeboten, Aufträgen, Geräten, Material und Ausgaben inklusive dauerhaftem Wiederholungsbeleg (request_id) und Revisionsprüfung."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Infinity Daten anlegen, ändern & löschen")
                        .put("readOnlyHint", false)
                        .put("destructiveHint", true)
                        .put("idempotentHint", true)
                        .put("openWorldHint", false)
                )
                .put(
                    "inputSchema",
                    JSONObject()
                        .put("type", "object")
                        .put("additionalProperties", false)
                        .put(
                            "properties",
                            JSONObject()
                                .put(
                                    "op",
                                    JSONObject()
                                        .put("type", "string")
                                        .put(
                                            "enum",
                                            JSONArray()
                                                .put("upsert")
                                                .put("delete")
                                                .put("toggle_lcr")
                                                .put("maintenance")
                                                .put("tax_settings")
                                        )
                                )
                                .put("collection", JSONObject().put("type", "string"))
                                .put("id", JSONObject().put("type", "string"))
                                .put(
                                    "record",
                                    JSONObject()
                                        .put("type", "object")
                                        .put("additionalProperties", true)
                                )
                                .put(
                                    "work_record_ids",
                                    JSONObject()
                                        .put("type", "array")
                                        .put("items", JSONObject().put("type", "string"))
                                )
                                .put("is_lcr", JSONObject().put("type", "boolean"))
                                .put("equipment_id", JSONObject().put("type", "string"))
                                .put(
                                    "maintenance",
                                    JSONObject()
                                        .put("type", "object")
                                        .put("additionalProperties", true)
                                )
                                .put(
                                    "tax_settings",
                                    JSONObject()
                                        .put("type", "object")
                                        .put("additionalProperties", true)
                                )
                                .put(
                                    "operations",
                                    JSONObject()
                                        .put("type", "array")
                                        .put(
                                            "items",
                                            JSONObject()
                                                .put("type", "object")
                                                .put("additionalProperties", true)
                                        )
                                )
                                .put("request_id", JSONObject().put("type", "string"))
                                .put("expected_revision", JSONObject().put("type", "number"))
                        )
                )
        )

        tools.put(
            JSONObject()
                .put("name", "pixel_abrechnung")
                .put(
                    "description",
                    "Geprüfte Abrechnungs-Logik auf dem Pixel 10 Pro (erfordert aktive Schreibfreigabe am Gerät): Erstellt Rechnungen (Format RE-75/2026, §6 Abs. 1 Z 27 UStG Kleinunternehmerregelung, Sperre abgerechneter Arbeiten), verbucht Zahlungen oder erstellt Stornobelege (RE-S01/2026)."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Infinity Rechnung erstellen, Zahlung buchen oder stornieren")
                        .put("readOnlyHint", false)
                        .put("destructiveHint", false)
                        .put("idempotentHint", true)
                        .put("openWorldHint", false)
                )
                .put(
                    "inputSchema",
                    JSONObject()
                        .put("type", "object")
                        .put("additionalProperties", false)
                        .put("required", JSONArray().put("action"))
                        .put(
                            "properties",
                            JSONObject()
                                .put(
                                    "action",
                                    JSONObject()
                                        .put("type", "string")
                                        .put(
                                            "enum",
                                            JSONArray()
                                                .put("create_invoice")
                                                .put("pay")
                                                .put("update_payment")
                                                .put("reverse_payment")
                                                .put("delete_payment")
                                                .put("refund")
                                                .put("storno")
                                        )
                                )
                                .put("customer_id", JSONObject().put("type", "string"))
                                .put(
                                    "work_record_ids",
                                    JSONObject()
                                        .put("type", "array")
                                        .put("items", JSONObject().put("type", "string"))
                                )
                                .put(
                                    "extra_items",
                                    JSONObject()
                                        .put("type", "array")
                                        .put(
                                            "items",
                                            JSONObject()
                                                .put("type", "object")
                                                .put("additionalProperties", true)
                                        )
                                )
                                .put("issue_date", JSONObject().put("type", "string"))
                                .put("due_days", JSONObject().put("type", "number"))
                                .put("invoice_number", JSONObject().put("type", "string"))
                                .put("customer_number", JSONObject().put("type", "string"))
                                .put("service_period", JSONObject().put("type", "string"))
                                .put("paid_in_cash", JSONObject().put("type", "boolean"))
                                .put("invoice_id", JSONObject().put("type", "string"))
                                .put("amount", JSONObject().put("type", "number"))
                                .put("payment_id", JSONObject().put("type", "string"))
                                .put("date", JSONObject().put("type", "string"))
                                .put("note", JSONObject().put("type", "string"))
                                .put("reason", JSONObject().put("type", "string"))
                                .put("request_id", JSONObject().put("type", "string"))
                                .put("expected_revision", JSONObject().put("type", "number"))
                        )
                )
        )

        return tools
    }

    private fun nextCustomerNumber(customersArr: JSONArray): String {
        var maxNum = 0
        for (i in 0 until customersArr.length()) {
            val c = customersArr.optJSONObject(i) ?: continue
            val raw = c.optString("customer_number", "")
            val digits = raw.replace(Regex("[^0-9]"), "").toIntOrNull() ?: 0
            if (digits > maxNum) maxNum = digits
        }
        return "K-%03d".format(maxNum + 1)
    }

    private fun nextInvoiceNumber(invoicesArr: JSONArray, issueDate: String): String {
        val year = issueDate.take(4).toIntOrNull() ?: 2026
        var maxSeq = 74
        val regex = Regex("^RE-(\\d+)/(\\d{4})$")
        for (i in 0 until invoicesArr.length()) {
            val inv = invoicesArr.optJSONObject(i) ?: continue
            val num = inv.optString("invoice_number", "")
            val m = regex.matchEntire(num) ?: continue
            val seq = m.groupValues[1].toIntOrNull() ?: continue
            val y = m.groupValues[2].toIntOrNull() ?: continue
            if (y == year && seq > maxSeq) maxSeq = seq
        }
        return "RE-${maxSeq + 1}/$year"
    }

    private fun nextStornoNumber(invoicesArr: JSONArray, issueDate: String): String {
        val year = issueDate.take(4).toIntOrNull() ?: 2026
        var maxSeq = 0
        val regex = Regex("^RE-S(\\d+)/(\\d{4})$")
        for (i in 0 until invoicesArr.length()) {
            val inv = invoicesArr.optJSONObject(i) ?: continue
            val num = inv.optString("invoice_number", "")
            val m = regex.matchEntire(num) ?: continue
            val seq = m.groupValues[1].toIntOrNull() ?: continue
            val y = m.groupValues[2].toIntOrNull() ?: continue
            if (y == year && seq > maxSeq) maxSeq = seq
        }
        return "RE-S%02d/%d".format(maxSeq + 1, year)
    }

    private fun generateRecordId(collection: String): String {
        val prefix = when (collection) {
            "customers" -> "cust"
            "properties" -> "prop"
            "appointments" -> "appt"
            "workRecords" -> "work"
            "invoices" -> "inv"
            "inquiries" -> "inq"
            "offers" -> "off"
            "orders" -> "ord"
            "equipments" -> "eq"
            "materials" -> "mat"
            "expenses" -> "exp"
            else -> "rec"
        }
        return "${prefix}_${UUID.randomUUID().toString().replace("-", "").take(10)}"
    }

    private fun todayIso(): String {
        return LocalDate.now(ZoneId.of("Europe/Vienna")).toString()
    }

    private fun addDaysIso(isoDate: String, days: Int): String {
        return try {
            LocalDate.parse(isoDate).plusDays(days.toLong()).toString()
        } catch (_: Exception) {
            todayIso()
        }
    }

    private fun formatDeDate(isoDate: String): String {
        return try {
            LocalDate.parse(isoDate).format(DateTimeFormatter.ofPattern("dd.MM.yyyy"))
        } catch (_: Exception) {
            isoDate
        }
    }

    private fun round2(v: Double): Double = (v * 100.0).roundToLong() / 100.0

    private fun formatDec(v: Double): String =
        String.format(Locale.GERMAN, "%.2f", round2(v))

    private fun okResponse(id: Any?, result: JSONObject): JSONObject {
        return JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", id ?: JSONObject.NULL)
            .put("result", result)
    }

    private fun errorResponse(id: Any?, code: Int, message: String): JSONObject {
        return JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", id ?: JSONObject.NULL)
            .put(
                "error",
                JSONObject()
                    .put("code", code)
                    .put("message", message)
            )
    }

    private class WriteDisabledException(message: String) : IllegalStateException(message)

    companion object {
        private val SUPPORTED_VERSIONS = setOf("2025-06-18", "2025-03-26", "2024-11-05")
    }
}
