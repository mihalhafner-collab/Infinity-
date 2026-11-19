package at.hafner.gruenraum.documents

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

/**
 * Nativer 1:1 DIN-5008 Rechnungs-PDF-Generator für das Google Pixel 10 Pro.
 *
 * Erzeugt das Original-Rechnungs-PDF (Layout RE-75/2026 inkl. Original-Logo, Falzmarken,
 * Kleinunternehmer-Hinweis gem. §6 Abs. 1 Z 27 UStG 1994 und 4-spaltiger Fußzeile)
 * direkt im Hintergrund ohne WebView-Abhängigkeit in ~25–35 ms.
 */
object NativeInvoicePdfGenerator {

    @Volatile
    private var cachedLogoBitmap: Bitmap? = null

    private data class CachedPdfEntry(
        val cacheKey: String,
        val createdAtMs: Long,
        val payloadJson: String
    )

    @Volatile
    private var cachedPdfEntry: CachedPdfEntry? = null
    private const val PDF_CACHE_TTL_MS = 60_000L

    private fun getOrLoadLogoBitmap(context: Context): Bitmap? {
        val existing = cachedLogoBitmap
        if (existing != null && !existing.isRecycled) {
            return existing
        }
        return synchronized(this) {
            val again = cachedLogoBitmap
            if (again != null && !again.isRecycled) {
                return@synchronized again
            }
            val loaded = runCatching {
                context.applicationContext.assets
                    .open("www/assets/aistudio/Hafner_Rechnungslogo_Original_236f7b3b.png")
                    .use { stream -> BitmapFactory.decodeStream(stream) }
            }.getOrNull()
            cachedLogoBitmap = loaded
            loaded
        }
    }

    fun detectSalutationLine(recipientName: String, company: String): String {
        val raw = recipientName.trim()
        val comp = company.trim()
        if (raw.isEmpty()) return "Sehr geehrte Damen und Herren,"
        val combined = "$raw $comp".lowercase(Locale.GERMAN)
        val legalRegex = Regex(
            "\\b(gesbr|gbr|gmbh|gesmbh|kg|og|ag|e\\.?u\\.?|weg|arge|verein|gemeinde|stadtgemeinde|praxis|ordination|kanzlei|hausverwaltung)\\b"
        )
        if (legalRegex.containsMatchIn(combined)) {
            return "Sehr geehrte Damen und Herren,"
        }
        val withoutParens = raw.replace(Regex("\\s*\\([^)]*\\)\\s*"), " ").trim()
        val famMatch =
            Regex("^(?:familie|fam\\.?|ehepaar)\\s+(.+)$", RegexOption.IGNORE_CASE).find(withoutParens)
        if (famMatch != null) {
            val last = famMatch.groupValues[1].trim().split(Regex("\\s+")).lastOrNull() ?: withoutParens
            return "Sehr geehrte Familie $last,"
        }
        val frauMatch = Regex("^(?:frau|fr\\.?)\\s+(.+)$", RegexOption.IGNORE_CASE).find(withoutParens)
        if (frauMatch != null) {
            val last = frauMatch.groupValues[1].trim().split(Regex("\\s+")).lastOrNull() ?: withoutParens
            return "Sehr geehrte Frau $last,"
        }
        val herrMatch = Regex("^(?:herrn?|hr\\.?)\\s+(.+)$", RegexOption.IGNORE_CASE).find(withoutParens)
        if (herrMatch != null) {
            val last = herrMatch.groupValues[1].trim().split(Regex("\\s+")).lastOrNull() ?: withoutParens
            return "Sehr geehrter Herr $last,"
        }

        val tokens = withoutParens
            .split(Regex("\\s+"))
            .map { it.trim().replace(",", "") }
            .filter {
                it.isNotEmpty() &&
                    !it.equals("Dr.", true) &&
                    !it.equals("Mag.", true) &&
                    !it.equals("Ing.", true) &&
                    !it.equals("DI", true)
            }

        if (tokens.size >= 2) {
            val firstLow = tokens.first().lowercase(Locale.GERMAN)
            val lastLow = tokens.last().lowercase(Locale.GERMAN)
            return when {
                FEMALE_NAMES.contains(firstLow) -> "Sehr geehrte Frau ${tokens.last()},"
                MALE_NAMES.contains(firstLow) -> "Sehr geehrter Herr ${tokens.last()},"
                FEMALE_NAMES.contains(lastLow) -> "Sehr geehrte Frau ${tokens.first()},"
                MALE_NAMES.contains(lastLow) -> "Sehr geehrter Herr ${tokens.first()},"
                else -> "Sehr geehrte Damen und Herren,"
            }
        }
        return "Sehr geehrte Damen und Herren,"
    }

