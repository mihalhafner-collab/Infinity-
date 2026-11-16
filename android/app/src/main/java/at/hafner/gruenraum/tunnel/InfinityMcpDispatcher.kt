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
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/**
 * Nativer MCP-JSON-RPC-Dispatcher für den direkten OpenAI-Pixel-Tunnel in Infinity.
 *
 * Bildet die Fachlogik aus `src/server/mcpAdminEngine.ts`, `src/utils/invoicePdf.ts`
 * und `src/utils/guvCalculator.ts` 1:1 auf dem echten lokalen Datenbestand
 * (`NativeStoreManager` / `hafner_app_store.json`) ab — inklusive Revisionsprüfung,
 * dauerhafter Wiederholungsbelege (`request_id`) und jederzeit abschaltbarer Schreibfreigabe.
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
                            "Direkter privater OpenAI-Pixel-Tunnel auf dem Google Pixel 10 Pro (App: Infinity · Hafner Michael – Grünraum Handwerk, Paket: at.hafner.gruenraum). Nutze infinity_status für Status/Revisionsprüfung, pixel_abfrage für Lesezugriffe (Übersicht, Kundensuche, Einzeldatensätze, GuV), pixel_aktion für Schreibvorgänge (Anlegen, Ändern, Löschen, L.C.R., Wartung, Steuereinstellungen) und pixel_abrechnung für Rechnungen (RE-75/2026), Zahlungen und Storno."
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
                val year = if (args.has("year") && !args.isNull("year")) args.optInt("year", 2026) else null
                calculateGuvSummaryJson(storeManager.loadOrInitStateObject(), year)
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
        val todayStr = todayIso()

        val openWorkPreview = JSONArray()
        var openWorkCount = 0
        var openWorkHours = 0.0
        var openWorkAmountEur = 0.0

        var lcrWorkCount = 0
        var lcrHours = 0.0
        var lcrAmountEur = 0.0

        for (i in 0 until workRecords.length()) {
            val w = workRecords.optJSONObject(i) ?: continue
            val settlementId = optNullableString(w, "settlement_id")
            val isLcr = w.optBoolean("is_lcr", false)
            val billable = w.optBoolean("billable", true)
            val hrs = w.optDouble("hours", 0.0)
            val amt = getWorkAccountingAmount(w)

            if (settlementId == null && !isLcr && billable) {
                openWorkCount++
                openWorkHours += hrs
                openWorkAmountEur += amt
                if (openWorkPreview.length() < 20) {
                    openWorkPreview.put(stripHeavyPhotos(w, false))
                }
            } else if (settlementId == null && isLcr) {
                lcrWorkCount++
                lcrHours += hrs
                lcrAmountEur += amt
            }
        }

        val unpaidInvoicesPreview = JSONArray()
        var unpaidInvoiceCount = 0
        var unpaidInvoicesAmountEur = 0.0
        for (i in 0 until invoices.length()) {
            val inv = invoices.optJSONObject(i) ?: continue
            val isStorno = inv.optBoolean("is_storno", false)
            val invStatus = inv.optString("status", "unpaid")
            if (!isStorno && (invStatus == "unpaid" || invStatus == "partially_paid")) {
                unpaidInvoiceCount++
                val total = inv.optDouble("total_amount", 0.0)
                val paid = sumInvoicePayments(inv)
                unpaidInvoicesAmountEur += max(0.0, total - paid)
                if (unpaidInvoicesPreview.length() < 20) {
                    unpaidInvoicesPreview.put(inv)
                }
            }
        }

        val upcomingList = mutableListOf<JSONObject>()
        for (i in 0 until appointments.length()) {
            val a = appointments.optJSONObject(i) ?: continue
            if (a.optString("date", "") >= todayStr) {
                upcomingList.add(a)
            }
        }
        upcomingList.sortWith(
            compareBy<JSONObject> { it.optString("date", "") }
                .thenBy { it.optInt("tour_order", 0) }
        )
        val upcomingArr = JSONArray()
        for (a in upcomingList.take(15)) {
            upcomingArr.put(a)
        }

        val counts = status.getJSONObject("counts")
        counts.put("upcomingAppointments", upcomingList.size)
        counts.put("openWorkRecords", openWorkCount)
        counts.put("lcrWorkRecords", lcrWorkCount)
        counts.put("unpaidInvoices", unpaidInvoiceCount)

        val guv = calculateGuvSummaryJson(state, null)
        val activeRes = guv.optJSONObject("activeResult") ?: JSONObject()

        return status
            .put(
                "totals",
                JSONObject()
                    .put("openWorkHours", round2(openWorkHours))
                    .put("openWorkAmountEur", round2(openWorkAmountEur))
                    .put("lcrHours", round2(lcrHours))
                    .put("lcrAmountEur", round2(lcrAmountEur))
                    .put("combinedOpenPlusLcrEur", round2(openWorkAmountEur + lcrAmountEur))
                    .put("unpaidInvoicesAmountEur", round2(unpaidInvoicesAmountEur))
            )
            .put(
                "guvOverview",
                JSONObject()
                    .put("year", guv.optInt("year", 2026))
                    .put("totalCashIncomeEur", guv.optDouble("totalCashIncome", 0.0))
                    .put("invoicedIncomeInYearEur", guv.optDouble("invoicedIncomeInYear", 0.0))
                    .put("openReceivablesTotalEur", guv.optDouble("openReceivablesTotal", 0.0))
                    .put("kuStatus", guv.optString("kuStatus", "ok"))
                    .put("kuLimitUsedPercent", guv.optInt("kuLimitUsedPercent", 0))
                    .put("activeMethodKey", guv.optString("activeMethodKey", "ku_pauschal_45"))
                    .put("bestMethodKey", guv.optString("bestMethodKey", "ku_pauschal_45"))
                    .put("taxableProfitEur", activeRes.optDouble("taxableProfit", 0.0))
                    .put("estimatedIncomeTaxEur", activeRes.optDouble("estimatedIncomeTax", 0.0))
            )
            .put("upcomingAppointments", upcomingArr)
            .put("openWorkPreview", openWorkPreview)
            .put("unpaidInvoicesPreview", unpaidInvoicesPreview)
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
                (requested.isEmpty() && !args.optBoolean("include_guv", false) && !args.has("guv_year"))
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
            val year = if (args.has("guv_year") && !args.isNull("guv_year")) args.optInt("guv_year", 2026) else null
            response.put("guv", calculateGuvSummaryJson(state, year))
        }

        if (requested.size == 1) {
            val col = requested[0]
            response.put(
                "result",
                queryCollection(state, JSONObject(args.toString()).put("collection", col))
            )
        } else if (requested.size > 1) {
            val multi = JSONObject()
            for (col in requested) {
                multi.put(
                    col,
                    queryCollection(state, JSONObject(args.toString()).put("collection", col))
                )
            }
            response.put("collections", multi)
        }
        return response
    }

    private fun queryCollection(state: JSONObject, args: JSONObject): JSONObject {
        val col = args.optString("collection", "").trim()
        val rev = storeManager.getLocalRevision()

        if (col == "taxSettings") {
            return JSONObject()
                .put("revision", rev)
                .put("collection", "taxSettings")
                .put("data", state.optJSONObject("taxSettings") ?: JSONObject())
                .put("guvSummary", calculateGuvSummaryJson(state, null))
        }

        if (col == "all") {
            val perLimit = args.optInt("limit", 25).coerceIn(1, 200)
            val grouped = JSONObject()
            var totalMatched = 0
            for (cName in NativeStoreManager.COLLECTION_KEYS) {
                val sub = queryCollection(
                    state,
                    JSONObject(args.toString()).put("collection", cName).put("limit", perLimit)
                )
                val items = sub.optJSONArray("items") ?: JSONArray()
                if (items.length() > 0) {
                    grouped.put(cName, items)
                    totalMatched += sub.optInt("totalMatched", 0)
                }
            }
            return JSONObject()
                .put("revision", rev)
                .put("collection", "all")
                .put("totalMatched", totalMatched)
                .put("resultsByCollection", grouped)
        }

        if (!NativeStoreManager.COLLECTION_KEYS.contains(col)) {
            throw IllegalArgumentException("Unbekannte Collection '$col'.")
        }

        val sourceArr = state.optJSONArray(col) ?: JSONArray()
        val customersArr = state.optJSONArray("customers") ?: JSONArray()
        val idFilter = args.optString("id", "").trim()
        val customerIdFilter = args.optString("customer_id", "").trim()
        val statusFilter = args.optString("status", "").trim()
        val categoryFilter = args.optString("category", "").trim()
        val itemTypeFilter = args.optString("item_type", "").trim()
        val parentEqIdFilter = args.optString("parent_equipment_id", "").trim()
        val hasLcrFilter = args.has("is_lcr") && !args.isNull("is_lcr")
        val lcrFilter = args.optBoolean("is_lcr", false)
        val unbilledOnly = args.optBoolean("unbilled_only", false)
        val dateFrom = args.optString("date_from", "").trim()
        val dateTo = args.optString("date_to", "").trim()
        val search = args.optString("search", "").trim().lowercase(Locale.ROOT)
        val defaultLimit = if (col == "equipments") 200 else 25
        val limit = args.optInt("limit", defaultLimit).coerceIn(1, 500)
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
            if (idFilter.isNotEmpty()) {
                val idMatch = item.optString("id") == idFilter ||
                    (col == "invoices" && item.optString("invoice_number") == idFilter)
                if (!idMatch) continue
            }
            if (customerIdFilter.isNotEmpty()) {
                val cMatch = item.optString("customer_id") == customerIdFilter ||
                    optNullableString(item, "billing_customer_id") == customerIdFilter ||
                    optNullableString(item, "default_billing_customer_id") == customerIdFilter ||
                    (col == "workRecords" && getEffectiveBillingCustomerId(item, customersArr) == customerIdFilter)
                if (!cMatch) continue
            }
            if (statusFilter.isNotEmpty() && !item.optString("status").equals(statusFilter, ignoreCase = true)) {
                continue
            }
            if (categoryFilter.isNotEmpty() && !item.optString("category").equals(categoryFilter, ignoreCase = true)) {
                continue
            }
            if (itemTypeFilter.isNotEmpty() && col == "equipments") {
                val eqType = item.optString("item_type", "geraet")
                if (!eqType.equals(itemTypeFilter, ignoreCase = true)) continue
            }
            if (parentEqIdFilter.isNotEmpty() && col == "equipments") {
                if (optNullableString(item, "parent_equipment_id") != parentEqIdFilter) continue
            }
            if (hasLcrFilter && col == "workRecords" && item.optBoolean("is_lcr", false) != lcrFilter) {
                continue
            }
            if (unbilledOnly && col == "workRecords") {
                if (optNullableString(item, "settlement_id") != null) continue
            }
            if (dateFrom.isNotEmpty() || dateTo.isNotEmpty()) {
                val itemDate = firstNonBlank(
                    item.optString("date", ""),
                    item.optString("work_date", ""),
                    item.optString("issue_date", ""),
                    item.optString("desired_date", ""),
                    item.optString("scheduled_date", "")
                )
                if (itemDate.isEmpty()) continue
                if (dateFrom.isNotEmpty() && itemDate < dateFrom) continue
                if (dateTo.isNotEmpty() && itemDate > dateTo) continue
            }
            if (search.isNotEmpty()) {
                val strippedStr = stripHeavyPhotos(item, false).toString().lowercase(Locale.ROOT)
                if (!strippedStr.contains(search)) continue
            }

            totalMatched++
            if (matched.length() < limit) {
                matched.put(projectItem(item, fieldsFilter, includePhotos))
            }
        }

        return JSONObject()
            .put("revision", rev)
            .put("collection", col)
            .put("totalMatched", totalMatched)
            .put("returnedCount", matched.length())
            .put("items", matched)
    }

    private fun stripHeavyPhotos(item: JSONObject, includePhotos: Boolean): JSONObject {
        val copy = JSONObject(item.toString())
        if (includePhotos) return copy
        if (copy.has("photos")) {
            val arr = copy.optJSONArray("photos")
            copy.put("photo_count", arr?.length() ?: 0)
            copy.remove("photos")
        }
        val singlePhoto = copy.optString("photo", "")
        if (singlePhoto.startsWith("data:")) {
            copy.put("has_photo", true)
            copy.remove("photo")
        }
        return copy
    }

    private fun projectItem(
        item: JSONObject,
        fields: List<String>,
        includePhotos: Boolean
    ): JSONObject {
        val stripped = stripHeavyPhotos(item, includePhotos)
        if (fields.isEmpty()) return stripped
        val out = JSONObject()
        out.put("id", stripped.optString("id"))
        for (f in fields) {
            if (stripped.has(f)) {
                out.put(f, stripped.opt(f))
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
                    ?: args.optJSONObject("data")
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
        payload: JSONObject
    ): JSONObject {
        val arr = state.optJSONArray(collection) ?: JSONArray().also { state.put(collection, it) }
        val nowIso = Instant.now().toString()
        val today = todayIso()
        val requestedId = payload.optString("id", "").trim()

        var existingIdx = -1
        var prev: JSONObject? = null
        if (requestedId.isNotEmpty()) {
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                if (item.optString("id") == requestedId) {
                    existingIdx = i
                    prev = item
                    break
                }
            }
        }

        val id = prev?.optString("id")?.takeIf { it.isNotEmpty() }
            ?: requestedId.takeIf { it.isNotEmpty() }
            ?: generateRecordId(collection)

        val record = JSONObject()
        if (prev != null) {
            copyAllFields(prev, record)
        }
        copyAllFields(payload, record)
        record.put("id", id)

        when (collection) {
            "customers" -> {
                val rawName = if (payload.has("name")) payload.optString("name", "").trim()
                else prev?.optString("name", "")?.trim().orEmpty()
                if (rawName.isEmpty()) {
                    throw IllegalArgumentException("Kundenname ('name') darf nicht leer sein.")
                }

                val billingMode = when (val bm = record.optString("billing_mode", "standard")) {
                    "divergent_recipient", "standard" -> bm
                    else -> "standard"
                }

                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                var defaultBillingId: String? = null
                if (billingMode == "divergent_recipient") {
                    val candidate = optNullableString(record, "default_billing_customer_id")
                    if (candidate != null) {
                        if (candidate == id) {
                            throw IllegalArgumentException("Abweichender Rechnungsempfänger darf nicht der Kunde selbst sein.")
                        }
                        if (findById(customersArr, candidate) == null) {
                            throw IllegalArgumentException("Abweichender Rechnungsempfänger '$candidate' existiert nicht.")
                        }
                        defaultBillingId = candidate
                    }
                }

                val consent = record.optBoolean("electronic_invoice_consent", false)
                val consentDate = if (consent) {
                    optNullableString(record, "electronic_invoice_consent_date") ?: today
                } else null

                val streetVal = firstNonBlank(
                    record.optString("street", ""),
                    record.optString("address", "")
                )

                val gardenArea = if (record.has("garden_area") && !record.isNull("garden_area")) {
                    val v = record.optDouble("garden_area", Double.NaN)
                    if (!v.isNaN() && v >= 0.0) v else null
                } else null

                record.put("name", rawName)
                record.put("company", record.optString("company", ""))
                record.put("phone", record.optString("phone", ""))
                record.put("email", record.optString("email", ""))
                record.put("street", streetVal)
                record.put("city", record.optString("city", ""))
                record.put("zip", record.optString("zip", ""))
                record.put("notes", record.optString("notes", ""))
                record.put("active", if (record.has("active")) record.optBoolean("active", true) else true)
                record.put("electronic_invoice_consent", consent)
                record.put("electronic_invoice_consent_date", consentDate ?: JSONObject.NULL)
                record.put("billing_mode", billingMode)
                record.put("default_billing_customer_id", defaultBillingId ?: JSONObject.NULL)
                record.put("garden_area", gardenArea ?: JSONObject.NULL)
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: nowIso)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) {
                    arr.put(existingIdx, record)
                } else {
                    arr.put(record)
                }

                // Sync open workRecords billing_customer_id
                val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
                for (i in 0 until workRecords.length()) {
                    val w = workRecords.optJSONObject(i) ?: continue
                    if (w.optString("customer_id") == id && optNullableString(w, "settlement_id") == null) {
                        w.put("billing_customer_id", defaultBillingId ?: JSONObject.NULL)
                    }
                }

                // Sync billing_customer_name on existing invoices if name changed
                if (prev != null && prev.optString("name") != rawName) {
                    val invoices = state.optJSONArray("invoices") ?: JSONArray()
                    for (i in 0 until invoices.length()) {
                        val inv = invoices.optJSONObject(i) ?: continue
                        if (inv.optString("customer_id") == id) {
                            inv.put("billing_customer_name", rawName)
                        }
                    }
                }
            }

            "properties" -> {
                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                val custId = record.optString("customer_id", "").trim()
                if (custId.isEmpty() || findById(customersArr, custId) == null) {
                    throw IllegalArgumentException("Gültige 'customer_id' eines bestehenden Kunden ist für ein Objekt erforderlich.")
                }
                record.put("customer_id", custId)
                record.put("name", record.optString("name", "Hausgarten").trim().ifEmpty { "Hausgarten" })
                record.put("property_type", record.optString("property_type", "Hausgarten"))
                record.put("address", record.optString("address", "").trim())
                if (!record.has("area_sqm")) record.put("area_sqm", JSONObject.NULL)
                if (!record.has("hedge_length_m")) record.put("hedge_length_m", JSONObject.NULL)
                record.put("access_info", record.optString("access_info", "").trim())
                if (record.optJSONArray("features") == null) record.put("features", JSONArray())
                if (record.optJSONArray("photos") == null) record.put("photos", JSONArray())
                record.put("notes", record.optString("notes", "").trim())
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: today)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) arr.put(existingIdx, record) else arr.put(record)
            }

            "appointments" -> {
                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                val propertiesArr = state.optJSONArray("properties") ?: JSONArray()
                val dateStr = assertIsoDate(record.optString("date", today), "date")
                val custId = optNullableString(record, "customer_id")
                if (custId != null && findById(customersArr, custId) == null) {
                    throw IllegalArgumentException("Kunde '$custId' existiert nicht.")
                }
                val propId = optNullableString(record, "property_id")
                if (propId != null && findById(propertiesArr, propId) == null) {
                    throw IllegalArgumentException("Objekt '$propId' existiert nicht.")
                }
                record.put("title", record.optString("title", "Termin").trim().ifEmpty { "Termin" })
                record.put("date", dateStr)
                record.put("start_time", optNullableString(record, "start_time") ?: JSONObject.NULL)
                record.put("end_time", optNullableString(record, "end_time") ?: JSONObject.NULL)
                if (!record.has("duration_minutes")) record.put("duration_minutes", JSONObject.NULL)
                record.put("customer_id", custId ?: JSONObject.NULL)
                record.put("property_id", propId ?: JSONObject.NULL)
                record.put("address", optNullableString(record, "address") ?: JSONObject.NULL)
                record.put("notes", record.optString("notes", ""))
                if (!record.has("tour_order")) {
                    var dayCount = 0
                    for (i in 0 until arr.length()) {
                        if (arr.optJSONObject(i)?.optString("date") == dateStr) dayCount++
                    }
                    record.put("tour_order", dayCount + 1)
                }
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) arr.put(existingIdx, record) else arr.put(record)
            }

            "workRecords" -> {
                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                val custId = record.optString("customer_id", "").trim()
                val cust = findById(customersArr, custId)
                    ?: throw IllegalArgumentException("Gültige 'customer_id' eines bestehenden Kunden ist für eine Arbeitsaufzeichnung erforderlich.")

                val prevSettlement = prev?.let { optNullableString(it, "settlement_id") }
                if (
                    prevSettlement != null &&
                    payload.has("is_lcr") &&
                    payload.optBoolean("is_lcr") != prev.optBoolean("is_lcr", false)
                ) {
                    throw IllegalStateException(
                        "Gesperrt: Diese Arbeit ist fest an eine ausgestellte Rechnung gebunden. Stornierung nötig."
                    )
                }

                val workDateRaw = firstNonBlank(
                    payload.optString("work_date", ""),
                    payload.optString("date", ""),
                    prev?.optString("work_date", "") ?: "",
                    today
                )
                val workDate = assertIsoDate(workDateRaw, "work_date")
                val titleStr = firstNonBlank(
                    payload.optString("title", ""),
                    payload.optString("activity", ""),
                    prev?.optString("title", "") ?: "",
                    "Gartenarbeit"
                )

                val autoBillingId = if (
                    cust.optString("billing_mode") == "divergent_recipient" &&
                    optNullableString(cust, "default_billing_customer_id") != null
                ) {
                    optNullableString(cust, "default_billing_customer_id")
                } else null

                val hours = record.optDouble("hours", 8.0).coerceAtLeast(0.0)
                val hasExplicitNullRate = payload.has("hourly_rate") && payload.isNull("hourly_rate")
                val hourlyRate: Double? = when {
                    hasExplicitNullRate -> null
                    payload.has("hourly_rate") -> payload.optDouble("hourly_rate", 50.0)
                    prev != null && prev.has("hourly_rate") && !prev.isNull("hourly_rate") -> prev.optDouble("hourly_rate", 50.0)
                    prev != null && prev.isNull("hourly_rate") -> null
                    else -> 50.0
                }

                val rawMatsInput = payload.optJSONArray("materials")
                    ?: payload.optJSONArray("materials_used")
                    ?: prev?.optJSONArray("materials")
                    ?: JSONArray()
                val normalizedMats = JSONArray()
                var matSum = 0.0
                var anyMatTotal = false
                for (i in 0 until rawMatsInput.length()) {
                    val m = rawMatsInput.optJSONObject(i) ?: continue
                    val qty = m.optDouble("quantity", 1.0)
                    val ppu = if (m.has("price_per_unit") && !m.isNull("price_per_unit")) {
                        m.optDouble("price_per_unit", 0.0)
                    } else if (m.has("unit_price") && !m.isNull("unit_price")) {
                        m.optDouble("unit_price", 0.0)
                    } else null
                    val tot = when {
                        m.has("total") && !m.isNull("total") -> round2(m.optDouble("total", 0.0))
                        m.has("total_price") && !m.isNull("total_price") -> round2(m.optDouble("total_price", 0.0))
                        ppu != null -> round2(qty * ppu)
                        else -> null
                    }
                    if (tot != null) {
                        anyMatTotal = true
                        matSum += tot
                    }
                    normalizedMats.put(
                        JSONObject()
                            .put("material_id", m.optString("material_id", "mat-used-$i"))
                            .put("name", m.optString("name", "Material"))
                            .put("quantity", qty)
                            .put("unit", m.optString("unit", "Stück"))
                            .put("price_per_unit", ppu ?: JSONObject.NULL)
                            .put("total", tot ?: JSONObject.NULL)
                    )
                }

                val materialCost: Double? = when {
                    payload.has("material_cost") && payload.isNull("material_cost") -> null
                    payload.has("material_cost") -> round2(payload.optDouble("material_cost", 0.0))
                    anyMatTotal -> round2(matSum)
                    else -> null
                }

                val accountingAmount: Double? = when {
                    payload.has("accounting_amount") && existingIdx < 0 -> {
                        if (payload.isNull("accounting_amount")) null
                        else round2(payload.optDouble("accounting_amount", 0.0))
                    }
                    hourlyRate != null -> round2(hours * hourlyRate + (materialCost ?: 0.0))
                    else -> null
                }

                val nextIsLcr = if (prevSettlement != null) {
                    prev.optBoolean("is_lcr", false)
                } else {
                    record.optBoolean("is_lcr", false)
                }

                record.put("work_date", workDate)
                record.put("title", titleStr)
                record.put("customer_id", custId)
                record.put(
                    "billing_customer_id",
                    if (payload.has("billing_customer_id")) (optNullableString(payload, "billing_customer_id") ?: JSONObject.NULL)
                    else (prev?.let { optNullableString(it, "billing_customer_id") } ?: autoBillingId ?: JSONObject.NULL)
                )
                record.put("property_id", optNullableString(record, "property_id") ?: JSONObject.NULL)
                record.put("order_id", optNullableString(record, "order_id") ?: JSONObject.NULL)
                record.put("appointment_id", optNullableString(record, "appointment_id") ?: JSONObject.NULL)
                record.put("session_id", optNullableString(record, "session_id") ?: JSONObject.NULL)
                record.put("hours", hours)
                record.put("start_time", record.optString("start_time", "07:00"))
                record.put("end_time", record.optString("end_time", "16:00"))
                record.put("break_minutes", record.optInt("break_minutes", 60))
                record.put("hourly_rate", hourlyRate ?: JSONObject.NULL)
                record.put("accounting_amount", accountingAmount ?: JSONObject.NULL)
                record.put("material_cost", materialCost ?: JSONObject.NULL)
                if (!record.has("disposal_cost")) record.put("disposal_cost", JSONObject.NULL)
                record.put("billable", if (record.has("billable")) record.optBoolean("billable", true) else true)
                record.put("is_lcr", nextIsLcr)
                record.put("settlement_id", optNullableString(record, "settlement_id") ?: JSONObject.NULL)
                record.put("customer_visible", if (record.has("customer_visible")) record.optBoolean("customer_visible", true) else true)
                record.put("notes", record.optString("notes", ""))
                record.put("materials", normalizedMats)
                if (record.optJSONArray("photos") == null) record.put("photos", JSONArray())
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: nowIso)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) {
                    arr.put(existingIdx, record)
                } else {
                    prependToArray(arr, record)
                }

                // Recalculate bound invoice if editing an already-settled WorkRecord
                val sid = optNullableString(record, "settlement_id")
                if (sid != null) {
                    val invoices = state.optJSONArray("invoices") ?: JSONArray()
                    for (i in 0 until invoices.length()) {
                        val inv = invoices.optJSONObject(i) ?: continue
                        if (inv.optString("id") != sid || inv.optBoolean("is_storno", false)) continue
                        var boundSum = 0.0
                        for (j in 0 until arr.length()) {
                            val wr = arr.optJSONObject(j) ?: continue
                            if (optNullableString(wr, "settlement_id") == sid) {
                                boundSum += getWorkAccountingAmount(wr)
                            }
                        }
                        boundSum = round2(boundSum)
                        val paidSum = sumInvoicePayments(inv)
                        val nextStatus = when {
                            inv.optString("status") == "cancelled" -> "cancelled"
                            paidSum >= boundSum && boundSum > 0.0 -> "paid"
                            paidSum > 0.0 -> "partially_paid"
                            else -> "unpaid"
                        }
                        inv.put("total_amount", boundSum)
                        inv.put("status", nextStatus)
                    }
                }
            }

            "orders" -> {
                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                val custId = record.optString("customer_id", "").trim()
                if (custId.isEmpty() || findById(customersArr, custId) == null) {
                    throw IllegalArgumentException("Gültige 'customer_id' eines bestehenden Kunden ist für einen Auftrag erforderlich.")
                }
                val statusVal = record.optString("status", "geplant")
                if (statusVal !in listOf("geplant", "in_arbeit", "erledigt")) {
                    throw IllegalArgumentException("Ungültiger Auftragsstatus: Erlaubt sind geplant, in_arbeit, erledigt.")
                }
                record.put("customer_id", custId)
                record.put("title", record.optString("title", "Neuer Auftrag").trim().ifEmpty { "Neuer Auftrag" })
                record.put("status", statusVal)
                if (!record.has("billing_customer_id")) record.put("billing_customer_id", JSONObject.NULL)
                if (!record.has("property_id")) record.put("property_id", JSONObject.NULL)
                if (!record.has("offer_id")) record.put("offer_id", JSONObject.NULL)
                if (!record.has("inquiry_id")) record.put("inquiry_id", JSONObject.NULL)
                record.put("customer_visible", record.optBoolean("customer_visible", true))
                record.put("notes", record.optString("notes", ""))
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: nowIso)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }

            "inquiries" -> {
                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                val custId = record.optString("customer_id", "").trim()
                if (custId.isEmpty() || findById(customersArr, custId) == null) {
                    throw IllegalArgumentException("Gültige 'customer_id' eines bestehenden Kunden ist für eine Anfrage erforderlich.")
                }
                val statusVal = record.optString("status", "neu")
                if (statusVal !in listOf("neu", "angebot_vorbereitet", "angenommen")) {
                    throw IllegalArgumentException("Ungültiger Anfragestatus: Erlaubt sind neu, angebot_vorbereitet, angenommen.")
                }
                record.put("customer_id", custId)
                record.put("title", record.optString("title", "Neue Anfrage").trim().ifEmpty { "Neue Anfrage" })
                record.put("desired_date", assertIsoDate(record.optString("desired_date", today), "desired_date"))
                record.put("notes", record.optString("notes", ""))
                record.put("status", statusVal)

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }

            "offers" -> {
                val customersArr = state.optJSONArray("customers") ?: JSONArray()
                val custId = record.optString("customer_id", "").trim()
                if (custId.isEmpty() || findById(customersArr, custId) == null) {
                    throw IllegalArgumentException("Gültige 'customer_id' eines bestehenden Kunden ist für ein Angebot erforderlich.")
                }
                val statusVal = record.optString("status", "entwurf")
                if (statusVal !in listOf("entwurf", "freigegeben", "angenommen", "abgelehnt")) {
                    throw IllegalArgumentException("Ungültiger Angebotsstatus: Erlaubt sind entwurf, freigegeben, angenommen, abgelehnt.")
                }
                val itemsArr = record.optJSONArray("items") ?: JSONArray()
                val normalizedItems = JSONArray()
                var sumTotal = 0.0
                for (i in 0 until itemsArr.length()) {
                    val it = itemsArr.optJSONObject(i) ?: continue
                    val qty = it.optDouble("quantity", 1.0)
                    val price = it.optDouble("price", 0.0)
                    val tot = if (it.has("total")) round2(it.optDouble("total", 0.0)) else round2(qty * price)
                    sumTotal += tot
                    normalizedItems.put(
                        JSONObject()
                            .put("description", it.optString("description", "Position"))
                            .put("quantity", qty)
                            .put("unit", it.optString("unit", "pauschal"))
                            .put("price", price)
                            .put("total", tot)
                    )
                }
                record.put("customer_id", custId)
                record.put("title", record.optString("title", "Angebot").trim().ifEmpty { "Angebot" })
                record.put("items", normalizedItems)
                record.put(
                    "total_amount",
                    if (payload.has("total_amount")) round2(payload.optDouble("total_amount", 0.0)) else round2(sumTotal)
                )
                record.put("status", statusVal)

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }

            "equipments" -> {
                val itemType = if (record.optString("item_type") == "zubehoer") "zubehoer" else "geraet"
                val statusVal = record.optString("status", "einsatzbereit").lowercase(Locale.ROOT)
                if (statusVal !in listOf("faellig", "einsatzbereit", "wartung")) {
                    throw IllegalArgumentException("Ungültiger Gerätestatus: Erlaubt sind faellig, einsatzbereit, wartung.")
                }
                val nameVal = record.optString("name", "").trim()
                if (nameVal.isEmpty()) {
                    throw IllegalArgumentException("Gerätename ('name') darf nicht leer sein.")
                }

                val reservedKeys = setOf(
                    "id", "item_type", "category", "parent_equipment_id", "name", "model",
                    "photo", "has_photo", "photo_count", "remove_photo", "specs", "quantity",
                    "notes", "status", "last_maintenance", "next_maintenance", "maintenance_plan",
                    "interval_months", "history", "created_at", "updated_at"
                )
                val mergedSpecs = JSONObject()
                val prevSpecs = prev?.optJSONObject("specs")
                if (prevSpecs != null) {
                    val pk = prevSpecs.keys()
                    while (pk.hasNext()) {
                        val k = pk.next()
                        if (k == "created_at" || k == "updated_at" || k == "has_photo" || k == "photo_count") continue
                        val v = prevSpecs.optString(k, "").trim()
                        if (v.isNotEmpty() && !prevSpecs.isNull(k)) {
                            mergedSpecs.put(k, v)
                        }
                    }
                }
                val payloadSpecs = payload.optJSONObject("specs")
                if (payloadSpecs != null) {
                    val nk = payloadSpecs.keys()
                    while (nk.hasNext()) {
                        val k = nk.next()
                        if (k == "created_at" || k == "updated_at" || k == "has_photo" || k == "photo_count" || payloadSpecs.isNull(k) || payloadSpecs.optString(k, "").trim().isEmpty()) {
                            mergedSpecs.remove(k)
                        } else {
                            mergedSpecs.put(k.trim(), payloadSpecs.optString(k, "").trim())
                        }
                    }
                }
                val payloadKeys = payload.keys()
                while (payloadKeys.hasNext()) {
                    val k = payloadKeys.next()
                    if (!reservedKeys.contains(k)) {
                        if (payload.isNull(k) || payload.optString(k, "").trim().isEmpty()) {
                            mergedSpecs.remove(k)
                        } else if (payload.optJSONObject(k) == null && payload.optJSONArray(k) == null) {
                            mergedSpecs.put(k.trim(), payload.optString(k, "").trim())
                        }
                        record.remove(k)
                    }
                }

                val parsedInterval = record.optInt("interval_months", 6).coerceAtLeast(1)
                val lastMaintIso = assertIsoDate(record.optString("last_maintenance", today), "last_maintenance")
                val nextMaintIso = if (payload.has("next_maintenance") && payload.optString("next_maintenance", "").trim().isNotEmpty()) {
                    assertIsoDate(payload.optString("next_maintenance", ""), "next_maintenance")
                } else if ((payload.has("last_maintenance") || payload.has("interval_months")) && !payload.has("next_maintenance")) {
                    addDaysIso(lastMaintIso, parsedInterval * 30)
                } else {
                    assertIsoDate(record.optString("next_maintenance", addDaysIso(lastMaintIso, parsedInterval * 30)), "next_maintenance")
                }

                if (record.has("quantity") && !record.isNull("quantity") && record.optString("quantity", "").trim().isNotEmpty()) {
                    record.put("quantity", record.optInt("quantity", 1).coerceAtLeast(0))
                } else if (itemType == "zubehoer") {
                    record.put("quantity", 1)
                } else {
                    record.put("quantity", JSONObject.NULL)
                }

                val incomingPhoto = payload.optString("photo", "").trim().takeIf { !payload.isNull("photo") && it.isNotEmpty() && it != "null" }
                val prevPhoto = prev?.optString("photo", "")?.trim()?.takeIf { !prev.isNull("photo") && it.isNotEmpty() && it != "null" }
                val resolvedPhoto = if (payload.optBoolean("remove_photo", false)) null else (incomingPhoto ?: prevPhoto)
                record.remove("has_photo")
                record.remove("photo_count")
                record.remove("remove_photo")

                record.put("item_type", itemType)
                record.put("category", record.optString("category", if (itemType == "zubehoer") "zub_kette_schiene" else "motorsaegen"))
                if (!record.has("parent_equipment_id") || record.optString("parent_equipment_id", "").trim().isEmpty()) {
                    record.put("parent_equipment_id", JSONObject.NULL)
                }
                record.put("name", nameVal)
                record.put("model", record.optString("model", ""))
                record.put("photo", resolvedPhoto ?: JSONObject.NULL)
                record.put("specs", mergedSpecs)
                record.put("notes", record.optString("notes", ""))
                record.put("status", statusVal)
                record.put("last_maintenance", lastMaintIso)
                record.put("next_maintenance", nextMaintIso)
                record.put("maintenance_plan", record.optString("maintenance_plan", if (itemType == "zubehoer") "" else "Regelmäßige Prüfung"))
                record.put("interval_months", parsedInterval)
                if (record.optJSONArray("history") == null) record.put("history", JSONArray())
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: nowIso)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }

            "materials" -> {
                val nameVal = record.optString("name", "").trim()
                if (nameVal.isEmpty()) {
                    throw IllegalArgumentException("Materialname ('name') darf nicht leer sein.")
                }
                record.put("name", nameVal)
                record.put("unit", record.optString("unit", "Stück"))
                if (!record.has("price_per_unit")) record.put("price_per_unit", JSONObject.NULL)
                if (!record.has("cost_price_per_unit")) record.put("cost_price_per_unit", JSONObject.NULL)
                record.put("category", record.optString("category", "Allgemein"))
                record.put("item_number", record.optString("item_number", ""))
                record.put("notes", record.optString("notes", ""))
                record.put("active", record.optBoolean("active", true))
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: nowIso)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }

            "expenses" -> {
                val cat = record.optString("category", "sonstiges")
                val validCats = listOf("wareneinsatz", "treibstoff_kfz", "werkzeug_anlage", "versicherung_buero", "sonstiges")
                if (cat !in validCats) {
                    throw IllegalArgumentException("Ungültige Ausgabenkategorie '$cat'. Erlaubt: ${validCats.joinToString(", ")}.")
                }
                record.put("date", assertIsoDate(record.optString("date", today), "date"))
                record.put("title", record.optString("title", "Betriebsausgabe").trim().ifEmpty { "Betriebsausgabe" })
                record.put("amount", max(0.0, round2(record.optDouble("amount", 0.0))))
                record.put("category", cat)
                if (record.has("useful_life_years") && !record.isNull("useful_life_years")) {
                    record.put("useful_life_years", record.optInt("useful_life_years", 5).coerceIn(2, 20))
                } else {
                    record.put("useful_life_years", JSONObject.NULL)
                }
                record.put("notes", record.optString("notes", "").trim())

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }

            else -> {
                record.put("updated_at", nowIso)
                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)
            }
        }

        val deletedIds = state.optJSONObject("deletedIds")
        deletedIds?.remove("$collection:$id")

        return JSONObject()
            .put("ok", true)
            .put("action", if (existingIdx >= 0) "updated" else "created")
            .put("collection", collection)
            .put("id", id)
            .put("record", stripHeavyPhotos(record, false))
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
            throw IllegalArgumentException("Eintrag '$id' in '$collection' nicht gefunden.")
        }

        val nowIso = Instant.now().toString()

        if (collection == "workRecords") {
            val sid = optNullableString(targetObj, "settlement_id")
            if (sid != null) {
                throw IllegalStateException(
                    "Gesperrt: Arbeitsaufzeichnung '$id' ist an Rechnung '$sid' gebunden. Bitte zuerst die Rechnung stornieren oder löschen."
                )
            }
        }

        if (collection == "invoices") {
            val isStorno = targetObj.optBoolean("is_storno", false)
            val invoices = state.optJSONArray("invoices") ?: JSONArray()
            val workRecords = state.optJSONArray("workRecords") ?: JSONArray()

            if (isStorno) {
                val origId = optNullableString(targetObj, "storno_reference_id")
                var otherStornoExists = false
                if (origId != null) {
                    for (i in 0 until invoices.length()) {
                        val inv = invoices.optJSONObject(i) ?: continue
                        if (inv.optString("id") != id && inv.optBoolean("is_storno", false) && optNullableString(inv, "storno_reference_id") == origId) {
                            otherStornoExists = true
                            break
                        }
                    }
                }
                val origInvoice = if (origId != null) findById(invoices, origId) else null
                val updatedInvoices = JSONArray()
                for (i in 0 until invoices.length()) {
                    val inv = invoices.optJSONObject(i) ?: continue
                    if (inv.optString("id") == id) continue
                    if (origId != null && inv.optString("id") == origId && !otherStornoExists) {
                        val paidSum = sumInvoicePayments(inv)
                        val totalAmt = inv.optDouble("total_amount", 0.0)
                        val restoredStatus = when {
                            paidSum >= totalAmt && totalAmt > 0.0 -> "paid"
                            paidSum > 0.0 -> "partially_paid"
                            else -> "unpaid"
                        }
                        inv.put("status", restoredStatus)
                        inv.put("open_refund_amount", 0.0)
                    }
                    updatedInvoices.put(inv)
                }
                state.put("invoices", updatedInvoices)

                if (origInvoice != null && !otherStornoExists) {
                    val origWorkIds = jsonArrayToStringSet(origInvoice.optJSONArray("work_record_ids"))
                    for (i in 0 until workRecords.length()) {
                        val w = workRecords.optJSONObject(i) ?: continue
                        if (origWorkIds.contains(w.optString("id")) && optNullableString(w, "settlement_id") == null && !w.optBoolean("is_lcr", false)) {
                            w.put("settlement_id", origInvoice.optString("id"))
                        }
                    }
                }
            } else {
                val updatedInvoices = JSONArray()
                for (i in 0 until invoices.length()) {
                    val inv = invoices.optJSONObject(i) ?: continue
                    if (inv.optString("id") == id) continue
                    if (optNullableString(inv, "storno_reference_id") == id) {
                        inv.put("storno_reference_id", JSONObject.NULL)
                    }
                    updatedInvoices.put(inv)
                }
                state.put("invoices", updatedInvoices)

                for (i in 0 until workRecords.length()) {
                    val w = workRecords.optJSONObject(i) ?: continue
                    if (optNullableString(w, "settlement_id") == id) {
                        w.put("settlement_id", JSONObject.NULL)
                    }
                }
            }

            addTombstone(state, "invoices", id, nowIso)
            return JSONObject()
                .put("ok", true)
                .put("deleted", true)
                .put("collection", "invoices")
                .put("id", id)
        }

        // Remove from target collection
        val updatedArr = JSONArray()
        for (i in 0 until arr.length()) {
            if (i != targetIdx) updatedArr.put(arr.get(i))
        }
        state.put(collection, updatedArr)
        addTombstone(state, collection, id, nowIso)

        if (collection == "customers") {
            val props = state.optJSONArray("properties") ?: JSONArray()
            val deletedPropIds = mutableSetOf<String>()
            val keptProps = JSONArray()
            for (i in 0 until props.length()) {
                val p = props.optJSONObject(i) ?: continue
                if (p.optString("customer_id") == id) {
                    deletedPropIds.add(p.optString("id"))
                    addTombstone(state, "properties", p.optString("id"), nowIso)
                } else {
                    keptProps.put(p)
                }
            }
            state.put("properties", keptProps)

            val appts = state.optJSONArray("appointments") ?: JSONArray()
            val keptAppts = JSONArray()
            for (i in 0 until appts.length()) {
                val a = appts.optJSONObject(i) ?: continue
                if (a.optString("customer_id") == id) {
                    addTombstone(state, "appointments", a.optString("id"), nowIso)
                } else {
                    val pid = optNullableString(a, "property_id")
                    if (pid != null && deletedPropIds.contains(pid)) {
                        a.put("property_id", JSONObject.NULL)
                    }
                    keptAppts.put(a)
                }
            }
            state.put("appointments", keptAppts)

            val wrs = state.optJSONArray("workRecords") ?: JSONArray()
            val keptWrs = JSONArray()
            for (i in 0 until wrs.length()) {
                val w = wrs.optJSONObject(i) ?: continue
                if (w.optString("customer_id") == id && optNullableString(w, "settlement_id") == null) {
                    addTombstone(state, "workRecords", w.optString("id"), nowIso)
                } else {
                    if (optNullableString(w, "billing_customer_id") == id) {
                        w.put("billing_customer_id", JSONObject.NULL)
                    }
                    val pid = optNullableString(w, "property_id")
                    if (pid != null && deletedPropIds.contains(pid)) {
                        w.put("property_id", JSONObject.NULL)
                    }
                    keptWrs.put(w)
                }
            }
            state.put("workRecords", keptWrs)

            for (subCol in listOf("inquiries", "offers", "orders")) {
                val subArr = state.optJSONArray(subCol) ?: JSONArray()
                val keptSub = JSONArray()
                for (i in 0 until subArr.length()) {
                    val item = subArr.optJSONObject(i) ?: continue
                    if (item.optString("customer_id") == id) {
                        addTombstone(state, subCol, item.optString("id"), nowIso)
                    } else {
                        keptSub.put(item)
                    }
                }
                state.put(subCol, keptSub)
            }

            val custs = state.optJSONArray("customers") ?: JSONArray()
            for (i in 0 until custs.length()) {
                val c = custs.optJSONObject(i) ?: continue
                if (optNullableString(c, "default_billing_customer_id") == id) {
                    c.put("billing_mode", "standard")
                    c.put("default_billing_customer_id", JSONObject.NULL)
                }
            }
        } else if (collection == "properties") {
            for (subCol in listOf("workRecords", "appointments", "orders")) {
                val subArr = state.optJSONArray(subCol) ?: JSONArray()
                for (i in 0 until subArr.length()) {
                    val item = subArr.optJSONObject(i) ?: continue
                    if (optNullableString(item, "property_id") == id) {
                        item.put("property_id", JSONObject.NULL)
                    }
                }
            }
        } else if (collection == "workRecords") {
            val invoices = state.optJSONArray("invoices") ?: JSONArray()
            for (i in 0 until invoices.length()) {
                val inv = invoices.optJSONObject(i) ?: continue
                val wids = inv.optJSONArray("work_record_ids") ?: continue
                val filtered = JSONArray()
                for (j in 0 until wids.length()) {
                    val wid = wids.optString(j)
                    if (wid != id) filtered.put(wid)
                }
                inv.put("work_record_ids", filtered)
            }
        } else if (collection == "equipments") {
            val eqs = state.optJSONArray("equipments") ?: JSONArray()
            for (i in 0 until eqs.length()) {
                val eq = eqs.optJSONObject(i) ?: continue
                if (optNullableString(eq, "parent_equipment_id") == id) {
                    eq.put("parent_equipment_id", JSONObject.NULL)
                }
            }
        }

        return JSONObject()
            .put("ok", true)
            .put("deleted", true)
            .put("collection", collection)
            .put("id", id)
    }

    private fun toggleLcrInState(
        state: JSONObject,
        idsArr: JSONArray,
        explicitTarget: Boolean?
    ): JSONObject {
        val ids = mutableListOf<String>()
        for (i in 0 until idsArr.length()) {
            val id = idsArr.optString(i, "").trim()
            if (id.isNotEmpty() && !ids.contains(id)) ids.add(id)
        }
        if (ids.isEmpty()) {
            throw IllegalArgumentException("Mindestens eine Arbeitsaufzeichnungs-ID ('work_record_ids') ist erforderlich.")
        }

        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val nowIso = Instant.now().toString()
        val changedIds = JSONArray()
        val updatedRecords = JSONArray()

        for (targetId in ids) {
            val rec = findById(workRecords, targetId)
                ?: throw IllegalArgumentException("Arbeitsaufzeichnung '$targetId' nicht gefunden.")
            if (optNullableString(rec, "settlement_id") != null) {
                throw IllegalStateException(
                    "Gesperrt: Arbeit '${rec.optString("title")}' ($targetId) ist fest an eine ausgestellte Rechnung gebunden. Stornierung nötig."
                )
            }
            val currentVal = rec.optBoolean("is_lcr", false)
            val nextVal = explicitTarget ?: !currentVal
            if (currentVal != nextVal) {
                rec.put("is_lcr", nextVal)
                rec.put("updated_at", nowIso)
                changedIds.put(targetId)
            }
            updatedRecords.put(stripHeavyPhotos(rec, false))
        }

        return JSONObject()
            .put("ok", true)
            .put("changedCount", changedIds.length())
            .put("changedIds", changedIds)
            .put("records", updatedRecords)
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
        val eq = findById(equipments, equipmentId)
            ?: throw IllegalArgumentException("Gerät '$equipmentId' nicht gefunden.")

        val maintDate = maint.optString("date", "").trim().ifEmpty { todayIso() }.let {
            assertIsoDate(it, "date")
        }
        val intervalMonths = eq.optInt("interval_months", 6).coerceAtLeast(1)
        val nextDate = maint.optString("next_maintenance", "").trim().ifEmpty {
            addDaysIso(maintDate, intervalMonths * 30)
        }.let { assertIsoDate(it, "next_maintenance") }

        val plan = maint.optString("plan", "").trim()
            .ifEmpty { eq.optString("maintenance_plan", "Regelmäßige Prüfung") }
        val note = maint.optString("note", "").trim().ifEmpty { "Wartung durchgeführt" }

        val history = eq.optJSONArray("history") ?: JSONArray()
        val newHistory = JSONArray()
        newHistory.put(
            JSONObject()
                .put("date", maintDate)
                .put("note", note)
                .put("plan", plan)
        )
        for (i in 0 until history.length()) {
            newHistory.put(history.get(i))
        }

        eq.put("status", "einsatzbereit")
        eq.put("last_maintenance", maintDate)
        eq.put("next_maintenance", nextDate)
        eq.put("maintenance_plan", plan)
        eq.put("history", newHistory)
        eq.put("updated_at", Instant.now().toString())

        return JSONObject()
            .put("ok", true)
            .put("equipment", stripHeavyPhotos(eq, false))
    }

    private fun updateTaxSettingsInState(state: JSONObject, patch: JSONObject): JSONObject {
        val current = state.optJSONObject("taxSettings") ?: JSONObject()
        val validMethods = listOf("auto_best", "ku_pauschal_45", "ku_pauschal_20", "basis_pauschal_15", "ear_echt")

        if (patch.has("preferred_method") && !patch.isNull("preferred_method")) {
            val m = patch.optString("preferred_method", "")
            if (m !in validMethods) {
                throw IllegalArgumentException("Ungültige Gewinnermittlungsart '$m'. Erlaubt: ${validMethods.joinToString(", ")}.")
            }
            current.put("preferred_method", m)
        }
        if (patch.has("workplace_allowance") && !patch.isNull("workplace_allowance")) {
            val w = patch.optInt("workplace_allowance", -1)
            if (w !in listOf(0, 300, 1200)) {
                throw IllegalArgumentException("Arbeitsplatzpauschale ('workplace_allowance') darf nur 0, 300 oder 1200 sein.")
            }
            current.put("workplace_allowance", w)
        }
        if (patch.has("selected_year") && !patch.isNull("selected_year")) {
            current.put("selected_year", patch.optInt("selected_year", 2026))
        }
        if (patch.has("svs_paid") && !patch.isNull("svs_paid")) {
            current.put("svs_paid", max(0.0, round2(patch.optDouble("svs_paid", 0.0))))
        }
        if (patch.has("transit_ticket_full") && !patch.isNull("transit_ticket_full")) {
            current.put("transit_ticket_full", max(0.0, round2(patch.optDouble("transit_ticket_full", 0.0))))
        }
        if (patch.has("manual_extra_income") && !patch.isNull("manual_extra_income")) {
            current.put("manual_extra_income", max(0.0, round2(patch.optDouble("manual_extra_income", 0.0))))
        }

        state.put("taxSettings", current)
        return JSONObject()
            .put("ok", true)
            .put("taxSettings", current)
            .put("guvSummary", calculateGuvSummaryJson(state, null))
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
        val properties = state.optJSONArray("properties") ?: JSONArray()
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val invoices = state.optJSONArray("invoices") ?: JSONArray().also { state.put("invoices", it) }

        val billingCust = findById(customers, customerId)
            ?: throw IllegalArgumentException("Kunde mit ID '$customerId' nicht gefunden.")

        val requestedIds = mutableListOf<String>()
        val reqArr = args.optJSONArray("work_record_ids")
        if (reqArr != null) {
            for (i in 0 until reqArr.length()) {
                val wid = reqArr.optString(i, "").trim()
                if (wid.isNotEmpty() && !requestedIds.contains(wid)) requestedIds.add(wid)
            }
        }

        val candidateRecords = mutableListOf<JSONObject>()
        if (requestedIds.isNotEmpty()) {
            for (wid in requestedIds) {
                val rec = findById(workRecords, wid)
                    ?: throw IllegalArgumentException("Arbeitsaufzeichnung '$wid' nicht gefunden.")
                val sid = optNullableString(rec, "settlement_id")
                if (sid != null) {
                    throw IllegalStateException("Arbeitsaufzeichnung '${rec.optString("title")}' ($wid) ist bereits in Rechnung '$sid' abgerechnet.")
                }
                if (rec.optBoolean("is_lcr", false)) {
                    throw IllegalStateException("Arbeitsaufzeichnung '${rec.optString("title")}' ($wid) ist als L.C.R. markiert und kann nicht regulär fakturiert werden.")
                }
                if (!rec.optBoolean("billable", true)) {
                    throw IllegalStateException("Arbeitsaufzeichnung '${rec.optString("title")}' ($wid) ist als nicht abrechenbar ('billable: false') markiert.")
                }
                candidateRecords.add(rec)
            }
        } else {
            for (i in 0 until workRecords.length()) {
                val w = workRecords.optJSONObject(i) ?: continue
                if (
                    optNullableString(w, "settlement_id") == null &&
                    !w.optBoolean("is_lcr", false) &&
                    w.optBoolean("billable", true) &&
                    getEffectiveBillingCustomerId(w, customers) == customerId
                ) {
                    candidateRecords.add(w)
                }
            }
        }

        val extraArr = args.optJSONArray("extra_items") ?: JSONArray()
        if (candidateRecords.isEmpty() && extraArr.length() == 0) {
            throw IllegalStateException("Keine offenen abrechenbaren Arbeitsaufzeichnungen oder Zusatzpositionen für diesen Kunden vorhanden.")
        }

        val issueDate = args.optString("issue_date", "").trim().ifEmpty { todayIso() }.let {
            assertIsoDate(it, "issue_date")
        }
        val paidInCash = args.optBoolean("paid_in_cash", false)
        val dueDays = if (paidInCash) 0 else args.optInt("due_days", 14).coerceAtLeast(0)
        val dueDate = addDaysIso(issueDate, dueDays)

        val sortedRecords = candidateRecords.sortedBy { it.optString("work_date", "") }
        val lineItems = JSONArray()

        for (rec in sortedRecords) {
            val recId = rec.optString("id")
            val hours = rec.optDouble("hours", 0.0)
            val hasRate = rec.has("hourly_rate") && !rec.isNull("hourly_rate")
            val rate = if (hasRate) rec.optDouble("hourly_rate", 50.0) else null
            val workAmount = if (rate != null) round2(hours * rate) else getWorkAccountingAmount(rec)

            var itemDesc = rec.optString("title", "Gartenarbeit")
            val recCustId = rec.optString("customer_id")
            if (recCustId != customerId) {
                val origCust = findById(customers, recCustId)
                val propId = optNullableString(rec, "property_id")
                val prop = if (propId != null) findById(properties, propId) else null
                val origName = origCust?.optString("name", "") ?: ""
                val propName = prop?.optString("name", "") ?: ""
                itemDesc = when {
                    origName.isNotEmpty() && propName.isNotEmpty() && propName != origName ->
                        "$itemDesc ($origName – $propName)"
                    propName.isNotEmpty() -> "$itemDesc ($propName)"
                    origName.isNotEmpty() -> "$itemDesc ($origName)"
                    else -> itemDesc
                }
            }

            lineItems.put(
                JSONObject()
                    .put("id", "li-$recId")
                    .put("description", itemDesc)
                    .put("quantity_label", "${formatDec(hours)} Std")
                    .put("unit_price_label", if (rate != null) "${formatDec(rate)} EUR" else "Pauschal")
                    .put("amount", workAmount)
            )

            val mats = rec.optJSONArray("materials") ?: JSONArray()
            for (mIdx in 0 until mats.length()) {
                val mat = mats.optJSONObject(mIdx) ?: continue
                val qty = mat.optDouble("quantity", 1.0)
                val ppu = if (mat.has("price_per_unit") && !mat.isNull("price_per_unit")) {
                    mat.optDouble("price_per_unit", 0.0)
                } else null
                val matTotal = when {
                    mat.has("total") && !mat.isNull("total") -> round2(mat.optDouble("total", 0.0))
                    ppu != null -> round2(qty * ppu)
                    else -> 0.0
                }
                lineItems.put(
                    JSONObject()
                        .put("id", "li-mat-$recId-${mat.optString("material_id", "$mIdx")}")
                        .put("description", mat.optString("name", "Material"))
                        .put("quantity_label", "${formatDec(qty)} ${mat.optString("unit", "Stück")}")
                        .put("unit_price_label", if (ppu != null) "${formatDec(ppu)} EUR" else "inkl.")
                        .put("amount", matTotal)
                )
            }
        }

        for (i in 0 until extraArr.length()) {
            val ex = extraArr.optJSONObject(i) ?: continue
            val amt = round2(ex.optDouble("amount", 0.0))
            lineItems.put(
                JSONObject()
                    .put("id", ex.optString("id", "li-extra-${System.currentTimeMillis()}-$i"))
                    .put("description", ex.optString("description", "Zusatzposition"))
                    .put("quantity_label", ex.optString("quantity_label", "1,00 Psch"))
                    .put("unit_price_label", ex.optString("unit_price_label", "${formatDec(amt)} EUR"))
                    .put("amount", amt)
            )
        }

        var totalAmount = 0.0
        for (i in 0 until lineItems.length()) {
            totalAmount += lineItems.optJSONObject(i)?.optDouble("amount", 0.0) ?: 0.0
        }
        totalAmount = round2(totalAmount)

        val invoiceNumber = args.optString("invoice_number", "").trim()
            .ifEmpty { computeNextInvoiceNumber(invoices, issueDate) }
        val servicePeriod = args.optString("service_period", "").trim()
            .ifEmpty { computeServicePeriod(sortedRecords, issueDate) }
        val paymentTermsText = args.optString("payment_terms_text", "").trim()
            .ifEmpty { buildPaymentTermsClause(dueDays, paidInCash) }

        val payments = JSONArray()
        if (paidInCash && totalAmount > 0.0) {
            payments.put(
                JSONObject()
                    .put("id", "pay-cash-${System.currentTimeMillis()}")
                    .put("date", issueDate)
                    .put("amount", totalAmount)
                    .put("is_reversal", false)
                    .put("reversal_of", JSONObject.NULL)
                    .put("note", "Barzahlung bei Rechnungslegung")
            )
        }

        val invoiceId = generateRecordId("invoices")
        val recordIdsArr = JSONArray()
        for (rec in candidateRecords) {
            val wid = rec.optString("id")
            recordIdsArr.put(wid)
            rec.put("settlement_id", invoiceId)
        }

        val newInvoice = JSONObject()
            .put("id", invoiceId)
            .put("invoice_number", invoiceNumber)
            .put("customer_id", customerId)
            .put(
                "customer_number",
                args.optString("customer_number", "").trim()
                    .ifEmpty { resolveCustomerNumber(customerId, customers) }
            )
            .put("billing_customer_name", billingCust.optString("name", ""))
            .put("recipient_street", billingCust.optString("street", ""))
            .put("recipient_zip", billingCust.optString("zip", ""))
            .put("recipient_city", billingCust.optString("city", ""))
            .put("service_period", servicePeriod)
            .put("line_items", lineItems)
            .put("issue_date", issueDate)
            .put("due_date", dueDate)
            .put("payment_terms_text", paymentTermsText)
            .put("paid_in_cash", paidInCash)
            .put("total_amount", totalAmount)
            .put("status", if (paidInCash && totalAmount > 0.0) "paid" else "unpaid")
            .put("work_record_ids", recordIdsArr)
            .put("is_storno", false)
            .put("storno_reference_id", JSONObject.NULL)
            .put("storno_reason", JSONObject.NULL)
            .put("payments", payments)
            .put("open_refund_amount", 0.0)
            .put("sent_at", JSONObject.NULL)
            .put("sent_via", JSONObject.NULL)

        prependToArray(invoices, newInvoice)

        return JSONObject()
            .put("ok", true)
            .put("action", "create_invoice")
            .put("invoice", newInvoice)
    }

    private fun payInvoiceInState(
        state: JSONObject,
        mode: String,
        args: JSONObject
    ): JSONObject {
        val invRef = args.optString("invoice_id", "").trim()
        if (invRef.isEmpty()) {
            throw IllegalArgumentException("invoice_id ist erforderlich.")
        }
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        var inv: JSONObject? = null
        for (i in 0 until invoices.length()) {
            val candidate = invoices.optJSONObject(i) ?: continue
            if (candidate.optString("id") == invRef || candidate.optString("invoice_number") == invRef) {
                inv = candidate
                break
            }
        }
        if (inv == null) {
            throw IllegalArgumentException("Rechnung '$invRef' nicht gefunden.")
        }

        val dateStr = args.optString("date", "").trim().ifEmpty { todayIso() }.let {
            assertIsoDate(it, "date")
        }
        val payments = inv.optJSONArray("payments") ?: JSONArray().also { inv.put("payments", it) }

        when (mode) {
            "update_payment" -> {
                val payId = args.optString("payment_id", "").trim()
                val targetPay = findById(payments, payId)
                    ?: throw IllegalArgumentException("Zahlung '$payId' in Rechnung ${inv.optString("invoice_number")} nicht gefunden.")
                if (args.has("date")) targetPay.put("date", dateStr)
                if (args.has("amount") && !args.isNull("amount")) {
                    targetPay.put("amount", round2(args.optDouble("amount", 0.0)))
                }
                if (args.has("note")) targetPay.put("note", args.optString("note", ""))
                recomputeInvoicePaymentStatus(inv)
            }

            "reverse_payment" -> {
                val payId = args.optString("payment_id", "").trim()
                val origPay = findById(payments, payId)
                    ?: throw IllegalArgumentException("Zahlung '$payId' in Rechnung ${inv.optString("invoice_number")} nicht gefunden.")
                val reversal = JSONObject()
                    .put("id", "rev-${System.currentTimeMillis()}")
                    .put("date", dateStr)
                    .put("amount", -origPay.optDouble("amount", 0.0))
                    .put("is_reversal", true)
                    .put("reversal_of", origPay.optString("id"))
                    .put("note", "Gegenbuchung: ${args.optString("note", "Korrektur")}")
                payments.put(reversal)
                recomputeInvoicePaymentStatus(inv)
            }

            "delete_payment" -> {
                val payId = args.optString("payment_id", "").trim()
                if (findById(payments, payId) == null) {
                    throw IllegalArgumentException("Zahlung '$payId' in Rechnung ${inv.optString("invoice_number")} nicht gefunden.")
                }
                val filtered = JSONArray()
                for (i in 0 until payments.length()) {
                    val p = payments.optJSONObject(i) ?: continue
                    if (p.optString("id") != payId) filtered.put(p)
                }
                inv.put("payments", filtered)
                recomputeInvoicePaymentStatus(inv)
            }

            "refund" -> {
                val defaultRefund = inv.optDouble("open_refund_amount", 0.0)
                val refundAmt = round2(
                    max(
                        0.0,
                        if (args.has("amount") && !args.isNull("amount")) args.optDouble("amount", 0.0) else defaultRefund
                    )
                )
                if (refundAmt <= 0.0) {
                    throw IllegalArgumentException("Rückzahlungsbetrag ('amount') muss größer als 0 sein.")
                }
                val targetOrigId = if (inv.optBoolean("is_storno", false) && optNullableString(inv, "storno_reference_id") != null) {
                    optNullableString(inv, "storno_reference_id")!!
                } else {
                    inv.optString("id")
                }

                for (i in 0 until invoices.length()) {
                    val candidate = invoices.optJSONObject(i) ?: continue
                    if (
                        candidate.optString("id") == targetOrigId ||
                        optNullableString(candidate, "storno_reference_id") == targetOrigId
                    ) {
                        val rem = max(0.0, round2(candidate.optDouble("open_refund_amount", 0.0) - refundAmt))
                        val candPays = candidate.optJSONArray("payments") ?: JSONArray().also { candidate.put("payments", it) }
                        candPays.put(
                            JSONObject()
                                .put("id", "ref-${System.currentTimeMillis()}-$i")
                                .put("date", dateStr)
                                .put("amount", -refundAmt)
                                .put("is_reversal", false)
                                .put("reversal_of", JSONObject.NULL)
                                .put("note", "Tatsächliche Rückzahlung: ${args.optString("note", "Erstattung")}")
                        )
                        candidate.put("open_refund_amount", rem)
                    }
                }
            }

            else -> {
                // Standard 'pay'
                if (inv.optBoolean("is_storno", false) || inv.optString("status") == "cancelled") {
                    throw IllegalStateException("Auf eine stornierte Rechnung kann keine reguläre Zahlung gebucht werden.")
                }
                val alreadyPaid = sumInvoicePayments(inv)
                val total = inv.optDouble("total_amount", 0.0)
                val remaining = max(0.0, round2(total - alreadyPaid))
                val payAmt = if (args.has("amount") && !args.isNull("amount")) {
                    round2(args.optDouble("amount", 0.0))
                } else {
                    remaining
                }
                if (payAmt <= 0.0) {
                    throw IllegalArgumentException("Zahlungsbetrag muss größer als 0 EUR sein (oder Rechnung ist bereits vollständig bezahlt).")
                }
                payments.put(
                    JSONObject()
                        .put("id", "pay-${System.currentTimeMillis()}")
                        .put("date", dateStr)
                        .put("amount", payAmt)
                        .put("is_reversal", false)
                        .put("reversal_of", JSONObject.NULL)
                        .put("note", args.optString("note", "Zahlung über MCP erfasst"))
                )
                recomputeInvoicePaymentStatus(inv)
            }
        }

        return JSONObject()
            .put("ok", true)
            .put("action", mode)
            .put("invoice", inv)
    }

    private fun recomputeInvoicePaymentStatus(inv: JSONObject) {
        val totalPaid = sumInvoicePayments(inv)
        val total = inv.optDouble("total_amount", 0.0)
        val curStatus = inv.optString("status", "unpaid")
        val nextStatus = when {
            curStatus == "cancelled" -> "cancelled"
            totalPaid >= total && total > 0.0 -> "paid"
            totalPaid > 0.0 -> "partially_paid"
            else -> "unpaid"
        }
        inv.put("status", nextStatus)
        if (curStatus == "cancelled" && !inv.optBoolean("is_storno", false)) {
            inv.put("open_refund_amount", max(0.0, totalPaid))
        }
    }

    private fun stornoInvoiceInState(state: JSONObject, args: JSONObject): JSONObject {
        val invRef = args.optString("invoice_id", "").trim()
        if (invRef.isEmpty()) {
            throw IllegalArgumentException("invoice_id ist für storno erforderlich.")
        }
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        var orig: JSONObject? = null
        for (i in 0 until invoices.length()) {
            val candidate = invoices.optJSONObject(i) ?: continue
            if (candidate.optString("id") == invRef || candidate.optString("invoice_number") == invRef) {
                orig = candidate
                break
            }
        }
        if (orig == null) {
            throw IllegalArgumentException("Rechnung '$invRef' nicht gefunden.")
        }
        if (orig.optBoolean("is_storno", false)) {
            throw IllegalStateException("Ein Stornobeleg kann nicht erneut storniert werden.")
        }
        if (orig.optString("status") == "cancelled") {
            throw IllegalStateException("Rechnung '${orig.optString("invoice_number")}' ist bereits storniert.")
        }

        val issueDate = args.optString("issue_date", "").trim().ifEmpty { todayIso() }.let {
            assertIsoDate(it, "issue_date")
        }
        val reason = args.optString("reason", "").trim().ifEmpty { "Rechnungskorrektur / Storno" }
        val totalPaid = sumInvoicePayments(orig)
        val stornoNum = computeNextStornoNumber(invoices, issueDate)

        val origItems = orig.optJSONArray("line_items") ?: JSONArray()
        val stornoItems = JSONArray()
        for (i in 0 until origItems.length()) {
            val li = origItems.optJSONObject(i) ?: continue
            val copyLi = JSONObject(li.toString())
            copyLi.put("id", "storno-${li.optString("id", "$i")}")
            copyLi.put("amount", -abs(li.optDouble("amount", 0.0)))
            stornoItems.put(copyLi)
        }

        val stornoDoc = JSONObject()
            .put("id", "storno-${System.currentTimeMillis()}")
            .put("invoice_number", stornoNum)
            .put("customer_id", orig.optString("customer_id"))
            .put("customer_number", orig.optString("customer_number", "1001"))
            .put("billing_customer_name", orig.optString("billing_customer_name", ""))
            .put("recipient_street", orig.optString("recipient_street", ""))
            .put("recipient_zip", orig.optString("recipient_zip", ""))
            .put("recipient_city", orig.optString("recipient_city", ""))
            .put("service_period", orig.opt("service_period") ?: JSONObject.NULL)
            .put("line_items", stornoItems)
            .put("issue_date", issueDate)
            .put("due_date", issueDate)
            .put("total_amount", -abs(orig.optDouble("total_amount", 0.0)))
            .put("status", "cancelled")
            .put("work_record_ids", JSONArray((orig.optJSONArray("work_record_ids") ?: JSONArray()).toString()))
            .put("is_storno", true)
            .put("storno_reference_id", orig.optString("id"))
            .put("storno_reason", reason)
            .put("payments", JSONArray())
            .put("open_refund_amount", if (totalPaid > 0.0) totalPaid else 0.0)
            .put("sent_at", JSONObject.NULL)
            .put("sent_via", JSONObject.NULL)

        orig.put("status", "cancelled")
        orig.put("open_refund_amount", if (totalPaid > 0.0) totalPaid else 0.0)

        prependToArray(invoices, stornoDoc)

        val origId = orig.optString("id")
        val boundIds = jsonArrayToStringSet(orig.optJSONArray("work_record_ids"))
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        for (i in 0 until workRecords.length()) {
            val w = workRecords.optJSONObject(i) ?: continue
            if (boundIds.contains(w.optString("id")) || optNullableString(w, "settlement_id") == origId) {
                w.put("settlement_id", JSONObject.NULL)
            }
        }

        return JSONObject()
            .put("ok", true)
            .put("action", "storno")
            .put("stornoInvoice", stornoDoc)
            .put("cancelledOriginalId", origId)
    }

    /**
     * 1:1 Umsetzung von `calculateGuvSummary` aus `src/utils/guvCalculator.ts`
     * (Österreichisches EStG 2026, Zufluss-Abfluss-Prinzip § 19 EStG, GWG § 13 EStG, AfA § 7 EStG).
     */
    private fun calculateGuvSummaryJson(state: JSONObject, explicitYear: Int?): JSONObject {
        val taxSettings = state.optJSONObject("taxSettings") ?: JSONObject()
        val year = explicitYear ?: taxSettings.optInt("selected_year", 2026)
        val yearPrefix = "$year-"
        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        val expenses = state.optJSONArray("expenses") ?: JSONArray()

        var paidInvoiceIncomeInYear = 0.0
        var invoicedIncomeInYear = 0.0
        var openReceivablesTotal = 0.0

        for (i in 0 until invoices.length()) {
            val inv = invoices.optJSONObject(i) ?: continue
            val isStorno = inv.optBoolean("is_storno", false)
            val status = inv.optString("status", "unpaid")
            if (!isStorno && status != "cancelled") {
                val issueDate = inv.optString("issue_date", "")
                val totalAmt = inv.optDouble("total_amount", 0.0)
                if (issueDate.startsWith(yearPrefix)) {
                    invoicedIncomeInYear += totalAmt
                }
                val totalPaidAllTime = sumInvoicePayments(inv)
                openReceivablesTotal += max(0.0, totalAmt - totalPaidAllTime)
            }
            val pays = inv.optJSONArray("payments") ?: JSONArray()
            for (j in 0 until pays.length()) {
                val p = pays.optJSONObject(j) ?: continue
                val pDate = p.optString("date", "")
                if (pDate.startsWith(yearPrefix)) {
                    paidInvoiceIncomeInYear += p.optDouble("amount", 0.0)
                }
            }
        }

        paidInvoiceIncomeInYear = round2(max(0.0, paidInvoiceIncomeInYear))
        invoicedIncomeInYear = round2(max(0.0, invoicedIncomeInYear))
        openReceivablesTotal = round2(max(0.0, openReceivablesTotal))

        val manualExtraIncome = round2(max(0.0, taxSettings.optDouble("manual_extra_income", 0.0)))
        val totalCashIncome = round2(paidInvoiceIncomeInYear + manualExtraIncome)

        val kuLimitUsedPercent = min(125, ((totalCashIncome / 55000.0) * 100.0).roundToInt())
        val kuStatus = when {
            totalCashIncome <= 55000.0 -> "ok"
            totalCashIncome <= 60500.0 -> "tolerance"
            else -> "exceeded"
        }
        val kuEligible = totalCashIncome <= 60500.0
        val basisLimit = if (year >= 2026) 420000.0 else 320000.0
        val basisRate = if (year >= 2026) 0.15 else 0.135

        var wareneinsatzTotal = 0.0
        var runningOtherTotal = 0.0
        var gwgTotal = 0.0
        var afaTotal = 0.0

        for (i in 0 until expenses.length()) {
            val exp = expenses.optJSONObject(i) ?: continue
            val dateStr = exp.optString("date", "")
            val expYear = dateStr.take(4).toIntOrNull() ?: continue
            val expMonth = dateStr.drop(5).take(2).toIntOrNull() ?: 1
            val amount = max(0.0, exp.optDouble("amount", 0.0))
            val category = exp.optString("category", "sonstiges")

            if (category != "werkzeug_anlage") {
                if (expYear == year) {
                    if (category == "wareneinsatz") {
                        wareneinsatzTotal += round2(amount)
                    } else {
                        runningOtherTotal += round2(amount)
                    }
                }
            } else if (amount <= 1000.0) {
                if (expYear == year) {
                    gwgTotal += round2(amount)
                }
            } else {
                val lifeYears = exp.optInt("useful_life_years", 5).coerceIn(2, 20)
                val annualRate = amount / lifeYears.toDouble()
                val isSecondHalf = expMonth >= 7
                if (!isSecondHalf) {
                    if (year in expYear until (expYear + lifeYears)) {
                        afaTotal += round2(annualRate)
                    }
                } else {
                    when {
                        year == expYear || year == expYear + lifeYears -> afaTotal += round2(annualRate * 0.5)
                        year in (expYear + 1) until (expYear + lifeYears) -> afaTotal += round2(annualRate)
                    }
                }
            }
        }

        wareneinsatzTotal = round2(wareneinsatzTotal)
        runningOtherTotal = round2(runningOtherTotal)
        gwgTotal = round2(gwgTotal)
        afaTotal = round2(afaTotal)
        val totalActualExpensesAndAfa = round2(wareneinsatzTotal + runningOtherTotal + gwgTotal + afaTotal)

        val svsDeduction = round2(max(0.0, taxSettings.optDouble("svs_paid", 0.0)))
        val workplaceDeduction = if (year <= 2026) taxSettings.optDouble("workplace_allowance", 0.0) else 0.0
        val transitDeduction = round2(max(0.0, taxSettings.optDouble("transit_ticket_full", 0.0) * 0.5))
        val additionalDeductions = round2(svsDeduction + workplaceDeduction + transitDeduction)

        fun computeGrundfreibetrag(prelimProfit: Double): Double {
            if (prelimProfit <= 0.0) return 0.0
            return round2(min(prelimProfit, 33000.0) * 0.15)
        }

        fun buildMethod(
            key: String,
            title: String,
            shortTitle: String,
            eligible: Boolean,
            flatDeduction: Double,
            flatPercent: Double?,
            actualGoods: Double,
            depreciation: Double,
            prelim: Double
        ): JSONObject {
            val gfb = computeGrundfreibetrag(prelim)
            val taxable = round2(prelim - gfb)
            val est = estimateAustrianIncomeTax2026(taxable)
            return JSONObject()
                .put("key", key)
                .put("title", title)
                .put("shortTitle", shortTitle)
                .put("eligible", eligible)
                .put("totalIncome", totalCashIncome)
                .put("flatRateDeduction", flatDeduction)
                .put("flatRatePercent", flatPercent ?: JSONObject.NULL)
                .put("actualRunningAndGoods", actualGoods)
                .put("depreciationGwgAfa", depreciation)
                .put("additionalDeductions", additionalDeductions)
                .put("svsDeduction", svsDeduction)
                .put("workplaceDeduction", workplaceDeduction)
                .put("transitDeduction", transitDeduction)
                .put("preliminaryProfit", prelim)
                .put("grundfreibetrag", gfb)
                .put("taxableProfit", taxable)
                .put("estimatedIncomeTax", est)
        }

        val ku45Flat = round2(min(totalCashIncome, min(totalCashIncome * 0.45, 24750.0)))
        val ku45Prelim = round2(totalCashIncome - ku45Flat - additionalDeductions)
        val mKu45 = buildMethod(
            "ku_pauschal_45",
            "Kleinunternehmerpauschalierung 45 % (Handwerk / Regelbetrieb)",
            "KU-Pauschale 45 %",
            kuEligible,
            ku45Flat,
            45.0,
            0.0,
            0.0,
            ku45Prelim
        )

        val ku20Flat = round2(min(totalCashIncome, min(totalCashIncome * 0.20, 11000.0)))
        val ku20Prelim = round2(totalCashIncome - ku20Flat - additionalDeductions)
        val mKu20 = buildMethod(
            "ku_pauschal_20",
            "Kleinunternehmerpauschalierung 20 % (Dienstleistung lt. DLB-V)",
            "KU-Pauschale 20 %",
            kuEligible,
            ku20Flat,
            20.0,
            0.0,
            0.0,
            ku20Prelim
        )

        val basisEligible = totalCashIncome <= basisLimit
        val basisFlatMax = if (year >= 2026) 63000.0 else 43200.0
        val basisFlat = round2(min(totalCashIncome, min(totalCashIncome * basisRate, basisFlatMax)))
        val basisPrelim = round2(totalCashIncome - basisFlat - wareneinsatzTotal - additionalDeductions)
        val mBasis = buildMethod(
            "basis_pauschal_15",
            "Basispauschalierung ${if (year >= 2026) "15 %" else "13,5 %"} + Wareneinsatz",
            "Basispauschale ${if (year >= 2026) "15 %" else "13,5 %"}",
            basisEligible,
            basisFlat,
            if (year >= 2026) 15.0 else 13.5,
            wareneinsatzTotal,
            0.0,
            basisPrelim
        )

        val earPrelim = round2(
            totalCashIncome - wareneinsatzTotal - runningOtherTotal - gwgTotal - afaTotal - additionalDeductions
        )
        val mEar = buildMethod(
            "ear_echt",
            "Echte Einnahmen-Ausgaben-Rechnung (Einzelbelege + GWG + AfA)",
            "Echte E/A-Rechnung",
            true,
            0.0,
            null,
            round2(wareneinsatzTotal + runningOtherTotal),
            round2(gwgTotal + afaTotal),
            earPrelim
        )

        val allMethods = listOf(mKu45, mKu20, mBasis, mEar)
        val eligibleMethods = allMethods.filter { it.optBoolean("eligible", false) }
        val bestMethod = eligibleMethods.minByOrNull { it.optDouble("taxableProfit", Double.MAX_VALUE) } ?: mEar
        val bestMethodKey = bestMethod.optString("key", "ku_pauschal_45")

        val prefKey = taxSettings.optString("preferred_method", "auto_best")
        val byKey = allMethods.associateBy { it.optString("key") }
        val activeMethod = if (prefKey != "auto_best" && byKey[prefKey]?.optBoolean("eligible", false) == true) {
            byKey[prefKey]!!
        } else {
            bestMethod
        }
        val activeMethodKey = activeMethod.optString("key", bestMethodKey)

        val methodsObj = JSONObject()
            .put("ku_pauschal_45", mKu45)
            .put("ku_pauschal_20", mKu20)
            .put("basis_pauschal_15", mBasis)
            .put("ear_echt", mEar)

        return JSONObject()
            .put("year", year)
            .put("invoicedIncomeInYear", invoicedIncomeInYear)
            .put("paidInvoiceIncomeInYear", paidInvoiceIncomeInYear)
            .put("manualExtraIncome", manualExtraIncome)
            .put("totalCashIncome", totalCashIncome)
            .put("openReceivablesTotal", openReceivablesTotal)
            .put("kuLimitUsedPercent", kuLimitUsedPercent)
            .put("kuStatus", kuStatus)
            .put("wareneinsatzTotal", wareneinsatzTotal)
            .put("runningOtherTotal", runningOtherTotal)
            .put("gwgTotal", gwgTotal)
            .put("afaTotal", afaTotal)
            .put("totalActualExpensesAndAfa", totalActualExpensesAndAfa)
            .put("methods", methodsObj)
            .put("bestMethodKey", bestMethodKey)
            .put("activeMethodKey", activeMethodKey)
            .put("activeResult", activeMethod)
            .put(
                "savingsVsActualTaxable",
                round2(mEar.optDouble("taxableProfit", 0.0) - bestMethod.optDouble("taxableProfit", 0.0))
            )
    }

    private fun estimateAustrianIncomeTax2026(taxableIncome: Double): Double {
        if (taxableIncome <= 13539.0) return 0.0
        val brackets = listOf(
            Triple(13539.0, 21992.0, 0.20),
            Triple(21992.0, 36458.0, 0.30),
            Triple(36458.0, 70365.0, 0.40),
            Triple(70365.0, 104859.0, 0.48),
            Triple(104859.0, 1000000.0, 0.50),
            Triple(1000000.0, Double.MAX_VALUE, 0.55)
        )
        var tax = 0.0
        for ((from, to, rate) in brackets) {
            if (taxableIncome > from) {
                val slice = min(taxableIncome, to) - from
                tax += slice * rate
            }
        }
        return round2(tax)
    }

    private fun buildToolsList(): JSONArray {
        val tools = JSONArray()

        tools.put(
            JSONObject()
                .put("name", "infinity_status")
                .put(
                    "description",
                    "Liefert den eindeutigen Status der Infinity-App auf dem Google Pixel 10 Pro (App-Name, Paketkennung at.hafner.gruenraum, Version, Datenbestandskennung datasetId, Revision, Schreibfreigabe und Datensatzzähler)."
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
                                .put("category", JSONObject().put("type", "string"))
                                .put("item_type", JSONObject().put("type", "string"))
                                .put("parent_equipment_id", JSONObject().put("type", "string"))
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
                    "Geprüfte Abrechnungs-Logik auf dem Pixel 10 Pro (erfordert aktive Schreibfreigabe am Gerät): Erstellt Rechnungen (Format RE-75/2026, §6 Abs. 1 Z 27 UStG Kleinunternehmerregelung, Sperre abgerechneter Arbeiten über settlement_id), verbucht Zahlungen oder erstellt Stornobelege (RE-S01/2026)."
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
                                .put("payment_terms_text", JSONObject().put("type", "string"))
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

    private fun getWorkAccountingAmount(w: JSONObject): Double {
        if (w.has("accounting_amount") && !w.isNull("accounting_amount")) {
            return w.optDouble("accounting_amount", 0.0)
        }
        if (w.has("total_amount") && !w.isNull("total_amount")) {
            return w.optDouble("total_amount", 0.0)
        }
        return 0.0
    }

    private fun sumInvoicePayments(inv: JSONObject): Double {
        val pays = inv.optJSONArray("payments")
        if (pays == null || pays.length() == 0) {
            return inv.optDouble("paid_amount", 0.0)
        }
        var sum = 0.0
        for (i in 0 until pays.length()) {
            val p = pays.optJSONObject(i) ?: continue
            sum += p.optDouble("amount", 0.0)
        }
        return round2(sum)
    }

    private fun getEffectiveBillingCustomerId(rec: JSONObject, customersArr: JSONArray): String {
        val custId = rec.optString("customer_id", "")
        val workCust = findById(customersArr, custId)
        if (workCust != null && workCust.optString("billing_mode") == "divergent_recipient") {
            val defId = optNullableString(workCust, "default_billing_customer_id")
            if (defId != null && defId != custId && findById(customersArr, defId) != null) {
                return defId
            }
        }
        val billingCustId = optNullableString(rec, "billing_customer_id")
        if (billingCustId != null && findById(customersArr, billingCustId) != null) {
            return billingCustId
        }
        return custId
    }

    private fun resolveCustomerNumber(customerId: String, customersArr: JSONArray): String {
        for (i in 0 until customersArr.length()) {
            val c = customersArr.optJSONObject(i) ?: continue
            if (c.optString("id") == customerId) {
                return (1001 + i).toString()
            }
        }
        val digits = customerId.replace(Regex("\\D"), "")
        val tail = digits.takeLast(3).toIntOrNull()
        return if (tail != null) (1000 + (tail % 900)).toString() else "1001"
    }

    private fun computeNextInvoiceNumber(invoicesArr: JSONArray, issueDate: String): String {
        val year = issueDate.take(4).ifEmpty { "2026" }
        var maxSeq = 74
        val regex = Regex("^RE-(\\d+)/(\\d{4})$", RegexOption.IGNORE_CASE)
        for (i in 0 until invoicesArr.length()) {
            val inv = invoicesArr.optJSONObject(i) ?: continue
            if (inv.optBoolean("is_storno", false)) continue
            val m = regex.matchEntire(inv.optString("invoice_number", "").trim()) ?: continue
            if (m.groupValues[2] == year) {
                val seq = m.groupValues[1].toIntOrNull() ?: 0
                if (seq > maxSeq) maxSeq = seq
            }
        }
        return "RE-${maxSeq + 1}/$year"
    }

    private fun computeNextStornoNumber(invoicesArr: JSONArray, issueDate: String): String {
        val year = issueDate.take(4).ifEmpty { "2026" }
        var maxSeq = 0
        val regex = Regex("S(\\d+)")
        for (i in 0 until invoicesArr.length()) {
            val inv = invoicesArr.optJSONObject(i) ?: continue
            if (!inv.optBoolean("is_storno", false)) continue
            val m = regex.find(inv.optString("invoice_number", "")) ?: continue
            val seq = m.groupValues[1].toIntOrNull() ?: 0
            if (seq > maxSeq) maxSeq = seq
        }
        return "RE-S%02d/%s".format(maxSeq + 1, year)
    }

    private fun computeServicePeriod(sortedRecords: List<JSONObject>, fallbackIsoDate: String): String {
        val dates = sortedRecords
            .map { firstNonBlank(it.optString("work_date", ""), it.optString("date", "")) }
            .filter { it.isNotEmpty() }
            .sorted()
        if (dates.isEmpty()) return formatDeDate(fallbackIsoDate)
        val first = dates.first()
        val last = dates.last()
        return if (first == last) formatDeDate(first) else "${formatDeDate(first)} - ${formatDeDate(last)}"
    }

    private fun buildPaymentTermsClause(dueDays: Int, isPaidInCash: Boolean): String {
        if (isPaidInCash) {
            return "Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten."
        }
        if (dueDays <= 0) {
            return "Zahlungsbedingungen: Sofort nach Rechnungseingang ohne Abzüge fällig."
        }
        return "Zahlungsbedingungen: Zahlung innerhalb von $dueDays Tagen ab Rechnungseingang ohne Abzüge."
    }

    private fun generateRecordId(collection: String): String {
        val prefix = when (collection) {
            "customers" -> "c"
            "properties" -> "p"
            "appointments" -> "app"
            "workRecords" -> "w"
            "invoices" -> "inv"
            "inquiries" -> "inq"
            "offers" -> "off"
            "orders" -> "ord"
            "equipments" -> "eq"
            "materials" -> "mat"
            "expenses" -> "exp"
            else -> "rec"
        }
        val suffix = UUID.randomUUID().toString().replace("-", "").take(4)
        return "$prefix-${System.currentTimeMillis()}-$suffix"
    }

    private fun addTombstone(state: JSONObject, collection: String, id: String, iso: String) {
        val deletedIds = state.optJSONObject("deletedIds")
            ?: JSONObject().also { state.put("deletedIds", it) }
        deletedIds.put("$collection:$id", iso)
    }

    private fun findById(arr: JSONArray, id: String): JSONObject? {
        for (i in 0 until arr.length()) {
            val item = arr.optJSONObject(i) ?: continue
            if (item.optString("id") == id) return item
        }
        return null
    }

    private fun prependToArray(arr: JSONArray, item: JSONObject) {
        val prevItems = mutableListOf<Any>()
        for (i in 0 until arr.length()) {
            prevItems.add(arr.get(i))
        }
        while (arr.length() > 0) {
            arr.remove(arr.length() - 1)
        }
        arr.put(item)
        for (old in prevItems) {
            arr.put(old)
        }
    }

    private fun copyAllFields(src: JSONObject, dst: JSONObject) {
        val it = src.keys()
        while (it.hasNext()) {
            val k = it.next()
            dst.put(k, src.get(k))
        }
    }

    private fun jsonArrayToStringSet(arr: JSONArray?): Set<String> {
        if (arr == null) return emptySet()
        val set = mutableSetOf<String>()
        for (i in 0 until arr.length()) {
            val v = arr.optString(i, "").trim()
            if (v.isNotEmpty()) set.add(v)
        }
        return set
    }

    private fun optNullableString(obj: JSONObject, key: String): String? {
        if (!obj.has(key) || obj.isNull(key)) return null
        val v = obj.optString(key, "").trim()
        return if (v.isEmpty() || v == "null") null else v
    }

    private fun firstNonBlank(vararg values: String): String {
        for (v in values) {
            val t = v.trim()
            if (t.isNotEmpty() && t != "null") return t
        }
        return ""
    }

    private fun assertIsoDate(raw: String, fieldName: String): String {
        val trimmed = raw.trim()
        if (!trimmed.matches(Regex("^\\d{4}-\\d{2}-\\d{2}$"))) {
            throw IllegalArgumentException("Ungültiges Datumsformat für '$fieldName': Erwartet YYYY-MM-DD.")
        }
        return trimmed
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
