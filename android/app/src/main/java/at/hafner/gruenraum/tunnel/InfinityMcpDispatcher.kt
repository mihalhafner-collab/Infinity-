package at.hafner.gruenraum.tunnel

import android.content.Context
import at.hafner.gruenraum.BuildConfig
import at.hafner.gruenraum.MainActivity
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
                                .put("tools", JSONObject().put("listChanged", true))
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
                            "Direkter privater OpenAI-Pixel-Tunnel auf dem Google Pixel 10 Pro (App: Infinity · Hafner Michael – Grünraum Handwerk, Paket: at.hafner.gruenraum). Nutze infinity_status für Status/Revisionsprüfung, pixel_abfrage für Lesezugriffe (Übersicht, Kundensuche, Einzeldatensätze, GuV, unbilled_only liefert ausschließlich abrechenbare Nicht-L.C.R.-Arbeiten, Original-Rechnungs-PDF via include_pdf=true, Versand-/Zustellbestätigung via include_delivery_status=true), pixel_aktion für Schreibvorgänge (Anlegen, Ändern, Löschen, L.C.R., Wartung, Steuereinstellungen, Arbeitsaufzeichnungen versenden via op='send_work_record') und pixel_abrechnung bzw. admin_send_invoice / admin_send_work_record / admin_get_invoice_pdf / admin_get_delivery_status für Rechnungen (RE-75/2026), Original-PDF-Abruf, Versand von Rechnungen & Arbeitsaufzeichnungen sowie Versand-/Zustellbestätigungen."
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

            "admin_get_invoice_pdf" -> getInvoicePdfInState(storeManager.loadOrInitStateObject(), args)

            "admin_get_delivery_status" -> getDeliveryStatusInState(storeManager.loadOrInitStateObject(), args)

            "pixel_aktion",
            "admin_upsert_record",
            "admin_delete_record",
            "admin_toggle_lcr",
            "admin_record_maintenance",
            "admin_update_tax_settings",
            "admin_send_work_record",
            "admin_batch_mutate" -> {
                val normalizedArgs = normalizeLegacyActionArgs(name, args)
                val opLabel = normalizedArgs.optString("op", "upsert").trim()
                val hasBatch = (normalizedArgs.optJSONArray("operations")?.length() ?: 0) > 0
                if (!hasBatch && opLabel == "get_invoice_pdf") {
                    return getInvoicePdfInState(storeManager.loadOrInitStateObject(), normalizedArgs)
                }
                if (!hasBatch && opLabel == "delivery_status") {
                    return getDeliveryStatusInState(storeManager.loadOrInitStateObject(), normalizedArgs)
                }
                assertWritePermitted()
                val effectiveReqId = normalizedArgs.optString("request_id", "").trim()
                    .ifEmpty { tunnelRequestId }
                val effectiveFp =
                    "$name\n${PixelTunnelWire.canonical(normalizedArgsWithoutRequestId(normalizedArgs))}"
                val expectedRev = if (normalizedArgs.has("expected_revision") && !normalizedArgs.isNull("expected_revision")) {
                    normalizedArgs.optInt("expected_revision", -1).takeIf { it >= 0 }
                } else null
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
            "admin_send_invoice",
            "admin_pay_invoice",
            "admin_storno_invoice" -> {
                val normalizedArgs = normalizeLegacyBillingArgs(name, args)
                val actLabel = normalizedArgs.optString("action", "create_invoice").trim()
                if (actLabel == "get_invoice_pdf") {
                    return getInvoicePdfInState(storeManager.loadOrInitStateObject(), normalizedArgs)
                }
                if (actLabel == "delivery_status") {
                    return getDeliveryStatusInState(storeManager.loadOrInitStateObject(), normalizedArgs)
                }
                assertWritePermitted()
                val effectiveReqId = normalizedArgs.optString("request_id", "").trim()
                    .ifEmpty { tunnelRequestId }
                val effectiveFp =
                    "$name\n${PixelTunnelWire.canonical(normalizedArgsWithoutRequestId(normalizedArgs))}"
                val expectedRev = if (normalizedArgs.has("expected_revision") && !normalizedArgs.isNull("expected_revision")) {
                    normalizedArgs.optInt("expected_revision", -1).takeIf { it >= 0 }
                } else null
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
            "admin_send_work_record" -> copy.put("op", "send_work_record")
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
            "admin_send_invoice" -> copy.put("action", "send_invoice")
            "admin_send_work_record" -> copy.put("action", "send_work_record")
            "admin_get_invoice_pdf" -> copy.put("action", "get_invoice_pdf")
            "admin_get_delivery_status" -> copy.put("action", "delivery_status")
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

        val explicitIncludePdf = args.optBoolean("include_pdf", false)
        val explicitIncludeDelivery = args.optBoolean("include_delivery_status", false)

        if (
            requested.isEmpty() &&
            !args.optBoolean("include_overview", false) &&
            !args.optBoolean("include_guv", false) &&
            !args.has("guv_year") &&
            !explicitIncludePdf &&
            !explicitIncludeDelivery
        ) {
            if (
                args.optBoolean("unbilled_only", false) ||
                (args.has("is_lcr") && !args.isNull("is_lcr")) ||
                (args.has("billable") && !args.isNull("billable"))
            ) {
                requested.add("workRecords")
            } else if (args.optString("customer_id", "").trim().isNotEmpty()) {
                requested.add("customers")
                requested.add("workRecords")
                requested.add("invoices")
            } else if (args.optString("search", "").trim().isNotEmpty()) {
                requested.add("customers")
            }
        }

        val includeOverview =
            args.optBoolean("include_overview", false) ||
                (requested.isEmpty() && !args.optBoolean("include_guv", false) && !args.has("guv_year") && !explicitIncludePdf && !explicitIncludeDelivery)
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

        val invTargetId = firstNonBlank(
            args.optString("invoice_id", ""),
            if (singleCol == "invoices" || requested.isEmpty()) args.optString("id", "") else ""
        )
        if (explicitIncludePdf && invTargetId.isNotEmpty()) {
            response.put(
                "invoice_pdf",
                getInvoicePdfInState(state, JSONObject().put("invoice_id", invTargetId).put("include_base64", true))
            )
        }

        val deliveryTargetInv = args.optString("invoice_id", "").trim()
        val deliveryTargetWr = args.optString("work_record_id", "").trim()
        val deliveryTargetGeneric = args.optString("id", "").trim()
        if (explicitIncludeDelivery && (deliveryTargetInv.isNotEmpty() || deliveryTargetWr.isNotEmpty() || deliveryTargetGeneric.isNotEmpty())) {
            response.put(
                "delivery_status",
                getDeliveryStatusInState(
                    state,
                    JSONObject()
                        .put("invoice_id", deliveryTargetInv)
                        .put("work_record_id", deliveryTargetWr)
                        .put("id", deliveryTargetGeneric)
                )
            )
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
        val hasBillableFilter = args.has("billable") && !args.isNull("billable")
        val billableFilter = args.optBoolean("billable", true)
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

        val searchTokens = normalizeSearchTokens(search)
        val resolvedTargetCustomerId = if (customerIdFilter.isNotEmpty()) {
            resolveCustomerByIdOrName(customersArr, customerIdFilter)?.optString("id") ?: customerIdFilter
        } else {
            ""
        }

        val matchedItems = mutableListOf<JSONObject>()
        for (i in 0 until sourceArr.length()) {
            val item = sourceArr.optJSONObject(i) ?: continue
            if (idFilter.isNotEmpty()) {
                val idMatch = item.optString("id").equals(idFilter, ignoreCase = true) ||
                    (col == "invoices" && item.optString("invoice_number").equals(idFilter, ignoreCase = true))
                if (!idMatch) continue
            }
            if (resolvedTargetCustomerId.isNotEmpty()) {
                val cMatch = if (col == "customers") {
                    item.optString("id") == resolvedTargetCustomerId ||
                        optNullableString(item, "default_billing_customer_id") == resolvedTargetCustomerId
                } else {
                    item.optString("customer_id") == resolvedTargetCustomerId ||
                        optNullableString(item, "billing_customer_id") == resolvedTargetCustomerId ||
                        optNullableString(item, "default_billing_customer_id") == resolvedTargetCustomerId ||
                        (col == "workRecords" && getEffectiveBillingCustomerId(item, customersArr) == resolvedTargetCustomerId)
                }
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
            if (hasBillableFilter && col == "workRecords" && item.optBoolean("billable", true) != billableFilter) {
                continue
            }
            if (unbilledOnly && col == "workRecords") {
                if (optNullableString(item, "settlement_id") != null) continue
                if (!hasBillableFilter && !item.optBoolean("billable", true)) continue
                if (!hasLcrFilter && item.optBoolean("is_lcr", false)) continue
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
            if (searchTokens.isNotEmpty()) {
                val searchable = normalizeSearchText(stripHeavyPhotos(item, false).toString())
                if (!searchTokens.all { token -> searchable.contains(token) }) continue
            }

            matchedItems.add(item)
        }

        if (searchTokens.isNotEmpty() && col == "customers") {
            matchedItems.sortByDescending { customerNameMatchScore(it, searchTokens) }
        }

        var workSummary: JSONObject? = null
        if (col == "workRecords") {
            var openBillableCount = 0
            var openBillableHours = 0.0
            var openBillableAmountEur = 0.0
            var lcrCount = 0
            var lcrHours = 0.0
            var lcrAmountEur = 0.0
            var billedCount = 0
            var billedHours = 0.0
            var billedAmountEur = 0.0
            var nonBillableCount = 0
            var nonBillableHours = 0.0
            for (w in matchedItems) {
                val hrs = w.optDouble("hours", 0.0)
                val amt = getWorkAccountingAmount(w)
                val sid = optNullableString(w, "settlement_id")
                if (sid != null) {
                    billedCount++
                    billedHours += hrs
                    billedAmountEur += amt
                } else if (w.optBoolean("is_lcr", false)) {
                    lcrCount++
                    lcrHours += hrs
                    lcrAmountEur += amt
                } else if (w.optBoolean("billable", true)) {
                    openBillableCount++
                    openBillableHours += hrs
                    openBillableAmountEur += amt
                } else {
                    nonBillableCount++
                    nonBillableHours += hrs
                }
            }
            workSummary = JSONObject()
                .put("openBillableCount", openBillableCount)
                .put("openBillableHours", round2(openBillableHours))
                .put("openBillableAmountEur", round2(openBillableAmountEur))
                .put("lcrCount", lcrCount)
                .put("lcrHours", round2(lcrHours))
                .put("lcrAmountEur", round2(lcrAmountEur))
                .put("billedCount", billedCount)
                .put("billedHours", round2(billedHours))
                .put("billedAmountEur", round2(billedAmountEur))
                .put("nonBillableCount", nonBillableCount)
                .put("nonBillableHours", round2(nonBillableHours))
        }

        val totalMatched = matchedItems.size
        val matched = JSONArray()
        for (item in matchedItems.take(limit)) {
            matched.put(projectItem(item, fieldsFilter, includePhotos))
        }

        val out = JSONObject()
            .put("revision", rev)
            .put("collection", col)
            .put("totalMatched", totalMatched)
            .put("returnedCount", matched.length())
        if (workSummary != null) {
            out.put("workSummary", workSummary)
        }
        if (col == "invoices" && idFilter.isNotEmpty() && matchedItems.size == 1) {
            out.put(
                "deliveryStatus",
                getDeliveryStatusInState(state, JSONObject().put("invoice_id", matchedItems[0].optString("id")))
            )
        }
        out.put("items", matched)
        return out
    }

    private fun normalizeSearchText(raw: String?): String {
        if (raw.isNullOrBlank()) return ""
        return raw.lowercase(Locale.ROOT)
            .replace(Regex("[,.;:/\\\\()\\[\\]{}\"'`]+"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    private fun normalizeSearchTokens(raw: String?): List<String> {
        val norm = normalizeSearchText(raw)
        if (norm.isEmpty()) return emptyList()
        return norm.split(" ").filter { it.isNotEmpty() }
    }

    private fun customerNameMatchScore(item: JSONObject, tokens: List<String>): Int {
        if (tokens.isEmpty()) return 0
        val combinedName = normalizeSearchText("${item.optString("name", "")} ${item.optString("company", "")}")
        val nameWords = combinedName.split(" ").filter { it.isNotEmpty() }
        if (tokens.all { nameWords.contains(it) }) return 100
        if (tokens.all { combinedName.contains(it) }) return 80
        val primary = normalizeSearchText(
            "${item.optString("id", "")} ${item.optString("name", "")} ${item.optString("company", "")} ${item.optString("email", "")}"
        )
        if (tokens.all { primary.contains(it) }) return 50
        return 10
    }

    private fun resolveCustomerByIdOrName(customers: JSONArray, rawRef: String): JSONObject? {
        val ref = rawRef.trim()
        if (ref.isEmpty()) return null
        findById(customers, ref)?.let { return it }
        for (i in 0 until customers.length()) {
            val c = customers.optJSONObject(i) ?: continue
            if (c.optString("id", "").equals(ref, ignoreCase = true)) return c
        }
        val tokens = normalizeSearchTokens(ref)
        if (tokens.isEmpty()) return null
        var best: JSONObject? = null
        var bestScore = 0
        for (i in 0 until customers.length()) {
            val c = customers.optJSONObject(i) ?: continue
            val score = customerNameMatchScore(c, tokens)
            if (score >= 80 && score > bestScore) {
                bestScore = score
                best = c
            }
        }
        return best
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
        val imagesArr = copy.optJSONArray("images")
        if (imagesArr != null) {
            copy.put("image_count", imagesArr.length())
            val strippedImages = JSONArray()
            for (i in 0 until imagesArr.length()) {
                val imgObj = imagesArr.optJSONObject(i)
                if (imgObj == null) {
                    strippedImages.put(imagesArr.opt(i))
                    continue
                }
                val imgCopy = JSONObject(imgObj.toString())
                val url = imgCopy.optString("url", "")
                if (url.startsWith("data:")) {
                    imgCopy.remove("url")
                    imgCopy.put("has_data_url", true)
                }
                strippedImages.put(imgCopy)
            }
            copy.put("images", strippedImages)
        }
        val docsArr = copy.optJSONArray("documents")
        if (docsArr != null) {
            copy.put("document_count", docsArr.length())
            val strippedDocs = JSONArray()
            for (i in 0 until docsArr.length()) {
                val docObj = docsArr.optJSONObject(i)
                if (docObj == null) {
                    strippedDocs.put(docsArr.opt(i))
                    continue
                }
                val docCopy = JSONObject(docObj.toString())
                val url = docCopy.optString("url", "")
                if (url.startsWith("data:")) {
                    docCopy.remove("url")
                    docCopy.put("has_data_url", true)
                }
                strippedDocs.put(docCopy)
            }
            copy.put("documents", strippedDocs)
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

    private fun buildNormalizedUpsertPayload(args: JSONObject, collection: String): JSONObject {
        val nested = args.optJSONObject("record") ?: args.optJSONObject("data")
        val envelopeKeys = setOf(
            "op", "collection", "collections", "operations", "record", "data",
            "request_id", "expected_revision", "tax_settings"
        )
        val merged = JSONObject()
        val topKeys = args.keys()
        while (topKeys.hasNext()) {
            val k = topKeys.next()
            if (!envelopeKeys.contains(k) && !args.isNull(k)) {
                merged.put(k, args.get(k))
            }
        }
        if (nested != null) {
            copyAllFields(nested, merged)
        }
        val explicitId = firstNonBlank(
            nested?.optString("id", "").orEmpty(),
            if (collection == "equipments") nested?.optString("equipment_id", "").orEmpty() else "",
            nested?.optString("record_id", "").orEmpty(),
            args.optString("id", ""),
            if (collection == "equipments") args.optString("equipment_id", "") else "",
            args.optString("record_id", "")
        )
        if (explicitId.isNotEmpty()) {
            merged.put("id", explicitId)
        }
        if (args.optString("op", "").trim().equals("update", ignoreCase = true)) {
            merged.put("__force_update", true)
        }
        return merged
    }

    private fun applySingleActionMutation(state: JSONObject, args: JSONObject): JSONObject {
        return when (val op = args.optString("op", "upsert").trim()) {
            "upsert", "update" -> {
                val col = args.optString("collection", "").trim()
                if (!NativeStoreManager.COLLECTION_KEYS.contains(col)) {
                    throw IllegalArgumentException("Unbekannte Collection '$col'.")
                }
                val record = buildNormalizedUpsertPayload(args, col)
                if (record.length() == 0) {
                    throw IllegalArgumentException("Parameter 'record' fehlt für op='$op'.")
                }
                upsertRecordInState(state, col, record)
            }

            "delete" -> {
                val col = args.optString("collection", "").trim()
                if (!NativeStoreManager.COLLECTION_KEYS.contains(col)) {
                    throw IllegalArgumentException("Unbekannte Collection '$col'.")
                }
                val id = firstNonBlank(
                    args.optString("id", ""),
                    args.optString("equipment_id", ""),
                    args.optJSONObject("record")?.optString("id", "").orEmpty()
                )
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
                val eqId = firstNonBlank(
                    args.optString("equipment_id", ""),
                    args.optString("id", "")
                )
                val maintObj = args.optJSONObject("maintenance") ?: args
                recordMaintenanceInState(state, eqId, maintObj)
            }

            "equipment_media" -> {
                val eqId = firstNonBlank(
                    args.optString("equipment_id", ""),
                    args.optString("id", ""),
                    args.optJSONObject("record")?.optString("id", "").orEmpty()
                )
                if (eqId.isEmpty()) {
                    throw IllegalArgumentException("Parameter 'equipment_id' (oder 'id') ist für op='equipment_media' erforderlich.")
                }
                val mediaPayload = JSONObject()
                val nested = args.optJSONObject("record")
                if (nested != null) copyAllFields(nested, mediaPayload)
                copyAllFields(args, mediaPayload)
                mediaPayload.remove("op")
                mediaPayload.remove("collection")
                mediaPayload.remove("equipment_id")
                mediaPayload.put("id", eqId)
                mediaPayload.put("__force_update", true)
                upsertRecordInState(state, "equipments", mediaPayload)
            }

            "tax_settings" -> {
                val settingsObj = args.optJSONObject("tax_settings") ?: args
                updateTaxSettingsInState(state, settingsObj)
            }

            "send_invoice" -> sendInvoiceInState(state, args)

            "send_work_record" -> sendWorkRecordInState(state, args)

            "get_invoice_pdf" -> getInvoicePdfInState(state, args)

            "delivery_status" -> getDeliveryStatusInState(state, args)

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
        val requestedId = firstNonBlank(
            payload.optString("id", ""),
            if (collection == "equipments") payload.optString("equipment_id", "") else "",
            payload.optString("record_id", "")
        )

        var existingIdx = -1
        var prev: JSONObject? = null
        if (requestedId.isNotEmpty()) {
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val itId = item.optString("id", "").trim()
                if (itId == requestedId || itId.equals(requestedId, ignoreCase = true)) {
                    existingIdx = i
                    prev = item
                    break
                }
            }
            if (collection == "equipments" && existingIdx < 0) {
                throw IllegalArgumentException(
                    "Gerät mit der ID '$requestedId' wurde nicht gefunden. Bei übergebener ID wird ausschließlich aktualisiert (update) und niemals ein neuer Datensatz angelegt."
                )
            }
        } else if (collection == "equipments" && !payload.optBoolean("allow_duplicate", false)) {
            fun normStr(s: String): String = s.trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")
            val reqType = if (payload.optString("item_type") == "zubehoer") "zubehoer" else "geraet"
            val reqSerial = normStr(payload.optString("serial_number", ""))
            val reqManuf = normStr(payload.optString("manufacturer", ""))
            val reqModel = normStr(payload.optString("model", ""))
            val reqName = normStr(payload.optString("name", ""))
            val reqCombined = listOf(reqManuf, reqModel).filter { it.isNotEmpty() }.joinToString(" ")
            val reqParent = payload.optString("parent_equipment_id", "").trim()

            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                val itType = if (item.optString("item_type") == "zubehoer") "zubehoer" else "geraet"
                if (itType != reqType) continue
                if (reqType == "zubehoer" && reqParent.isNotEmpty() && item.optString("parent_equipment_id", "").trim() != reqParent) {
                    continue
                }
                val itSerial = normStr(item.optString("serial_number", ""))
                if (reqSerial.isNotEmpty() && itSerial.isNotEmpty() && reqSerial == itSerial) {
                    existingIdx = i
                    prev = item
                    break
                }
                val itManuf = normStr(item.optString("manufacturer", ""))
                val itModel = normStr(item.optString("model", ""))
                val itName = normStr(item.optString("name", ""))
                val itCombined = listOf(itManuf, itModel).filter { it.isNotEmpty() }.joinToString(" ")

                if (reqManuf.isNotEmpty() && reqModel.isNotEmpty() && itManuf == reqManuf && itModel == reqModel) {
                    existingIdx = i
                    prev = item
                    break
                }
                if (reqCombined.isNotEmpty() && (itName == reqCombined || itCombined == reqCombined)) {
                    existingIdx = i
                    prev = item
                    break
                }
                if (reqName.isNotEmpty() && (itName == reqName || itCombined == reqName)) {
                    existingIdx = i
                    prev = item
                    break
                }
            }
        }

        if (collection == "equipments" && payload.optBoolean("__force_update", false) && existingIdx < 0) {
            throw IllegalArgumentException(
                "Kein passendes bestehendes Gerät zum Aktualisieren (update) gefunden. Bitte gültige Geräte-ID ('id') übergeben."
            )
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
                val itemType = when {
                    payload.has("item_type") -> if (payload.optString("item_type") == "zubehoer") "zubehoer" else "geraet"
                    prev != null -> if (prev.optString("item_type") == "zubehoer") "zubehoer" else "geraet"
                    else -> "geraet"
                }
                val rawStatus = when {
                    payload.has("status") && payload.optString("status", "").trim().isNotEmpty() ->
                        payload.optString("status", "").lowercase(Locale.ROOT).trim()
                    prev != null && prev.optString("status", "").trim().isNotEmpty() ->
                        prev.optString("status", "").lowercase(Locale.ROOT).trim()
                    else -> "einsatzbereit"
                }
                val statusVal = when (rawStatus) {
                    "fällig", "faellig", "due" -> "faellig"
                    "wartung", "in_wartung", "werkstatt" -> "wartung"
                    else -> "einsatzbereit"
                }

                val manufacturerVal = if (payload.has("manufacturer") && !payload.isNull("manufacturer")) {
                    payload.optString("manufacturer", "").trim()
                } else {
                    prev?.optString("manufacturer", "")?.trim().orEmpty()
                }
                val modelVal = if (payload.has("model") && !payload.isNull("model")) {
                    payload.optString("model", "").trim()
                } else {
                    prev?.optString("model", "")?.trim().orEmpty()
                }
                val categoryVal = firstNonBlank(
                    if (payload.has("category") && !payload.isNull("category")) payload.optString("category", "") else "",
                    prev?.optString("category", "").orEmpty(),
                    if (itemType == "zubehoer") "Zubehör" else "Allgemein"
                )
                val autoTitle = listOf(manufacturerVal, modelVal).filter { it.isNotEmpty() }.joinToString(" ")
                val nameVal = firstNonBlank(
                    if (payload.has("name") && !payload.isNull("name")) payload.optString("name", "") else "",
                    prev?.optString("name", "").orEmpty(),
                    autoTitle,
                    categoryVal,
                    if (itemType == "zubehoer") "Zubehör" else "Gerät"
                )

                val serialNumberVal = if (payload.has("serial_number") && !payload.isNull("serial_number")) {
                    payload.optString("serial_number", "").trim()
                } else {
                    prev?.optString("serial_number", "")?.trim().orEmpty()
                }
                val purchaseDateVal = if (payload.has("purchase_date") && !payload.isNull("purchase_date")) {
                    payload.optString("purchase_date", "").trim()
                } else {
                    prev?.optString("purchase_date", "")?.trim().orEmpty()
                }
                val dealerVal = if (payload.has("dealer") && !payload.isNull("dealer")) {
                    payload.optString("dealer", "").trim()
                } else {
                    prev?.optString("dealer", "")?.trim().orEmpty()
                }
                val purchasePriceVal: Double? = if (payload.has("purchase_price")) {
                    if (payload.isNull("purchase_price") || payload.optString("purchase_price", "").trim().isEmpty()) {
                        null
                    } else {
                        val v = payload.optDouble("purchase_price", Double.NaN)
                        if (!v.isNaN()) round2(v) else null
                    }
                } else if (prev != null && prev.has("purchase_price") && !prev.isNull("purchase_price") && prev.optString("purchase_price", "").trim().isNotEmpty()) {
                    val v = prev.optDouble("purchase_price", Double.NaN)
                    if (!v.isNaN()) round2(v) else null
                } else {
                    null
                }

                val defaultFieldSource = if (
                    payload.optString("data_source") == "manufacturer" ||
                    payload.optString("source") == "manufacturer"
                ) "manufacturer" else "individual"

                val fieldList = mutableListOf<JSONObject>()
                val prevCustomFields = prev?.optJSONArray("custom_fields")
                if (prevCustomFields != null && prevCustomFields.length() > 0) {
                    for (i in 0 until prevCustomFields.length()) {
                        val cf = prevCustomFields.optJSONObject(i) ?: continue
                        if (cf.optString("label", "").trim().isNotEmpty()) {
                            fieldList.add(JSONObject(cf.toString()))
                        }
                    }
                } else {
                    val prevSpecs = prev?.optJSONObject("specs")
                    if (prevSpecs != null) {
                        val pk = prevSpecs.keys()
                        while (pk.hasNext()) {
                            val k = pk.next()
                            if (k == "created_at" || k == "updated_at" || k == "has_photo" || k == "photo_count") continue
                            val v = prevSpecs.optString(k, "").trim()
                            if (v.isNotEmpty() && !prevSpecs.isNull(k)) {
                                fieldList.add(
                                    JSONObject()
                                        .put("id", "cf-${k.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9äöüß_-]"), "_")}")
                                        .put("label", k)
                                        .put("type", "text")
                                        .put("value", v)
                                        .put("section", "Technische Daten")
                                        .put("source", "individual")
                                )
                            }
                        }
                    }
                }

                fun upsertDynamicField(
                    fId: String?,
                    label: String,
                    typeStr: String?,
                    valueAny: Any?,
                    unitStr: String?,
                    sectionStr: String?,
                    sourceStr: String?
                ) {
                    val cleanLabel = label.trim()
                    if (cleanLabel.isEmpty()) return
                    val hasExplicitSection = !sectionStr.isNullOrBlank()
                    val cleanSection = sectionStr?.trim()?.ifEmpty { "Technische Daten" } ?: "Technische Daten"
                    val idx = fieldList.indexOfFirst { f ->
                        (!fId.isNullOrEmpty() && f.optString("id") == fId) ||
                            (f.optString("label").equals(cleanLabel, ignoreCase = true) &&
                                (f.optString("section", "Technische Daten").equals(cleanSection, ignoreCase = true) ||
                                    !hasExplicitSection))
                    }
                    if (valueAny == null || valueAny == JSONObject.NULL || valueAny.toString().trim().isEmpty()) {
                        if (idx >= 0) fieldList.removeAt(idx)
                        return
                    }
                    val effectiveSection = if (idx >= 0 && !hasExplicitSection) {
                        fieldList[idx].optString("section", cleanSection).ifEmpty { cleanSection }
                    } else {
                        cleanSection
                    }
                    val chosenType = when (typeStr?.lowercase(Locale.ROOT)?.trim()) {
                        "number", "unit", "date", "boolean", "text" -> typeStr.lowercase(Locale.ROOT).trim()
                        else -> if (!unitStr.isNullOrBlank()) "unit" else if (idx >= 0) fieldList[idx].optString("type", "text") else "text"
                    }
                    val chosenSource = when (sourceStr?.lowercase(Locale.ROOT)?.trim()) {
                        "manufacturer" -> "manufacturer"
                        "individual" -> "individual"
                        else -> if (idx >= 0) fieldList[idx].optString("source", defaultFieldSource) else defaultFieldSource
                    }
                    val resolvedId = (if (idx >= 0) fieldList[idx].optString("id") else "")
                        .ifEmpty { fId ?: "cf-${cleanLabel.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9äöüß_-]"), "_")}" }
                    val resolvedUnit = unitStr?.trim()?.ifEmpty { null }
                        ?: (if (idx >= 0) optNullableString(fieldList[idx], "unit") else null)

                    val obj = JSONObject()
                        .put("id", resolvedId)
                        .put("label", cleanLabel)
                        .put("type", chosenType)
                        .put("value", valueAny)
                        .put("section", effectiveSection)
                        .put("source", chosenSource)
                    if (!resolvedUnit.isNullOrBlank()) {
                        obj.put("unit", resolvedUnit)
                    }
                    if (idx >= 0) fieldList[idx] = obj else fieldList.add(obj)
                }

                val sectionNamesSet = linkedSetOf<String>()
                val prevSecs = prev?.optJSONArray("custom_sections")
                if (prevSecs != null) {
                    for (i in 0 until prevSecs.length()) {
                        val s = prevSecs.optString(i, "").trim()
                        if (s.isNotEmpty()) sectionNamesSet.add(s)
                    }
                }
                val paySecs = payload.optJSONArray("custom_sections")
                if (paySecs != null) {
                    for (i in 0 until paySecs.length()) {
                        val s = paySecs.optString(i, "").trim()
                        if (s.isNotEmpty()) sectionNamesSet.add(s)
                    }
                }

                val sectionsArr = payload.optJSONArray("sections")
                if (sectionsArr != null) {
                    for (i in 0 until sectionsArr.length()) {
                        val secObj = sectionsArr.optJSONObject(i) ?: continue
                        val secTitle = firstNonBlank(
                            secObj.optString("name", ""),
                            secObj.optString("title", ""),
                            secObj.optString("section", ""),
                            "Technische Daten"
                        )
                        sectionNamesSet.add(secTitle)
                        val secSource = secObj.optString("source", defaultFieldSource)
                        val fArr = secObj.optJSONArray("fields")
                        if (fArr != null) {
                            for (j in 0 until fArr.length()) {
                                val fItem = fArr.optJSONObject(j) ?: continue
                                upsertDynamicField(
                                    fId = optNullableString(fItem, "id"),
                                    label = firstNonBlank(fItem.optString("label", ""), fItem.optString("name", ""), fItem.optString("key", "")),
                                    typeStr = optNullableString(fItem, "type"),
                                    valueAny = fItem.opt("value"),
                                    unitStr = optNullableString(fItem, "unit"),
                                    sectionStr = secTitle,
                                    sourceStr = optNullableString(fItem, "source") ?: secSource
                                )
                            }
                        } else {
                            val fMap = secObj.optJSONObject("fields")
                            if (fMap != null) {
                                val fk = fMap.keys()
                                while (fk.hasNext()) {
                                    val k = fk.next()
                                    upsertDynamicField(null, k, null, fMap.opt(k), null, secTitle, secSource)
                                }
                            }
                        }
                    }
                }

                val incomingCustomFields = payload.optJSONArray("custom_fields")
                if (incomingCustomFields != null) {
                    for (i in 0 until incomingCustomFields.length()) {
                        val cf = incomingCustomFields.optJSONObject(i) ?: continue
                        val explicitSec = optNullableString(cf, "section")
                        if (explicitSec != null) sectionNamesSet.add(explicitSec)
                        upsertDynamicField(
                            fId = optNullableString(cf, "id"),
                            label = firstNonBlank(cf.optString("label", ""), cf.optString("name", ""), cf.optString("key", "")),
                            typeStr = optNullableString(cf, "type"),
                            valueAny = cf.opt("value"),
                            unitStr = optNullableString(cf, "unit"),
                            sectionStr = explicitSec,
                            sourceStr = optNullableString(cf, "source") ?: defaultFieldSource
                        )
                    }
                }

                val reservedKeys = setOf(
                    "id", "equipment_id", "record_id", "__force_update",
                    "item_type", "category", "parent_equipment_id", "manufacturer", "model", "name",
                    "serial_number", "purchase_date", "purchase_price", "dealer",
                    "photo", "images", "add_images", "replace_images", "remove_image_ids", "set_primary_image_id",
                    "documents", "add_documents", "remove_document_ids",
                    "has_photo", "photo_count", "image_count", "document_count", "remove_photo",
                    "specs", "custom_fields", "custom_sections", "sections", "remove_fields",
                    "data_source", "source", "allow_duplicate", "accessories",
                    "quantity", "notes", "status", "last_maintenance", "next_maintenance", "maintenance_plan",
                    "interval_months", "history", "created_at", "updated_at"
                )

                val payloadSpecs = payload.optJSONObject("specs")
                if (payloadSpecs != null) {
                    val nk = payloadSpecs.keys()
                    while (nk.hasNext()) {
                        val k = nk.next()
                        if (k == "created_at" || k == "updated_at" || k == "has_photo" || k == "photo_count") continue
                        upsertDynamicField(null, k, null, payloadSpecs.opt(k), null, null, defaultFieldSource)
                    }
                }

                val payloadKeys = payload.keys()
                while (payloadKeys.hasNext()) {
                    val k = payloadKeys.next()
                    if (!reservedKeys.contains(k)) {
                        if (payload.optJSONObject(k) == null && payload.optJSONArray(k) == null) {
                            upsertDynamicField(null, k, null, payload.opt(k), null, null, defaultFieldSource)
                        }
                        record.remove(k)
                    }
                }

                val remFieldsArr = payload.optJSONArray("remove_fields")
                if (remFieldsArr != null) {
                    val toRem = jsonArrayToStringSet(remFieldsArr).map { it.lowercase(Locale.ROOT) }.toSet()
                    fieldList.removeAll { f ->
                        toRem.contains(f.optString("id", "").lowercase(Locale.ROOT)) ||
                            toRem.contains(f.optString("label", "").lowercase(Locale.ROOT))
                    }
                }

                val mergedSpecs = JSONObject()
                val customFieldsJson = JSONArray()
                for (f in fieldList) {
                    customFieldsJson.put(f)
                    val lbl = f.optString("label", "").trim()
                    val vStr = f.optString("value", "").trim()
                    val uStr = f.optString("unit", "").trim()
                    if (lbl.isNotEmpty() && vStr.isNotEmpty()) {
                        mergedSpecs.put(lbl, if (uStr.isNotEmpty()) "$vStr $uStr" else vStr)
                    }
                }

                // Bilder & Galerie verwalten
                val imageList = mutableListOf<JSONObject>()
                if (!payload.optBoolean("replace_images", false) && !payload.optBoolean("remove_photo", false)) {
                    val prevImages = prev?.optJSONArray("images")
                    if (prevImages != null && prevImages.length() > 0) {
                        for (i in 0 until prevImages.length()) {
                            val img = prevImages.optJSONObject(i) ?: continue
                            if (img.optString("url", "").trim().isNotEmpty()) {
                                imageList.add(JSONObject(img.toString()))
                            }
                        }
                    } else {
                        val prevSingle = prev?.optString("photo", "")?.trim().orEmpty()
                        if (prevSingle.isNotEmpty() && prevSingle != "null") {
                            imageList.add(
                                JSONObject()
                                    .put("id", "img-primary")
                                    .put("url", prevSingle)
                                    .put("caption", "Hauptbild")
                                    .put("source", "own")
                                    .put("is_primary", true)
                                    .put("added_at", prev?.optString("updated_at") ?: nowIso)
                            )
                        }
                    }
                }

                fun appendImageAny(rawImg: Any?, forcePrimary: Boolean) {
                    if (rawImg == null || rawImg == JSONObject.NULL) return
                    if (rawImg is String) {
                        val url = rawImg.trim()
                        if (url.isEmpty()) return
                        val existIdx = imageList.indexOfFirst { it.optString("url") == url }
                        if (existIdx >= 0) {
                            if (forcePrimary) {
                                for (k in imageList.indices) imageList[k].put("is_primary", k == existIdx)
                            }
                            return
                        }
                        if (forcePrimary) {
                            for (img in imageList) img.put("is_primary", false)
                        }
                        imageList.add(
                            JSONObject()
                                .put("id", "img-${System.currentTimeMillis()}-${imageList.size}")
                                .put("url", url)
                                .put("caption", if (defaultFieldSource == "manufacturer") "Herstellerbild" else "Gerätebild")
                                .put("source", if (defaultFieldSource == "manufacturer") "manufacturer" else "own")
                                .put("is_primary", forcePrimary || imageList.isEmpty())
                                .put("added_at", nowIso)
                        )
                    } else if (rawImg is JSONObject) {
                        val url = firstNonBlank(rawImg.optString("url", ""), rawImg.optString("src", ""), rawImg.optString("data", ""))
                        if (url.isEmpty()) return
                        val explicitImgId = optNullableString(rawImg, "id")
                        val imgId = explicitImgId ?: "img-${System.currentTimeMillis()}-${imageList.size}"
                        val isPrim = rawImg.optBoolean("is_primary", false) || forcePrimary
                        val imgSrc = if (rawImg.optString("source") == "manufacturer" || defaultFieldSource == "manufacturer") "manufacturer" else "own"
                        val existIdx = imageList.indexOfFirst {
                            (explicitImgId != null && it.optString("id") == explicitImgId) || it.optString("url") == url
                        }
                        if (isPrim) {
                            for (img in imageList) img.put("is_primary", false)
                        }
                        val prevImg = if (existIdx >= 0) imageList[existIdx] else null
                        val obj = JSONObject()
                            .put("id", prevImg?.optString("id")?.ifEmpty { imgId } ?: imgId)
                            .put("url", url)
                            .put(
                                "caption",
                                firstNonBlank(
                                    rawImg.optString("caption", ""),
                                    rawImg.optString("title", ""),
                                    prevImg?.optString("caption", "").orEmpty()
                                )
                            )
                            .put("source", imgSrc)
                            .put("is_primary", isPrim || (prevImg?.optBoolean("is_primary", false) ?: imageList.isEmpty()))
                            .put("added_at", rawImg.optString("added_at", prevImg?.optString("added_at", nowIso) ?: nowIso))
                        if (existIdx >= 0) imageList[existIdx] = obj else imageList.add(obj)
                    }
                }

                if (payload.has("photo") && !payload.isNull("photo")) {
                    val pStr = payload.optString("photo", "").trim()
                    if (pStr.isNotEmpty() && pStr != "null") appendImageAny(pStr, true)
                }
                val payImgs = payload.optJSONArray("images")
                if (payImgs != null) {
                    for (i in 0 until payImgs.length()) appendImageAny(payImgs.opt(i), false)
                }
                val addImgs = payload.optJSONArray("add_images")
                if (addImgs != null) {
                    for (i in 0 until addImgs.length()) appendImageAny(addImgs.opt(i), false)
                }
                val remImgIds = jsonArrayToStringSet(payload.optJSONArray("remove_image_ids"))
                if (remImgIds.isNotEmpty()) {
                    imageList.removeAll { remImgIds.contains(it.optString("id")) }
                }
                val setPrimId = payload.optString("set_primary_image_id", "").trim()
                if (setPrimId.isNotEmpty() && imageList.any { it.optString("id") == setPrimId }) {
                    for (img in imageList) img.put("is_primary", img.optString("id") == setPrimId)
                }
                if (imageList.isNotEmpty() && imageList.none { it.optBoolean("is_primary", false) }) {
                    imageList[0].put("is_primary", true)
                }
                val primaryImgObj = imageList.firstOrNull { it.optBoolean("is_primary", false) } ?: imageList.firstOrNull()
                val resolvedPhoto = primaryImgObj?.optString("url", "")?.takeIf { it.isNotEmpty() }
                val imagesJson = JSONArray()
                for (img in imageList) imagesJson.put(img)

                // Dokumente (Rechnungen & Anleitungen) verwalten
                val docList = mutableListOf<JSONObject>()
                val prevDocs = prev?.optJSONArray("documents")
                if (prevDocs != null) {
                    for (i in 0 until prevDocs.length()) {
                        val d = prevDocs.optJSONObject(i) ?: continue
                        if (d.optString("url", "").trim().isNotEmpty()) docList.add(JSONObject(d.toString()))
                    }
                }
                fun appendDocAny(rawDoc: JSONObject?) {
                    if (rawDoc == null) return
                    val url = firstNonBlank(rawDoc.optString("url", ""), rawDoc.optString("data", ""))
                    if (url.isEmpty()) return
                    val explicitDocId = optNullableString(rawDoc, "id")
                    val docId = explicitDocId ?: "doc-${System.currentTimeMillis()}-${docList.size}"
                    val dType = when (rawDoc.optString("type", "sonstiges")) {
                        "rechnung", "anleitung" -> rawDoc.optString("type")
                        else -> "sonstiges"
                    }
                    val title = firstNonBlank(
                        rawDoc.optString("title", ""),
                        rawDoc.optString("name", ""),
                        if (dType == "rechnung") "Rechnung" else if (dType == "anleitung") "Bedienungsanleitung" else "Dokument"
                    )
                    val existIdx = docList.indexOfFirst {
                        (explicitDocId != null && it.optString("id") == explicitDocId) || it.optString("url") == url
                    }
                    val prevDoc = if (existIdx >= 0) docList[existIdx] else null
                    val obj = JSONObject()
                        .put("id", prevDoc?.optString("id")?.ifEmpty { docId } ?: docId)
                        .put("title", title)
                        .put("type", dType)
                        .put("url", url)
                        .put("added_at", rawDoc.optString("added_at", prevDoc?.optString("added_at", nowIso) ?: nowIso))
                    val mime = optNullableString(rawDoc, "mime_type") ?: (if (prevDoc != null) optNullableString(prevDoc, "mime_type") else null)
                    if (mime != null) obj.put("mime_type", mime)
                    if (existIdx >= 0) docList[existIdx] = obj else docList.add(obj)
                }
                val payDocs = payload.optJSONArray("documents")
                if (payDocs != null) {
                    for (i in 0 until payDocs.length()) appendDocAny(payDocs.optJSONObject(i))
                }
                val addDocs = payload.optJSONArray("add_documents")
                if (addDocs != null) {
                    for (i in 0 until addDocs.length()) appendDocAny(addDocs.optJSONObject(i))
                }
                val remDocIds = jsonArrayToStringSet(payload.optJSONArray("remove_document_ids"))
                if (remDocIds.isNotEmpty()) {
                    docList.removeAll { remDocIds.contains(it.optString("id")) }
                }
                val docsJson = JSONArray()
                for (d in docList) docsJson.put(d)

                val parsedInterval = when {
                    payload.has("interval_months") && !payload.isNull("interval_months") && payload.optString("interval_months", "").trim().isNotEmpty() ->
                        payload.optInt("interval_months", 6).coerceAtLeast(1)
                    prev != null && prev.optInt("interval_months", 0) > 0 ->
                        prev.optInt("interval_months", 6).coerceAtLeast(1)
                    else -> 6
                }
                val lastMaintIso = when {
                    payload.has("last_maintenance") && payload.optString("last_maintenance", "").trim().isNotEmpty() ->
                        assertIsoDate(payload.optString("last_maintenance", ""), "last_maintenance")
                    prev != null && prev.has("last_maintenance") && !prev.isNull("last_maintenance") ->
                        prev.optString("last_maintenance", "")
                    else -> today
                }
                val nextMaintIso = when {
                    payload.has("next_maintenance") && payload.optString("next_maintenance", "").trim().isNotEmpty() ->
                        assertIsoDate(payload.optString("next_maintenance", ""), "next_maintenance")
                    (payload.has("last_maintenance") || payload.has("interval_months")) && !payload.has("next_maintenance") && lastMaintIso.isNotEmpty() ->
                        addDaysIso(lastMaintIso, parsedInterval * 30)
                    prev != null && prev.has("next_maintenance") && !prev.isNull("next_maintenance") ->
                        prev.optString("next_maintenance", "")
                    else -> addDaysIso(lastMaintIso.ifEmpty { today }, parsedInterval * 30)
                }

                val qtySourceObj = if (payload.has("quantity")) payload else prev
                if (qtySourceObj != null && qtySourceObj.has("quantity") && !qtySourceObj.isNull("quantity") && qtySourceObj.optString("quantity", "").trim().isNotEmpty()) {
                    record.put("quantity", qtySourceObj.optInt("quantity", 1).coerceAtLeast(0))
                } else if (itemType == "zubehoer") {
                    record.put("quantity", 1)
                } else {
                    record.put("quantity", JSONObject.NULL)
                }

                // Wartungshistorie verlustfrei zusammenführen
                val mergedHistory = JSONArray()
                val prevHist = prev?.optJSONArray("history")
                if (prevHist != null) {
                    for (i in 0 until prevHist.length()) {
                        val h = prevHist.optJSONObject(i) ?: continue
                        mergedHistory.put(JSONObject(h.toString()))
                    }
                }
                val payHist = payload.optJSONArray("history")
                if (payHist != null) {
                    for (i in 0 until payHist.length()) {
                        val hObj = payHist.optJSONObject(i) ?: continue
                        val hId = hObj.optString("id", "").trim()
                        val hDate = hObj.optString("date", "").trim()
                        val hNote = hObj.optString("note", "").trim()
                        var exists = false
                        for (j in 0 until mergedHistory.length()) {
                            val ex = mergedHistory.optJSONObject(j) ?: continue
                            if ((hId.isNotEmpty() && ex.optString("id", "") == hId) ||
                                (hDate.isNotEmpty() && ex.optString("date", "") == hDate && ex.optString("note", "") == hNote)
                            ) {
                                exists = true
                                break
                            }
                        }
                        if (!exists && (hDate.isNotEmpty() || hNote.isNotEmpty())) {
                            mergedHistory.put(
                                JSONObject()
                                    .put("id", hId.ifEmpty { "mh-${System.currentTimeMillis()}-${mergedHistory.length()}" })
                                    .put("date", hDate.ifEmpty { today })
                                    .put("note", hNote)
                            )
                        }
                    }
                }

                for (tmpKey in listOf(
                    "equipment_id", "record_id", "__force_update",
                    "has_photo", "photo_count", "image_count", "document_count", "remove_photo",
                    "add_images", "replace_images", "remove_image_ids", "set_primary_image_id",
                    "add_documents", "remove_document_ids", "sections", "remove_fields",
                    "data_source", "source", "allow_duplicate", "accessories"
                )) {
                    record.remove(tmpKey)
                }

                val customSectionsJson = JSONArray()
                for (s in sectionNamesSet) customSectionsJson.put(s)

                val parentIdVal = when {
                    payload.has("parent_equipment_id") -> optNullableString(payload, "parent_equipment_id")
                    prev != null -> optNullableString(prev, "parent_equipment_id")
                    else -> null
                }

                record.put("item_type", itemType)
                record.put("category", categoryVal)
                record.put("parent_equipment_id", parentIdVal ?: JSONObject.NULL)
                record.put("manufacturer", manufacturerVal)
                record.put("model", modelVal)
                record.put("name", nameVal)
                record.put("serial_number", serialNumberVal)
                record.put("purchase_date", purchaseDateVal)
                record.put("purchase_price", purchasePriceVal ?: JSONObject.NULL)
                record.put("dealer", dealerVal)
                record.put("photo", resolvedPhoto ?: JSONObject.NULL)
                record.put("images", imagesJson)
                record.put("documents", docsJson)
                record.put("custom_fields", customFieldsJson)
                record.put("custom_sections", customSectionsJson)
                record.put("specs", mergedSpecs)
                record.put(
                    "notes",
                    if (payload.has("notes") && !payload.isNull("notes")) payload.optString("notes", "")
                    else prev?.optString("notes", "").orEmpty()
                )
                record.put("status", statusVal)
                record.put("last_maintenance", lastMaintIso)
                record.put("next_maintenance", nextMaintIso)
                record.put(
                    "maintenance_plan",
                    if (payload.has("maintenance_plan") && !payload.isNull("maintenance_plan")) payload.optString("maintenance_plan", "")
                    else prev?.optString("maintenance_plan", "").orEmpty()
                )
                record.put("interval_months", parsedInterval)
                record.put("history", mergedHistory)
                record.put("created_at", prev?.optString("created_at")?.takeIf { it.isNotEmpty() } ?: nowIso)
                record.put("updated_at", nowIso)

                if (existingIdx >= 0) arr.put(existingIdx, record) else prependToArray(arr, record)

                val accessoriesArr = payload.optJSONArray("accessories")
                if (itemType == "geraet" && accessoriesArr != null) {
                    for (i in 0 until accessoriesArr.length()) {
                        val accEntry = accessoriesArr.opt(i) ?: continue
                        if (accEntry is String) {
                            val accName = accEntry.trim()
                            if (accName.isNotEmpty()) {
                                val accCopy = JSONObject()
                                    .put("name", accName)
                                    .put("item_type", "zubehoer")
                                    .put("parent_equipment_id", id)
                                upsertRecordInState(state, "equipments", accCopy)
                            }
                        } else if (accEntry is JSONObject) {
                            val accCopy = JSONObject(accEntry.toString())
                            accCopy.put("item_type", "zubehoer")
                            accCopy.put("parent_equipment_id", id)
                            upsertRecordInState(state, "equipments", accCopy)
                        }
                    }
                }
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
            "send_invoice" -> sendInvoiceInState(state, args)
            "send_work_record" -> sendWorkRecordInState(state, args)
            "get_invoice_pdf" -> getInvoicePdfInState(state, args)
            "delivery_status" -> getDeliveryStatusInState(state, args)
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

        val billingCust = resolveCustomerByIdOrName(customers, customerId)
            ?: throw IllegalArgumentException("Kunde mit ID '$customerId' nicht gefunden.")
        val effectiveCustId = billingCust.optString("id", customerId)

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
                    getEffectiveBillingCustomerId(w, customers) == effectiveCustId
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
            .put("sent_to", JSONObject.NULL)
            .put("sent_status", JSONObject.NULL)
            .put("sent_message_id", JSONObject.NULL)

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
            .put("sent_to", JSONObject.NULL)
            .put("sent_status", JSONObject.NULL)
            .put("sent_message_id", JSONObject.NULL)

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

    private fun sendInvoiceInState(state: JSONObject, args: JSONObject): JSONObject {
        val invRef = firstNonBlank(
            args.optString("invoice_id", ""),
            args.optString("id", "")
        )
        if (invRef.isEmpty()) {
            throw IllegalArgumentException("Parameter 'invoice_id' (ID oder Rechnungsnummer, z.B. RE-75/2026) ist erforderlich.")
        }

        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        var inv: JSONObject? = null
        for (i in 0 until invoices.length()) {
            val candidate = invoices.optJSONObject(i) ?: continue
            val candId = candidate.optString("id", "").trim()
            val candNum = candidate.optString("invoice_number", "").trim()
            if (
                candId == invRef ||
                candNum == invRef ||
                candId.equals(invRef, ignoreCase = true) ||
                candNum.equals(invRef, ignoreCase = true)
            ) {
                inv = candidate
                break
            }
        }
        if (inv == null) {
            throw IllegalArgumentException("Rechnung '$invRef' nicht gefunden.")
        }

        val invNum = inv.optString("invoice_number", inv.optString("id"))
        if (inv.optString("status") == "cancelled" && !inv.optBoolean("is_storno", false)) {
            throw IllegalStateException("Versand abgelehnt: Rechnung $invNum ist storniert und kann nicht versendet werden.")
        }

        // Doppelten Versand durch wiederholte MCP-Aufrufe verhindern
        val existingSentStatus = optNullableString(inv, "sent_status")
        val existingSentAt = optNullableString(inv, "sent_at")
        if (existingSentStatus == "sent" || existingSentAt != null) {
            val prevTo = optNullableString(inv, "sent_to") ?: optNullableString(inv, "sent_via") ?: "den Empfänger"
            val prevMsgId = optNullableString(inv, "sent_message_id") ?: "vorhanden"
            throw IllegalStateException(
                "Doppelversand verhindert: Rechnung $invNum wurde bereits am ${existingSentAt ?: "zuvor"} an $prevTo versendet (Status: ${existingSentStatus ?: "sent"}, Nachrichten-ID: $prevMsgId)."
            )
        }

        val customers = state.optJSONArray("customers") ?: JSONArray()
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val customer = findById(customers, inv.optString("customer_id", ""))
        val recipientName = firstNonBlank(
            inv.optString("billing_customer_name", ""),
            customer?.optString("name", "").orEmpty(),
            "Kunde"
        )
        val recipientEmail = firstNonBlank(
            args.optString("recipient_email", ""),
            optNullableString(inv, "sent_to").orEmpty(),
            customer?.optString("email", "").orEmpty()
        )
        if (recipientEmail.isEmpty() || !recipientEmail.contains("@")) {
            throw IllegalStateException(
                "Versand fehlgeschlagen: Für Rechnung $invNum ($recipientName) ist keine gültige Empfänger-E-Mail-Adresse in Infinity hinterlegt."
            )
        }

        if (args.optBoolean("dry_run", false)) {
            val dryOut = JSONObject()
                .put("ok", true)
                .put("action", "send_invoice")
                .put("dry_run", true)
                .put("sent", false)
                .put("ready_to_send", true)
                .put("requires_user_confirmed", true)
                .put("invoice_id", inv.optString("id"))
                .put("invoice_number", invNum)
                .put("recipient_name", recipientName)
                .put("recipient_email", recipientEmail)
                .put("total_amount", inv.optDouble("total_amount", 0.0))
            runCatching {
                MainActivity.buildInvoicePdfViaExistingEngineBlocking(inv, customers, workRecords)
            }.onSuccess { pdfPayload ->
                dryOut.put("filename", pdfPayload.optString("filename", "Rechnung.pdf"))
                dryOut.put("pdf_size_bytes", pdfPayload.optInt("pdfSizeBytes", 0))
                dryOut.put("subject", pdfPayload.optString("subject", ""))
            }
            return dryOut
        }

        // Versand nur nach ausdrücklicher Freigabe durch den Nutzer
        val userConfirmed = args.optBoolean("user_confirmed", false) || args.optBoolean("confirmed", false)
        if (!userConfirmed) {
            val totalStr = "${formatDec(inv.optDouble("total_amount", 0.0))} EUR"
            throw IllegalStateException(
                "Freigabe erforderlich: Rechnung $invNum ($totalStr) an $recipientEmail ($recipientName) darf nur nach ausdrücklicher Freigabe durch den Nutzer versendet werden. Bitte Freigabe einholen und anschließend mit \"user_confirmed\": true erneut aufrufen."
            )
        }

        val sendResult = MainActivity.sendInvoiceViaExistingEngineBlocking(
            context = context,
            invoice = inv,
            customers = customers,
            workRecords = workRecords,
            recipientEmail = recipientEmail
        )

        val sentDateIso = todayIso()
        val messageId = sendResult.optString("messageId", "gmail-${System.currentTimeMillis()}")
        val filename = sendResult.optString("filename", "Rechnung.pdf")
        val sentViaLabel = "Gmail PDF ($recipientEmail)"

        inv.put("sent_at", sentDateIso)
        inv.put("sent_to", recipientEmail)
        inv.put("sent_status", "sent")
        inv.put("sent_message_id", messageId)
        inv.put("sent_via", sentViaLabel)
        inv.put("updated_at", Instant.now().toString())

        val deliveryConfirmation = JSONObject()
            .put("sent", true)
            .put("delivered_to_provider", true)
            .put("provider", sendResult.optString("method", "gmail_api"))
            .put("message_id", messageId)
            .put("sent_at", sentDateIso)
            .put("recipient_email", recipientEmail)
            .put("filename", filename)

        return JSONObject()
            .put("ok", true)
            .put("action", "send_invoice")
            .put("invoice_id", inv.optString("id"))
            .put("invoice_number", invNum)
            .put("sent_at", sentDateIso)
            .put("sent_to", recipientEmail)
            .put("sent_status", "sent")
            .put("sent_message_id", messageId)
            .put("sent_via", sentViaLabel)
            .put("filename", filename)
            .put("delivery_confirmation", deliveryConfirmation)
            .put("invoice", inv)
    }

    private fun findInvoiceByRef(invoices: JSONArray, rawRef: String): JSONObject? {
        val ref = rawRef.trim()
        if (ref.isEmpty()) return null
        for (i in 0 until invoices.length()) {
            val cand = invoices.optJSONObject(i) ?: continue
            val cid = cand.optString("id", "").trim()
            val cnum = cand.optString("invoice_number", "").trim()
            if (cid.equals(ref, ignoreCase = true) || cnum.equals(ref, ignoreCase = true)) {
                return cand
            }
        }
        return null
    }

    private fun getInvoicePdfInState(state: JSONObject, args: JSONObject): JSONObject {
        val invRef = firstNonBlank(
            args.optString("invoice_id", ""),
            args.optString("id", "")
        )
        if (invRef.isEmpty()) {
            throw IllegalArgumentException("Parameter 'invoice_id' (ID oder Rechnungsnummer, z.B. RE-75/2026) ist erforderlich.")
        }

        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        val inv = findInvoiceByRef(invoices, invRef)
            ?: throw IllegalArgumentException("Rechnung '$invRef' nicht gefunden.")

        val customers = state.optJSONArray("customers") ?: JSONArray()
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val pdfPayload = MainActivity.buildInvoicePdfViaExistingEngineBlocking(inv, customers, workRecords)

        val base64Pdf = pdfPayload.optString("base64Pdf", "")
        val filename = pdfPayload.optString("filename", "Rechnung.pdf")
        val pdfSizeBytes = pdfPayload.optInt("pdfSizeBytes", (base64Pdf.length * 3) / 4)
        val includeBase64 = if (args.has("include_base64")) args.optBoolean("include_base64", true) else true

        val sentStatus = optNullableString(inv, "sent_status")
        val sentAt = optNullableString(inv, "sent_at")
        val sentMsgId = optNullableString(inv, "sent_message_id")
        val isSent = sentStatus == "sent" || sentAt != null

        val deliveryStatus = JSONObject()
            .put("sent", isSent)
            .put("delivered_to_provider", isSent && sentMsgId != null)
            .put("sent_status", sentStatus ?: (if (isSent) "sent" else "unsent"))
            .put("sent_at", sentAt ?: JSONObject.NULL)
            .put("sent_to", optNullableString(inv, "sent_to") ?: JSONObject.NULL)
            .put("sent_via", optNullableString(inv, "sent_via") ?: JSONObject.NULL)
            .put("sent_message_id", sentMsgId ?: JSONObject.NULL)

        val out = JSONObject()
            .put("ok", true)
            .put("action", "get_invoice_pdf")
            .put("invoice_id", inv.optString("id"))
            .put("invoice_number", inv.optString("invoice_number"))
            .put("customer_id", inv.optString("customer_id"))
            .put("recipient_name", pdfPayload.optString("recipientName", inv.optString("billing_customer_name", "")))
            .put("recipient_email", pdfPayload.optString("recipientEmail", ""))
            .put("filename", filename)
            .put("mime_type", "application/pdf")
            .put("pdf_size_bytes", pdfSizeBytes)
            .put("subject", pdfPayload.optString("subject", ""))
            .put("body_text", pdfPayload.optString("bodyText", ""))
            .put("total_amount", inv.optDouble("total_amount", 0.0))
            .put("delivery_status", deliveryStatus)

        if (includeBase64) {
            out.put("pdf_base64", base64Pdf)
            out.put("data_url", "data:application/pdf;base64,$base64Pdf")
        }
        return out
    }

    private fun getDeliveryStatusInState(state: JSONObject, args: JSONObject): JSONObject {
        val invRef = args.optString("invoice_id", "").trim()
        val wrRef = args.optString("work_record_id", "").trim()
        val genericId = args.optString("id", "").trim()

        val invoices = state.optJSONArray("invoices") ?: JSONArray()
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val customers = state.optJSONArray("customers") ?: JSONArray()

        val targetInvRef = invRef.ifEmpty { genericId }
        if (targetInvRef.isNotEmpty()) {
            val inv = findInvoiceByRef(invoices, targetInvRef)
            if (inv != null || invRef.isNotEmpty()) {
                if (inv == null) {
                    throw IllegalArgumentException("Rechnung '$targetInvRef' nicht gefunden.")
                }
                val cust = findById(customers, inv.optString("customer_id"))
                val sentStatus = optNullableString(inv, "sent_status")
                val sentAt = optNullableString(inv, "sent_at")
                val sentMsgId = optNullableString(inv, "sent_message_id")
                val isSent = sentStatus == "sent" || sentAt != null
                val recipientEmail = firstNonBlank(
                    optNullableString(inv, "sent_to").orEmpty(),
                    cust?.optString("email", "").orEmpty()
                )
                return JSONObject()
                    .put("ok", true)
                    .put("action", "delivery_status")
                    .put("record_type", "invoice")
                    .put("id", inv.optString("id"))
                    .put("invoice_id", inv.optString("id"))
                    .put("invoice_number", inv.optString("invoice_number"))
                    .put("customer_id", inv.optString("customer_id"))
                    .put("recipient_name", firstNonBlank(inv.optString("billing_customer_name", ""), cust?.optString("name", "").orEmpty()))
                    .put("recipient_email", recipientEmail.ifEmpty { JSONObject.NULL })
                    .put("sent", isSent)
                    .put("delivered_to_provider", isSent && sentMsgId != null)
                    .put("sent_status", sentStatus ?: (if (isSent) "sent" else "unsent"))
                    .put("sent_at", sentAt ?: JSONObject.NULL)
                    .put("sent_to", optNullableString(inv, "sent_to") ?: JSONObject.NULL)
                    .put("sent_via", optNullableString(inv, "sent_via") ?: JSONObject.NULL)
                    .put("sent_message_id", sentMsgId ?: JSONObject.NULL)
            }
        }

        val targetWrRef = wrRef.ifEmpty { genericId }
        if (targetWrRef.isNotEmpty()) {
            val wr = findById(workRecords, targetWrRef)
                ?: throw IllegalArgumentException("Arbeitsaufzeichnung oder Rechnung '$targetWrRef' nicht gefunden.")
            val cust = findById(customers, wr.optString("customer_id"))
            val sentStatus = optNullableString(wr, "sent_status")
            val sentAt = optNullableString(wr, "sent_at")
            val sentMsgId = optNullableString(wr, "sent_message_id")
            val isSent = sentStatus == "sent" || sentAt != null
            val recipientEmail = firstNonBlank(
                optNullableString(wr, "sent_to").orEmpty(),
                cust?.optString("email", "").orEmpty()
            )
            return JSONObject()
                .put("ok", true)
                .put("action", "delivery_status")
                .put("record_type", "workRecord")
                .put("id", wr.optString("id"))
                .put("work_record_id", wr.optString("id"))
                .put("title", wr.optString("title"))
                .put("work_date", wr.optString("work_date"))
                .put("customer_id", wr.optString("customer_id"))
                .put("recipient_name", cust?.optString("name") ?: "")
                .put("recipient_email", recipientEmail.ifEmpty { JSONObject.NULL })
                .put("sent", isSent)
                .put("delivered_to_provider", isSent && sentMsgId != null)
                .put("sent_status", sentStatus ?: (if (isSent) "sent" else "unsent"))
                .put("sent_at", sentAt ?: JSONObject.NULL)
                .put("sent_to", optNullableString(wr, "sent_to") ?: JSONObject.NULL)
                .put("sent_via", optNullableString(wr, "sent_via") ?: JSONObject.NULL)
                .put("sent_message_id", sentMsgId ?: JSONObject.NULL)
        }

        throw IllegalArgumentException("Parameter 'invoice_id', 'work_record_id' oder 'id' ist für delivery_status erforderlich.")
    }

    private fun sendWorkRecordInState(state: JSONObject, args: JSONObject): JSONObject {
        val workRecords = state.optJSONArray("workRecords") ?: JSONArray()
        val customers = state.optJSONArray("customers") ?: JSONArray()
        val properties = state.optJSONArray("properties") ?: JSONArray()

        val requestedIds = mutableListOf<String>()
        val idsArr = args.optJSONArray("work_record_ids")
        if (idsArr != null) {
            for (i in 0 until idsArr.length()) {
                val wid = idsArr.optString(i, "").trim()
                if (wid.isNotEmpty() && !requestedIds.contains(wid)) requestedIds.add(wid)
            }
        }
        val singleId = firstNonBlank(
            args.optString("work_record_id", ""),
            args.optString("id", "")
        )
        if (singleId.isNotEmpty() && !requestedIds.contains(singleId)) {
            requestedIds.add(singleId)
        }

        val targetRecords = mutableListOf<JSONObject>()
        if (requestedIds.isNotEmpty()) {
            for (wid in requestedIds) {
                val rec = findById(workRecords, wid)
                    ?: throw IllegalArgumentException("Arbeitsaufzeichnung '$wid' nicht gefunden.")
                targetRecords.add(rec)
            }
        } else {
            val custRef = args.optString("customer_id", "").trim()
            if (custRef.isNotEmpty()) {
                val resolvedCust = resolveCustomerByIdOrName(customers, custRef)
                val targetCustId = resolvedCust?.optString("id") ?: custRef
                for (i in 0 until workRecords.length()) {
                    val w = workRecords.optJSONObject(i) ?: continue
                    if (
                        (w.optString("customer_id") == targetCustId ||
                            getEffectiveBillingCustomerId(w, customers) == targetCustId) &&
                        optNullableString(w, "settlement_id") == null &&
                        w.optBoolean("billable", true) &&
                        !w.optBoolean("is_lcr", false)
                    ) {
                        targetRecords.add(w)
                    }
                }
            }
        }

        if (targetRecords.isEmpty()) {
            throw IllegalArgumentException(
                "Keine passenden Arbeitsaufzeichnungen zum Versenden gefunden. Bitte 'work_record_id', 'work_record_ids' oder 'customer_id' angeben."
            )
        }

        val primaryRec = targetRecords[0]
        val effectiveCustId = getEffectiveBillingCustomerId(primaryRec, customers)
        val customer = findById(customers, effectiveCustId) ?: findById(customers, primaryRec.optString("customer_id"))
        val recipientName = firstNonBlank(customer?.optString("name", "").orEmpty(), "Kunde")
        val recipientEmail = firstNonBlank(
            args.optString("recipient_email", ""),
            optNullableString(primaryRec, "sent_to").orEmpty(),
            customer?.optString("email", "").orEmpty()
        )
        if (recipientEmail.isEmpty() || !recipientEmail.contains("@")) {
            throw IllegalStateException(
                "Versand fehlgeschlagen: Für Arbeitsaufzeichnung '${primaryRec.optString("title")}' ($recipientName) ist keine gültige Empfänger-E-Mail-Adresse hinterlegt."
            )
        }

        val sorted = targetRecords.sortedBy { it.optString("work_date", "") }
        val subject = if (sorted.size == 1) {
            "Arbeitsaufzeichnung vom ${formatDeDate(sorted[0].optString("work_date", todayIso()))} – ${sorted[0].optString("title", "Gartenarbeit")} – Hafner Grünraum Handwerk"
        } else {
            "Arbeitsaufzeichnungen (${sorted.size} Einsätze) – Hafner Grünraum Handwerk"
        }

        var totalHours = 0.0
        var totalAmount = 0.0
        val lines = mutableListOf<String>()
        for (idx in sorted.indices) {
            val rec = sorted[idx]
            val propId = optNullableString(rec, "property_id")
            val prop = if (propId != null) findById(properties, propId) else null
            val dateStr = formatDeDate(rec.optString("work_date", todayIso()))
            val hrs = rec.optDouble("hours", 0.0)
            val amt = getWorkAccountingAmount(rec)
            totalHours += hrs
            totalAmount += amt
            val propSuffix = if (prop != null && prop.optString("name", "").isNotEmpty()) " (${prop.optString("name")})" else ""
            val amtSuffix = if (amt > 0.0) " · ${formatDec(amt)} EUR" else ""
            lines.add("${idx + 1}. $dateStr – ${rec.optString("title", "Gartenarbeit")}$propSuffix: ${formatDec(hrs)} Std.$amtSuffix")

            val mats = rec.optJSONArray("materials")
            if (mats != null && mats.length() > 0) {
                for (mIdx in 0 until mats.length()) {
                    val m = mats.optJSONObject(mIdx) ?: continue
                    val mTot = if (m.has("total") && !m.isNull("total")) " (${formatDec(m.optDouble("total", 0.0))} EUR)" else ""
                    lines.add("   - Material: ${formatDec(m.optDouble("quantity", 1.0))} ${m.optString("unit", "Stück")} ${m.optString("name", "Material")}$mTot")
                }
            }
            val notes = rec.optString("notes", "").trim()
            if (notes.isNotEmpty() && rec.optBoolean("customer_visible", true)) {
                lines.add("   - Hinweis: $notes")
            }
        }
        totalHours = round2(totalHours)
        totalAmount = round2(totalAmount)

        val totalLine = if (totalAmount > 0.0) {
            "Gesamt: ${formatDec(totalHours)} Std. · ${formatDec(totalAmount)} EUR"
        } else {
            "Gesamtstunden: ${formatDec(totalHours)} Std."
        }
        val bodyText = listOf(
            "Guten Tag $recipientName,",
            "",
            "anbei erhalten Sie die Übersicht Ihrer durchgeführten Arbeiten von Hafner Michael – Grünraum Handwerk:",
            "",
            lines.joinToString("\n"),
            "",
            totalLine,
            "",
            "Mit freundlichen Grüßen",
            "Michael Hafner",
            "Hafner Grünraum Handwerk",
            "Tel.: +436781280702",
            "E-Mail: mihalhafner@gmail.com"
        ).joinToString("\n")

        val outIdsArr = JSONArray()
        for (r in targetRecords) outIdsArr.put(r.optString("id"))

        if (args.optBoolean("dry_run", false)) {
            return JSONObject()
                .put("ok", true)
                .put("action", "send_work_record")
                .put("dry_run", true)
                .put("sent", false)
                .put("ready_to_send", true)
                .put("requires_user_confirmed", true)
                .put("work_record_ids", outIdsArr)
                .put("count", targetRecords.size)
                .put("recipient_name", recipientName)
                .put("recipient_email", recipientEmail)
                .put("subject", subject)
                .put("body_text", bodyText)
                .put("total_hours", totalHours)
                .put("total_amount", totalAmount)
        }

        val userConfirmed = args.optBoolean("user_confirmed", false) || args.optBoolean("confirmed", false)
        if (!userConfirmed) {
            throw IllegalStateException(
                "Freigabe erforderlich: Arbeitsaufzeichnung (${targetRecords.size} Eintrag/Einträge, ${formatDec(totalHours)} Std.) an $recipientEmail ($recipientName) darf nur nach ausdrücklicher Freigabe durch den Nutzer versendet werden. Bitte Freigabe einholen und anschließend mit \"user_confirmed\": true erneut aufrufen."
            )
        }

        val sendResult = MainActivity.sendPlainEmailViaExistingEngineBlocking(
            context = context,
            recipientEmail = recipientEmail,
            subject = subject,
            bodyText = bodyText,
            notificationLabel = "Arbeitsaufzeichnung"
        )

        val sentDateIso = todayIso()
        val nowIso = Instant.now().toString()
        val messageId = sendResult.optString("messageId", "gmail-work-${System.currentTimeMillis()}")
        val sentViaLabel = "Gmail Arbeitsaufzeichnung ($recipientEmail)"

        val updatedArr = JSONArray()
        for (rec in targetRecords) {
            rec.put("sent_at", sentDateIso)
            rec.put("sent_to", recipientEmail)
            rec.put("sent_status", "sent")
            rec.put("sent_message_id", messageId)
            rec.put("sent_via", sentViaLabel)
            rec.put("updated_at", nowIso)
            updatedArr.put(stripHeavyPhotos(rec, false))
        }

        val deliveryConfirmation = JSONObject()
            .put("sent", true)
            .put("delivered_to_provider", true)
            .put("provider", sendResult.optString("method", "gmail_api"))
            .put("message_id", messageId)
            .put("sent_at", sentDateIso)
            .put("recipient_email", recipientEmail)

        return JSONObject()
            .put("ok", true)
            .put("action", "send_work_record")
            .put("work_record_ids", outIdsArr)
            .put("count", targetRecords.size)
            .put("sent_at", sentDateIso)
            .put("sent_to", recipientEmail)
            .put("sent_status", "sent")
            .put("sent_message_id", messageId)
            .put("sent_via", sentViaLabel)
            .put("subject", subject)
            .put("total_hours", totalHours)
            .put("total_amount", totalAmount)
            .put("delivery_confirmation", deliveryConfirmation)
            .put("records", updatedArr)
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
                                .put("billable", JSONObject().put("type", "boolean"))
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
                                .put("include_pdf", JSONObject().put("type", "boolean"))
                                .put("include_delivery_status", JSONObject().put("type", "boolean"))
                                .put("invoice_id", JSONObject().put("type", "string"))
                                .put("work_record_id", JSONObject().put("type", "string"))
                        )
                )
        )

        tools.put(
            JSONObject()
                .put("name", "pixel_aktion")
                .put(
                    "description",
                    "Geprüfte Schreibfunktion für die lokale Infinity-Datenbank auf dem Pixel 10 Pro (erfordert aktive Schreibfreigabe am Gerät): Anlegen, Ändern und Löschen von Kunden, Objekten, Terminen, Arbeitsaufzeichnungen, Anfragen, Angeboten, Aufträgen, Geräten, Material und Ausgaben sowie Direktversand von Rechnungen (op='send_invoice') und Arbeitsaufzeichnungen (op='send_work_record'), Abruf des Original-Rechnungs-PDFs (op='get_invoice_pdf') und Versand-/Zustellbestätigung (op='delivery_status')."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Infinity Daten anlegen, ändern, löschen & versenden")
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
                                                .put("update")
                                                .put("delete")
                                                .put("toggle_lcr")
                                                .put("maintenance")
                                                .put("equipment_media")
                                                .put("tax_settings")
                                                .put("send_invoice")
                                                .put("send_work_record")
                                                .put("get_invoice_pdf")
                                                .put("delivery_status")
                                        )
                                )
                                .put("invoice_id", JSONObject().put("type", "string"))
                                .put("work_record_id", JSONObject().put("type", "string"))
                                .put("customer_id", JSONObject().put("type", "string"))
                                .put("user_confirmed", JSONObject().put("type", "boolean"))
                                .put("dry_run", JSONObject().put("type", "boolean"))
                                .put("recipient_email", JSONObject().put("type", "string"))
                                .put("include_base64", JSONObject().put("type", "boolean"))
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
                    "Geprüfte Abrechnungs- und Versand-Logik auf dem Pixel 10 Pro: Erstellt Rechnungen (Format RE-75/2026, §6 Abs. 1 Z 27 UStG Kleinunternehmerregelung, Sperre abgerechneter Arbeiten über settlement_id), ruft das Original-Rechnungs-PDF ab (action='get_invoice_pdf'), versendet Original-Rechnungs-PDFs (action='send_invoice', user_confirmed=true) oder Arbeitsaufzeichnungen (action='send_work_record', user_confirmed=true), prüft die Versand- und Zustellbestätigung (action='delivery_status'), verbucht Zahlungen oder erstellt Stornobelege (RE-S01/2026)."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Infinity Rechnung erstellen, PDF abrufen, versenden, Zahlung buchen oder stornieren")
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
                                                .put("send_invoice")
                                                .put("send_work_record")
                                                .put("get_invoice_pdf")
                                                .put("delivery_status")
                                                .put("pay")
                                                .put("update_payment")
                                                .put("reverse_payment")
                                                .put("delete_payment")
                                                .put("refund")
                                                .put("storno")
                                        )
                                )
                                .put("customer_id", JSONObject().put("type", "string"))
                                .put("work_record_id", JSONObject().put("type", "string"))
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
                                .put("include_base64", JSONObject().put("type", "boolean"))
                                .put("user_confirmed", JSONObject().put("type", "boolean"))
                                .put("dry_run", JSONObject().put("type", "boolean"))
                                .put("recipient_email", JSONObject().put("type", "string"))
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

        tools.put(
            JSONObject()
                .put("name", "admin_send_invoice")
                .put(
                    "description",
                    "Versendet eine bestehende Original-Rechnung (PDF) aus Infinity per E-Mail an die hinterlegte Kundenadresse und liefert die Versand- und Zustellbestätigung (sent_message_id, sent_at, delivery_confirmation). Erfordert ausdrückliche Nutzerfreigabe (user_confirmed=true) oder dry_run=true für einen Trockenlauf."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Bestehende Rechnung per E-Mail versenden")
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
                        .put("required", JSONArray().put("invoice_id"))
                        .put(
                            "properties",
                            JSONObject()
                                .put("invoice_id", JSONObject().put("type", "string"))
                                .put("user_confirmed", JSONObject().put("type", "boolean"))
                                .put("dry_run", JSONObject().put("type", "boolean"))
                                .put("recipient_email", JSONObject().put("type", "string"))
                                .put("request_id", JSONObject().put("type", "string"))
                                .put("expected_revision", JSONObject().put("type", "number"))
                        )
                )
        )

        tools.put(
            JSONObject()
                .put("name", "admin_send_work_record")
                .put(
                    "description",
                    "Versendet eine oder mehrere Arbeitsaufzeichnungen aus Infinity direkt per E-Mail an den Kunden und speichert die Versand- und Zustellbestätigung (sent_at, sent_to, sent_status='sent', sent_message_id). Erfordert user_confirmed=true oder dry_run=true."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Arbeitsaufzeichnung direkt per E-Mail versenden")
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
                        .put(
                            "properties",
                            JSONObject()
                                .put("work_record_id", JSONObject().put("type", "string"))
                                .put(
                                    "work_record_ids",
                                    JSONObject()
                                        .put("type", "array")
                                        .put("items", JSONObject().put("type", "string"))
                                )
                                .put("customer_id", JSONObject().put("type", "string"))
                                .put("user_confirmed", JSONObject().put("type", "boolean"))
                                .put("dry_run", JSONObject().put("type", "boolean"))
                                .put("recipient_email", JSONObject().put("type", "string"))
                                .put("request_id", JSONObject().put("type", "string"))
                                .put("expected_revision", JSONObject().put("type", "number"))
                        )
                )
        )

        tools.put(
            JSONObject()
                .put("name", "admin_get_invoice_pdf")
                .put(
                    "description",
                    "Ruft das Original-Rechnungs-PDF einer bestehenden Rechnung aus Infinity ab (inkl. Base64-PDF pdf_base64, data_url, Dateiname, Betreff, Begleittext und aktuellem Versand-/Zustellstatus), z.B. für direkten Abruf oder Übergabe an einen Versanddienst."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Original-Rechnungs-PDF abrufen")
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
                        .put("required", JSONArray().put("invoice_id"))
                        .put(
                            "properties",
                            JSONObject()
                                .put("invoice_id", JSONObject().put("type", "string"))
                                .put("include_base64", JSONObject().put("type", "boolean"))
                        )
                )
        )

        tools.put(
            JSONObject()
                .put("name", "admin_get_delivery_status")
                .put(
                    "description",
                    "Ruft die Versand- und Zustellbestätigung (sent, delivered_to_provider, sent_status, sent_at, sent_to, sent_via, sent_message_id) für eine Rechnung oder eine Arbeitsaufzeichnung ab."
                )
                .put(
                    "annotations",
                    JSONObject()
                        .put("title", "Versand- und Zustellbestätigung abrufen")
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
                                .put("invoice_id", JSONObject().put("type", "string"))
                                .put("work_record_id", JSONObject().put("type", "string"))
                                .put("id", JSONObject().put("type", "string"))
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