    fun buildInvoicePdf(
        context: Context,
        invoice: JSONObject,
        customers: JSONArray,
        workRecords: JSONArray,
        fallbackNote: String? = null
    ): JSONObject {
        val custId = invoice.optString("customer_id", "")
        var customer: JSONObject? = null
        for (i in 0 until customers.length()) {
            val c = customers.optJSONObject(i) ?: continue
            if (c.optString("id") == custId) {
                customer = c
                break
            }
        }

        val invId = invoice.optString("id", "")
        val invNum = invoice.optString("invoice_number", invId.ifBlank { "RE-2026" })
        val invUpdatedAt = invoice.optString("updated_at", "")
        val custUpdatedAt = customer?.optString("updated_at", "").orEmpty()
        val cacheKey = "$invId|$invNum|$invUpdatedAt|${invoice.optDouble("total_amount", 0.0)}|$custUpdatedAt"

        val existingPdf = cachedPdfEntry
        val nowMs = System.currentTimeMillis()
        if (existingPdf != null && existingPdf.cacheKey == cacheKey && (nowMs - existingPdf.createdAtMs) <= PDF_CACHE_TTL_MS) {
            val cachedObj = runCatching { JSONObject(existingPdf.payloadJson) }.getOrNull()
            if (cachedObj != null && cachedObj.optBoolean("ok", false)) {
                if (!fallbackNote.isNullOrBlank()) {
                    cachedObj.put("engineNote", fallbackNote)
                }
                cachedObj.put("cached", true)
                return cachedObj
            }
        }

        val isStorno = invoice.optBoolean("is_storno", false) ||
            invoice.optString("document_type", "") == "STORNO"
        val isPauschal = invoice.optBoolean("is_pauschal", false)
        val paidInCash = invoice.optBoolean("paid_in_cash", false)

        val custName = invoice.optString("billing_customer_name", "").ifBlank {
            customer?.optString("name", "")?.ifBlank {
                invoice.optString("customer_name_snapshot", "Kunde")
            } ?: invoice.optString("customer_name_snapshot", "Kunde")
        }
        val custStreet = invoice.optString("recipient_street", "").ifBlank {
            customer?.optString("street", "").orEmpty()
        }.trim()
        val custZip = invoice.optString("recipient_zip", "").ifBlank {
            customer?.optString("zip", "").orEmpty()
        }.trim()
        val custCity = invoice.optString("recipient_city", "").ifBlank {
            customer?.optString("city", "").orEmpty()
        }.trim()
        val custNum = invoice.optString("customer_number", "").ifBlank {
            customer?.optString("customer_number", "")?.ifBlank { "1001" } ?: "1001"
        }
        val recipientEmail = customer?.optString("email", "")?.trim()?.ifBlank {
            invoice.optString("sent_to", "").trim()
        } ?: invoice.optString("sent_to", "").trim()
        val recipientPhone = customer?.optString("phone", "")?.trim().orEmpty()

        fun fmtDate(iso: String): String {
            val clean = iso.trim().take(10)
            val parts = clean.split("-")
            return if (parts.size == 3) "${parts[2]}.${parts[1]}.${parts[0]}" else clean.ifEmpty { "—" }
        }

        val euroFormat = NumberFormat.getNumberInstance(Locale.GERMANY).apply {
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }

        fun fmtEuro(amount: Double): String {
            return "${euroFormat.format(if (amount.isFinite()) amount else 0.0)} EUR"
        }

        fun fmtQty(qty: Double): String {
            return euroFormat.format(if (qty.isFinite()) qty else 0.0)
        }

        val issueDateIso = invoice.optString("issue_date", "").ifBlank {
            invoice.optString("date", "")
        }.take(10)
        val invDate = fmtDate(issueDateIso)
        val dueDateIso = invoice.optString("due_date", "").take(10)
        val dueDate = fmtDate(dueDateIso)

        val boundIds = mutableSetOf<String>()
        val wrIdsArr = invoice.optJSONArray("work_record_ids")
        if (wrIdsArr != null) {
            for (i in 0 until wrIdsArr.length()) {
                val wid = wrIdsArr.optString(i, "").trim()
                if (wid.isNotEmpty()) boundIds.add(wid)
            }
        }
        val boundRecords = mutableListOf<JSONObject>()
        for (i in 0 until workRecords.length()) {
            val wr = workRecords.optJSONObject(i) ?: continue
            val wid = wr.optString("id", "")
            if (boundIds.contains(wid) || (invId.isNotEmpty() && wr.optString("settlement_id") == invId)) {
                boundRecords.add(wr)
            }
        }
        boundRecords.sortBy { it.optString("work_date", it.optString("date", "")) }

        val explicitPeriod = invoice.optString("service_period", "").trim()
        val periodDisplay = if (explicitPeriod.isNotEmpty()) {
            explicitPeriod
        } else {
            val dates = boundRecords
                .map { it.optString("work_date", it.optString("date", "")).take(10) }
                .filter { it.isNotEmpty() }
                .sorted()
            when {
                dates.isEmpty() -> invDate
                dates.first() == dates.last() -> fmtDate(dates.first())
                else -> "${fmtDate(dates.first())} - ${fmtDate(dates.last())}"
            }
        }

        data class NativeLineItem(
            val description: String,
            val quantityLabel: String,
            val unitPriceLabel: String,
            val amount: Double
        )

        val resolvedItems = mutableListOf<NativeLineItem>()
        val rawLineItems = invoice.optJSONArray("line_items") ?: invoice.optJSONArray("items")
        if (rawLineItems != null && rawLineItems.length() > 0) {
            for (i in 0 until rawLineItems.length()) {
                val item = rawLineItems.optJSONObject(i) ?: continue
                val desc = item.optString("description", "Leistung").trim().ifEmpty { "Leistung" }
                val qtyLabel = item.optString("quantity_label", "").trim().ifBlank {
                    val q = item.optDouble("quantity", 1.0)
                    val u = item.optString("unit", "Std").trim().ifEmpty { "Std" }
                    "${fmtQty(q)} $u"
                }.replace(Regex("\\s*Std\\.$"), " Std")
                val unitPriceLabel = item.optString("unit_price_label", "").trim().ifBlank {
                    if (item.has("unit_price") && !item.isNull("unit_price")) {
                        fmtEuro(item.optDouble("unit_price", 0.0))
                    } else {
                        "Pauschal"
                    }
                }.replace(Regex("\\s*€$"), " EUR")
                val amt = if (item.has("amount") && !item.isNull("amount")) {
                    item.optDouble("amount", 0.0)
                } else {
                    item.optDouble("total", 0.0)
                }
                resolvedItems.add(NativeLineItem(desc, qtyLabel, unitPriceLabel, amt))
            }
        } else if (boundRecords.isNotEmpty()) {
            for (rec in boundRecords) {
                val hrs = rec.optDouble("hours", 0.0)
                val hasRate = rec.has("hourly_rate") && !rec.isNull("hourly_rate") &&
                    rec.optDouble("hourly_rate", Double.NaN).isFinite()
                val rate = if (hasRate) rec.optDouble("hourly_rate", 0.0) else null
                val rawWorkAmt = if (rate != null) {
                    Math.round(hrs * rate * 100.0) / 100.0
                } else {
                    rec.optDouble("accounting_amount", 0.0)
                }
                val workAmt = if (isStorno) -abs(rawWorkAmt) else rawWorkAmt
                resolvedItems.add(
                    NativeLineItem(
                        description = rec.optString("title", "Gartenarbeit").ifBlank { "Gartenarbeit" },
                        quantityLabel = "${fmtQty(hrs)} Std",
                        unitPriceLabel = if (rate != null) fmtEuro(rate) else "Pauschal",
                        amount = workAmt
                    )
                )
                val mats = rec.optJSONArray("materials")
                if (mats != null) {
                    for (mIdx in 0 until mats.length()) {
                        val mat = mats.optJSONObject(mIdx) ?: continue
                        val mQty = mat.optDouble("quantity", 1.0)
                        val mUnit = mat.optString("unit", "Stück").ifBlank { "Stück" }
                        val hasPpu = mat.has("price_per_unit") && !mat.isNull("price_per_unit") &&
                            mat.optDouble("price_per_unit", Double.NaN).isFinite()
                        val ppu = if (hasPpu) mat.optDouble("price_per_unit", 0.0) else null
                        val hasTot = mat.has("total") && !mat.isNull("total") &&
                            mat.optDouble("total", Double.NaN).isFinite()
                        val rawMatTot = when {
                            hasTot -> mat.optDouble("total", 0.0)
                            ppu != null -> Math.round(mQty * ppu * 100.0) / 100.0
                            else -> 0.0
                        }
                        val matTot = if (isStorno) -abs(rawMatTot) else rawMatTot
                        resolvedItems.add(
                            NativeLineItem(
                                description = mat.optString("name", "Material").ifBlank { "Material" },
                                quantityLabel = "${fmtQty(mQty)} $mUnit",
                                unitPriceLabel = if (ppu != null) fmtEuro(ppu) else "inkl.",
                                amount = matTot
                            )
                        )
                    }
                }
            }
        }

        val totalAmount = if (invoice.has("total_amount") && !invoice.isNull("total_amount")) {
            invoice.optDouble("total_amount", 0.0)
        } else if (invoice.has("total_gross") && !invoice.isNull("total_gross")) {
            invoice.optDouble("total_gross", 0.0)
        } else {
            resolvedItems.sumOf { it.amount }
        }

        if (resolvedItems.isEmpty()) {
            resolvedItems.add(
                NativeLineItem(
                    description = if (isStorno) "Storno (${invoice.optString("storno_reason", "Korrektur")})" else "Gartenpflege",
                    quantityLabel = "1,00 Psch",
                    unitPriceLabel = fmtEuro(totalAmount),
                    amount = totalAmount
                )
            )
        }

        val salutationLine = detectSalutationLine(custName, customer?.optString("company", "").orEmpty())
        val resolvedSubjectText = invoice.optString("subject_text", "").trim().ifEmpty {
            when {
                isStorno -> "Stornorechnung Nr. $invNum"
                isPauschal -> "Pauschalrechnung Nr. $invNum"
                else -> "Rechnungs Nr. $invNum"
            }
        }
        val defaultIntroBody = if (isPauschal) {
            "vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!\nVereinbarungsgemäß stelle ich Ihnen für die durchgeführten Arbeiten folgende Pauschale in Rechnung:"
        } else {
            "vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen!\nHiermit stelle ich Ihnen die folgenden Leistungen in Rechnung:"
        }
        val resolvedIntroText = invoice.optString("intro_text", "").trim().ifEmpty {
            "$salutationLine\n$defaultIntroBody"
        }

        // A4 in Punkt (595 x 842 pt = 210 x 297 mm; 1 mm = 2.8346457 pt)
        fun mm(v: Float): Float = v * 2.8346457f

        val paintRegular = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(20, 20, 20)
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        val paintBold = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(10, 10, 10)
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val paintFillGrey = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(230, 232, 235)
            style = Paint.Style.FILL
        }
        val paintMarkLine = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(45, 45, 45)
            strokeWidth = 1.4f
        }

        fun wrapTextLines(text: String, paint: Paint, maxWidthPt: Float): List<String> {
            val out = mutableListOf<String>()
            for (para in text.split(Regex("\\r?\\n"))) {
                val trimmed = para.trim()
                if (trimmed.isEmpty()) {
                    out.add("")
                    continue
                }
                val words = trimmed.split(Regex("\\s+"))
                var currentLine = ""
                for (word in words) {
                    val candidate = if (currentLine.isEmpty()) word else "$currentLine $word"
                    if (paint.measureText(candidate) <= maxWidthPt || currentLine.isEmpty()) {
                        currentLine = candidate
                    } else {
                        out.add(currentLine)
                        currentLine = word
                    }
                }
                if (currentLine.isNotEmpty()) {
                    out.add(currentLine)
                }
            }
            return if (out.isEmpty()) listOf("") else out
        }

        val logoBitmap = getOrLoadLogoBitmap(context)

        val pageBitmaps = mutableListOf<Bitmap>()
        var currentBitmap = Bitmap.createBitmap(595, 842, Bitmap.Config.ARGB_8888)
        var canvas = Canvas(currentBitmap).apply {
            drawColor(Color.WHITE)
        }
        pageBitmaps.add(currentBitmap)

        fun startNewPage() {
            currentBitmap = Bitmap.createBitmap(595, 842, Bitmap.Config.ARGB_8888)
            canvas = Canvas(currentBitmap).apply {
                drawColor(Color.WHITE)
            }
            pageBitmaps.add(currentBitmap)
        }

        if (logoBitmap != null && !logoBitmap.isRecycled) {
            val dstRect = RectF(mm(150f), mm(6f), mm(192f), mm(48f))
            canvas.drawBitmap(logoBitmap, null, dstRect, Paint(Paint.FILTER_BITMAP_FLAG))
        } else {
            paintBold.textSize = 14f
            paintBold.color = Color.rgb(34, 122, 59)
            canvas.drawText("HAFNER – GRÜNRAUM HANDWERK", mm(128f), mm(36f), paintBold)
            paintBold.color = Color.rgb(10, 10, 10)
        }

        paintRegular.textSize = 7.2f
        paintRegular.color = Color.rgb(30, 30, 30)
        canvas.drawText(
            "Hafner Michael - Goethestrasse 2 - 9560 Feldkirchen in Kärnten",
            mm(20f),
            mm(49f),
            paintRegular
        )

        var addrY = 61f
        paintRegular.textSize = 10f
        paintRegular.color = Color.rgb(15, 15, 15)
        canvas.drawText(custName, mm(20f), mm(addrY), paintRegular)
        if (custStreet.isNotEmpty()) {
            addrY += 4.6f
            canvas.drawText(custStreet, mm(20f), mm(addrY), paintRegular)
        }
        val cityLine = listOf(custZip, custCity).filter { it.isNotEmpty() }.joinToString(" ")
        if (cityLine.isNotEmpty()) {
            addrY += 4.6f
            canvas.drawText(cityLine, mm(20f), mm(addrY), paintRegular)
        }
        if (custStreet.isNotEmpty() || cityLine.isNotEmpty()) {
            addrY += 4.6f
            canvas.drawText("Österreich", mm(20f), mm(addrY), paintRegular)
        }

        val metaLeftX = mm(128f)
        val metaRightX = mm(192f)
        fun drawRightAligned(text: String, xRightPt: Float, yPt: Float, paint: Paint) {
            val w = paint.measureText(text)
            canvas.drawText(text, xRightPt - w, yPt, paint)
        }

        paintRegular.textSize = 12f
        paintRegular.color = Color.rgb(15, 15, 15)
        canvas.drawText("Rechnungs-Nr.", metaLeftX, mm(56.5f), paintRegular)
        drawRightAligned(invNum, metaRightX, mm(56.5f), paintRegular)

        paintRegular.textSize = 8.2f
        paintRegular.color = Color.rgb(35, 35, 35)
        canvas.drawText("Rechnungsdatum", metaLeftX, mm(61.5f), paintRegular)
        drawRightAligned(invDate, metaRightX, mm(61.5f), paintRegular)

        canvas.drawText("Leistungszeitraum", metaLeftX, mm(65.5f), paintRegular)
        drawRightAligned(periodDisplay, metaRightX, mm(65.5f), paintRegular)

        canvas.drawText("Ihre Kundennummer", metaLeftX, mm(73f), paintRegular)
        drawRightAligned(custNum, metaRightX, mm(73f), paintRegular)

        canvas.drawText("Ihr Ansprechpartner", metaLeftX, mm(77f), paintRegular)
        drawRightAligned("Michael Hafner", metaRightX, mm(77f), paintRegular)

        val contentLeftMm = 22f
        val contentRightMm = 192f
        val tableWidthMm = contentRightMm - contentLeftMm
        val contentLeftPt = mm(contentLeftMm)
        val contentRightPt = mm(contentRightMm)
        val tableWidthPt = mm(tableWidthMm)

        var yMm = 97f
        paintBold.textSize = 12.5f
        paintBold.color = Color.rgb(10, 10, 10)
        canvas.drawText(resolvedSubjectText, contentLeftPt, mm(yMm), paintBold)

        yMm = 109f
        paintRegular.textSize = 9.5f
        paintRegular.color = Color.rgb(20, 20, 20)
        if (isStorno) {
            canvas.drawText(salutationLine, contentLeftPt, mm(yMm), paintRegular)
            yMm += 7.5f
            val stornoReason = invoice.optString("storno_reason", "Korrektur").ifBlank { "Korrektur" }
            canvas.drawText(
                "hiermit stornieren wir die betreffende Abrechnung ($stornoReason):",
                contentLeftPt,
                mm(yMm),
                paintRegular
            )
            yMm += 7f
        } else {
            val paragraphs = resolvedIntroText.split(Regex("\\r?\\n"))
            for ((pIdx, rawPara) in paragraphs.withIndex()) {
                val line = rawPara.trim()
                if (line.isEmpty()) {
                    yMm += 3f
                    continue
                }
                val wrapped = wrapTextLines(line, paintRegular, tableWidthPt)
                for (wLine in wrapped) {
                    canvas.drawText(wLine, contentLeftPt, mm(yMm), paintRegular)
                    yMm += 4.5f
                }
                yMm += if (pIdx == 0 && line.endsWith(",")) 2.5f else 0.5f
            }
            yMm += 3f
        }

        val colPosPt = mm(contentLeftMm + 1.5f)
        val colDescPt = mm(contentLeftMm + 11f)
        val colMengeRightPt = mm(contentLeftMm + 113f)
        val colUnitRightPt = mm(contentLeftMm + 140f)
        val colTotalRightPt = mm(contentRightMm - 1.5f)

        canvas.drawRect(contentLeftPt, mm(yMm), contentRightPt, mm(yMm + 6.8f), paintFillGrey)
        paintBold.textSize = 9f
        paintBold.color = Color.rgb(10, 10, 10)
        val headerBasePt = mm(yMm + 4.7f)
        canvas.drawText("Pos.", colPosPt, headerBasePt, paintBold)
        canvas.drawText("Beschreibung", colDescPt, headerBasePt, paintBold)
        drawRightAligned("Menge", colMengeRightPt, headerBasePt, paintBold)
        drawRightAligned("Einzelpreis", colUnitRightPt, headerBasePt, paintBold)
        drawRightAligned("Gesamtpreis", colTotalRightPt, headerBasePt, paintBold)
        yMm += 8.5f

        paintBold.textSize = 9.5f
        paintRegular.textSize = 9.5f
        for ((idx, item) in resolvedItems.withIndex()) {
            val descLines = wrapTextLines(item.description, paintBold, mm(75f))
            val rowHMm = max(8.5f, descLines.size * 4.5f + 4f)
            if (yMm + rowHMm > 230f) {
                startNewPage()
                yMm = 25f
            }
            val rowBaseMm = yMm + 4.2f
            canvas.drawText("${idx + 1}.", colPosPt, mm(rowBaseMm), paintRegular)
            for ((dIdx, dLine) in descLines.withIndex()) {
                canvas.drawText(dLine, colDescPt, mm(rowBaseMm + dIdx * 4.5f), paintBold)
            }
            drawRightAligned(item.quantityLabel, colMengeRightPt, mm(rowBaseMm), paintRegular)
            drawRightAligned(item.unitPriceLabel, colUnitRightPt, mm(rowBaseMm), paintRegular)
            drawRightAligned(fmtEuro(item.amount), colTotalRightPt, mm(rowBaseMm), paintRegular)
            yMm += rowHMm
        }

        yMm += 2f
        if (yMm + 52f > 258f) {
            startNewPage()
            yMm = 25f
        }

        canvas.drawRect(contentLeftPt, mm(yMm), contentRightPt, mm(yMm + 6.5f), paintFillGrey)
        paintRegular.textSize = 9.5f
        canvas.drawText("Gesamtbetrag netto", colDescPt, mm(yMm + 4.5f), paintRegular)
        drawRightAligned(fmtEuro(totalAmount), colTotalRightPt, mm(yMm + 4.5f), paintRegular)
        yMm += 6.5f

        paintRegular.textSize = 9f
        canvas.drawText(
            "Der Rechnungsbetrag enthält gem. §6 Abs. 1 Z 27 UStG 1994 keine Umsatzsteuer",
            colDescPt,
            mm(yMm + 4.6f),
            paintRegular
        )
        yMm += 6.8f

        canvas.drawRect(contentLeftPt, mm(yMm), contentRightPt, mm(yMm + 6.8f), paintFillGrey)
        paintBold.textSize = 9.5f
        canvas.drawText("Gesamtbetrag brutto", colDescPt, mm(yMm + 4.7f), paintBold)
        drawRightAligned(fmtEuro(totalAmount), colTotalRightPt, mm(yMm + 4.7f), paintBold)

        yMm += 14f
        paintRegular.textSize = 9.2f
        paintRegular.color = Color.rgb(20, 20, 20)
        if (!isStorno) {
            if (paidInCash) {
                val cashTerms = invoice.optString("payment_terms_text", "").trim()
                    .ifEmpty { "Zahlungsbedingungen: Rechnungsbetrag dankend bar erhalten." }
                for (line in wrapTextLines(cashTerms, paintRegular, tableWidthPt)) {
                    canvas.drawText(line, contentLeftPt, mm(yMm), paintRegular)
                    yMm += 4.5f
                }
                yMm += 4f
            } else {
                val terms = invoice.optString("payment_terms_text", "").trim()
                    .ifEmpty { "Zahlungsbedingungen: Zahlung innerhalb von 14 Tagen ab Rechnungseingang ohne Abzüge." }
                for (line in wrapTextLines(terms, paintRegular, tableWidthPt)) {
                    canvas.drawText(line, contentLeftPt, mm(yMm), paintRegular)
                    yMm += 4.5f
                }
                yMm += 3f

                val customClosing = invoice.optString("closing_text", "").trim()
                if (customClosing.isNotEmpty()) {
                    for (line in wrapTextLines(customClosing, paintRegular, tableWidthPt)) {
                        canvas.drawText(line, contentLeftPt, mm(yMm), paintRegular)
                        yMm += 4.5f
                    }
                    yMm += 4f
                } else {
                    canvas.drawText(
                        "Bitte überweisen Sie den Rechnungsbetrag unter Angabe der Rechnungsnummer auf das unten angegebene",
                        contentLeftPt,
                        mm(yMm),
                        paintRegular
                    )
                    yMm += 4.3f
                    canvas.drawText("Konto.", contentLeftPt, mm(yMm), paintRegular)
                    yMm += 4.5f
                    canvas.drawText("Der Rechnungsbetrag ist bis zum $dueDate fällig.", contentLeftPt, mm(yMm), paintRegular)
                    yMm += 8.5f
                }
            }
        } else {
            yMm += 4f
        }

        canvas.drawText("Mit freundlichen Grüßen", contentLeftPt, mm(yMm), paintRegular)
        yMm += 4.5f
        canvas.drawText("Michael Hafner", contentLeftPt, mm(yMm), paintRegular)

        val pdfDoc = PdfDocument()
        val totalPages = pageBitmaps.size
        for ((pIdx, bmp) in pageBitmaps.withIndex()) {
            val pageCanvas = Canvas(bmp)
            pageCanvas.drawLine(0f, mm(105f), mm(4f), mm(105f), paintMarkLine)
            pageCanvas.drawLine(0f, mm(148.5f), mm(6.5f), mm(148.5f), paintMarkLine)
            pageCanvas.drawLine(0f, mm(210f), mm(4f), mm(210f), paintMarkLine)

            paintRegular.textSize = 8f
            paintRegular.color = Color.rgb(35, 35, 35)
            val pageLabel = "${pIdx + 1}/$totalPages"
            pageCanvas.drawText(
                pageLabel,
                mm(192f) - paintRegular.measureText(pageLabel),
                mm(267f),
                paintRegular
            )

            val fy = 275f
            val lh = 3.5f
            paintRegular.textSize = 7.2f
            paintRegular.color = Color.rgb(40, 40, 40)

            pageCanvas.drawText("Hafner Michael", mm(20f), mm(fy), paintRegular)
            pageCanvas.drawText("Goethestrasse 2", mm(20f), mm(fy + lh), paintRegular)
            pageCanvas.drawText("9560 Feldkirchen in Kärnten", mm(20f), mm(fy + lh * 2), paintRegular)
            pageCanvas.drawText("Österreich", mm(20f), mm(fy + lh * 3), paintRegular)

            pageCanvas.drawText("Tel. 06802376503", mm(63f), mm(fy), paintRegular)
            pageCanvas.drawText("E-Mail hafnerm@gmx.at", mm(63f), mm(fy + lh), paintRegular)

            pageCanvas.drawText("Amtsgericht Feldkirchen", mm(105f), mm(fy), paintRegular)
            pageCanvas.drawText("Steuer-Nr. 59 0640553", mm(105f), mm(fy + lh), paintRegular)
            pageCanvas.drawText("Inhaber/-in Michael Hafner", mm(105f), mm(fy + lh * 2), paintRegular)

            pageCanvas.drawText("Bank N26", mm(149f), mm(fy), paintRegular)
            pageCanvas.drawText("IBAN DE41100110012348393811", mm(149f), mm(fy + lh), paintRegular)
            pageCanvas.drawText("BIC NTSBDEB1XXX", mm(149f), mm(fy + lh * 2), paintRegular)

            val pageInfo = PdfDocument.PageInfo.Builder(595, 842, pIdx + 1).create()
            val pdfPage = pdfDoc.startPage(pageInfo)
            pdfPage.canvas.drawBitmap(bmp, 0f, 0f, null)
            pdfDoc.finishPage(pdfPage)
            bmp.recycle()
        }

        val out = ByteArrayOutputStream()
        pdfDoc.writeTo(out)
        pdfDoc.close()

        val pdfBytes = out.toByteArray()
        val base64Pdf = Base64.encodeToString(pdfBytes, Base64.NO_WRAP)
        val safeNum = invNum.trim().replace("/", "-").replace(Regex("[^a-zA-Z0-9_-]"), "_")
        val prefix = if (isStorno) "Storno" else "Rechnung"
        val datePrefix = issueDateIso.ifEmpty { "2026-01-01" }
        val filename = "${datePrefix}_${prefix}_${safeNum.ifEmpty { "Beleg" }}.pdf"
        val docTitle = if (isStorno) "Stornorechnung Nr. $invNum" else "Rechnungs Nr. $invNum"
        val subject = "$docTitle – Hafner Michael – Grünraum Handwerk"
        val bodyText = listOf(
            salutationLine,
            "",
            "vielen Dank für Ihren Auftrag und das damit verbundene Vertrauen! Anbei erhalten Sie die $docTitle vom $invDate als PDF-Dokument.",
            "",
            "Leistungszeitraum: $periodDisplay",
            "Gesamtbetrag brutto: ${fmtEuro(totalAmount)}",
            "Fällig bis zum: $dueDate (innerhalb von 14 Tagen ohne Abzüge)",
            "Bankverbindung: Bank N26 · IBAN DE41100110012348393811 · BIC NTSBDEB1XXX",
            "",
            "Mit freundlichen Grüßen",
            "Michael Hafner",
            "Goethestrasse 2, 9560 Feldkirchen in Kärnten",
            "Tel. 06802376503"
        ).joinToString("\n")

        val resultObj = JSONObject()
            .put("ok", true)
            .put("engine", "native_android_pdf")
            .apply {
                if (!fallbackNote.isNullOrBlank()) {
                    put("engineNote", fallbackNote)
                }
            }
            .put("base64Pdf", base64Pdf)
            .put("pdfSizeBytes", pdfBytes.size)
            .put("filename", filename)
            .put("subject", subject)
            .put("bodyText", bodyText)
            .put("recipientEmail", recipientEmail)
            .put("recipientPhone", recipientPhone)
            .put("recipientName", custName)
            .put("totalAmount", totalAmount)

        cachedPdfEntry = CachedPdfEntry(
            cacheKey = cacheKey,
            createdAtMs = System.currentTimeMillis(),
            payloadJson = resultObj.toString()
        )
        return resultObj
    }

    private val FEMALE_NAMES = setOf(
        "andrea", "angelika", "anita", "anja", "anna", "annemarie", "astrid", "barbara", "beate",
        "bettina", "bianca", "birgit", "brigitte", "carina", "carmen", "christa", "christina",
        "christine", "claudia", "cornelia", "dagmar", "daniela", "doris", "edith", "elfriede",
        "elisabeth", "elke", "erika", "eva", "franziska", "gabriele", "gerda", "gertrude",
        "gisela", "gudrun", "hanna", "hannah", "heidi", "heike", "helga", "herta", "hildegard",
        "ilse", "ines", "ingeborg", "ingrid", "irene", "iris", "irmgard", "isabella", "jasmin",
        "johanna", "julia", "jutta", "karin", "katharina", "kathrin", "katrin", "kerstin",
        "klara", "kornelia", "lara", "laura", "lea", "lena", "lisa", "luise", "magdalena",
        "manuela", "margarete", "margit", "maria", "marianne", "marie", "marina", "marion",
        "marlies", "martina", "melanie", "michaela", "monika", "nadine", "natalie", "nicole",
        "nina", "patricia", "petra", "regina", "renate", "rita", "rosemarie", "ruth", "sabine",
        "sabrina", "sandra", "sarah", "silke", "silvia", "simone", "sonja", "sophie", "stefanie",
        "susanne", "sylvia", "tamara", "tanja", "theresia", "ulrike", "ursula", "valentina",
        "vanessa", "vera", "verena", "veronika", "viktoria", "waltraud", "yvonne"
    )

    private val MALE_NAMES = setOf(
        "alexander", "alfred", "alois", "andreas", "anton", "armin", "arnold", "bernd",
        "bernhard", "christian", "christoph", "clemens", "daniel", "david", "dieter", "dietmar",
        "dominik", "eduard", "emil", "erich", "ernst", "erwin", "fabian", "felix", "ferdinand",
        "florian", "franz", "friedrich", "fritz", "georg", "gerald", "gerd", "gerhard", "gernot",
        "gregor", "gunter", "günther", "günter", "gustav", "hannes", "hans", "harald", "heinrich",
        "heinz", "helmut", "herbert", "hermann", "herwig", "horst", "hubert", "jakob", "jan",
        "johann", "johannes", "jonas", "jörg", "josef", "julian", "jürgen", "karl", "klaus",
        "konrad", "kurt", "leo", "leon", "leonhard", "leopold", "lorenz", "ludwig", "lukas",
        "manfred", "manuel", "marc", "marcel", "marco", "mario", "markus", "martin", "mathias",
        "matthias", "max", "maximilian", "michael", "mihal", "mihael", "nikolaus", "norbert",
        "oliver", "oskar", "otmar", "otto", "patrick", "paul", "peter", "philipp", "raimund",
        "rainer", "reinhard", "reinhold", "rene", "richard", "robert", "roland", "roman",
        "rudolf", "sebastian", "sepp", "siegfried", "simon", "stefan", "stephan", "thomas",
        "tobias", "ulrich", "valentin", "viktor", "walter", "werner", "wilfried", "wilhelm",
        "wolfgang"
    )
}
