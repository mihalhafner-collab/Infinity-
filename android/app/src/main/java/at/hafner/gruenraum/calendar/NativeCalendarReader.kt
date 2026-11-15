package at.hafner.gruenraum.calendar

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.provider.CalendarContract
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.TimeZone

class NativeCalendarReader(private val context: Context) {

    private val dateFormatter = DateTimeFormatter.ISO_LOCAL_DATE
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

    private fun findWritableCalendarId(): Long? {
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.ACCOUNT_TYPE,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.VISIBLE
        )
        var bestId: Long? = null
        var bestScore = -1

        context.contentResolver.query(
            CalendarContract.Calendars.CONTENT_URI,
            projection,
            null,
            null,
            null
        )?.use { cursor ->
            val idxId = cursor.getColumnIndexOrThrow(CalendarContract.Calendars._ID)
            val idxType = cursor.getColumnIndexOrThrow(CalendarContract.Calendars.ACCOUNT_TYPE)
            val idxPrimary = cursor.getColumnIndexOrThrow(CalendarContract.Calendars.IS_PRIMARY)
            val idxAccess = cursor.getColumnIndexOrThrow(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL)
            val idxVisible = cursor.getColumnIndexOrThrow(CalendarContract.Calendars.VISIBLE)

            while (cursor.moveToNext()) {
                val access = if (!cursor.isNull(idxAccess)) cursor.getInt(idxAccess) else 0
                if (access < CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) continue

                val id = cursor.getLong(idxId)
                val acctType = cursor.getString(idxType) ?: ""
                val isPrimary = !cursor.isNull(idxPrimary) && cursor.getInt(idxPrimary) == 1
                val isVisible = !cursor.isNull(idxVisible) && cursor.getInt(idxVisible) == 1

                var score = 0
                if (acctType == "com.google") score += 10
                if (isPrimary) score += 5
                if (isVisible) score += 2

                if (score > bestScore) {
                    bestScore = score
                    bestId = id
                }
            }
        }
        return bestId
    }

    fun upsertEventJson(payloadJson: String): String {
        val obj = JSONObject(payloadJson)
        val existingEventId = obj.optString("googleEventId", "").trim().toLongOrNull()
        val title = obj.optString("title", "Termin").trim().ifEmpty { "Termin" }
        val dateIso = obj.optString("date", "").trim()
        val startTimeStr = obj.optString("start_time", "").trim()
        val endTimeStr = obj.optString("end_time", "").trim()
        val durationMin = obj.optInt("duration_minutes", 60).let { if (it > 0) it else 60 }
        val address = obj.optString("address", "").trim()
        val notes = obj.optString("notes", "").trim()

        val localDate = LocalDate.parse(dateIso, dateFormatter)
        val zone = ZoneId.systemDefault()
        val isAllDay = startTimeStr.isEmpty()

        val startMillis: Long
        val endMillis: Long
        val eventTz: String

        if (isAllDay) {
            startMillis = localDate.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            endMillis = localDate.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
            eventTz = "UTC"
        } else {
            val startLt = runCatching { LocalTime.parse(startTimeStr, timeFormatter) }
                .getOrDefault(LocalTime.of(8, 0))
            val endLt = if (endTimeStr.isNotEmpty()) {
                runCatching { LocalTime.parse(endTimeStr, timeFormatter) }
                    .getOrDefault(startLt.plusMinutes(durationMin.toLong()))
            } else {
                startLt.plusMinutes(durationMin.toLong())
            }
            val safeEndLt = if (endLt.isAfter(startLt)) endLt else startLt.plusMinutes(60)
            startMillis = localDate.atTime(startLt).atZone(zone).toInstant().toEpochMilli()
            endMillis = localDate.atTime(safeEndLt).atZone(zone).toInstant().toEpochMilli()
            eventTz = TimeZone.getDefault().id
        }

        val values = ContentValues().apply {
            put(CalendarContract.Events.TITLE, title)
            put(CalendarContract.Events.DTSTART, startMillis)
            put(CalendarContract.Events.DTEND, endMillis)
            put(CalendarContract.Events.ALL_DAY, if (isAllDay) 1 else 0)
            put(CalendarContract.Events.EVENT_TIMEZONE, eventTz)
            put(CalendarContract.Events.EVENT_LOCATION, address)
            put(CalendarContract.Events.DESCRIPTION, notes)
        }

        if (existingEventId != null && existingEventId > 0L) {
            val updateUri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, existingEventId)
            val updatedRows = runCatching {
                context.contentResolver.update(updateUri, values, null, null)
            }.getOrDefault(0)
            if (updatedRows > 0) {
                return JSONObject().apply {
                    put("googleEventId", existingEventId.toString())
                    put("updated", true)
                }.toString()
            }
        }

        val calId = findWritableCalendarId()
            ?: throw IllegalStateException("Kein beschreibbarer Google Kalender auf dem Pixel 10 Pro gefunden.")
        values.put(CalendarContract.Events.CALENDAR_ID, calId)

        val insertedUri = context.contentResolver.insert(CalendarContract.Events.CONTENT_URI, values)
            ?: throw IllegalStateException("Termin konnte nicht in den Google Kalender eingetragen werden.")
        val newId = ContentUris.parseId(insertedUri)
        return JSONObject().apply {
            put("googleEventId", newId.toString())
            put("created", true)
        }.toString()
    }

    fun deleteEvent(googleEventId: String): Boolean {
        val idLong = googleEventId.trim().toLongOrNull() ?: return false
        if (idLong <= 0L) return false
        val uri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, idLong)
        val deleted = runCatching {
            context.contentResolver.delete(uri, null, null)
        }.getOrDefault(0)
        return deleted > 0
    }

    fun queryEventsJson(startDateIso: String, endDateIso: String): String {
        val zone = ZoneId.systemDefault()
        val startDate = LocalDate.parse(startDateIso, dateFormatter)
        val endDate = LocalDate.parse(endDateIso, dateFormatter)

        val startMillis = startDate.atStartOfDay(zone).toInstant().toEpochMilli()
        val endMillis = endDate.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() - 1L

        val builder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(builder, startMillis)
        ContentUris.appendId(builder, endMillis)

        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.DESCRIPTION,
            CalendarContract.Instances.STATUS
        )

        val sortOrder = "${CalendarContract.Instances.BEGIN} ASC"
        val items = JSONArray()

        context.contentResolver.query(
            builder.build(),
            projection,
            null,
            null,
            sortOrder
        )?.use { cursor ->
            val idxEventId = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_ID)
            val idxTitle = cursor.getColumnIndexOrThrow(CalendarContract.Instances.TITLE)
            val idxBegin = cursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN)
            val idxEnd = cursor.getColumnIndexOrThrow(CalendarContract.Instances.END)
            val idxAllDay = cursor.getColumnIndexOrThrow(CalendarContract.Instances.ALL_DAY)
            val idxLocation = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_LOCATION)
            val idxDesc = cursor.getColumnIndexOrThrow(CalendarContract.Instances.DESCRIPTION)
            val idxStatus = cursor.getColumnIndexOrThrow(CalendarContract.Instances.STATUS)

            while (cursor.moveToNext()) {
                val status = if (!cursor.isNull(idxStatus)) cursor.getInt(idxStatus) else 0
                if (status == CalendarContract.Instances.STATUS_CANCELED) continue

                val eventId = cursor.getLong(idxEventId).toString()
                val title = cursor.getString(idxTitle)?.trim().takeUnless { it.isNullOrEmpty() }
                    ?: "Google Kalendertermin"
                val beginMs = cursor.getLong(idxBegin)
                val endMs = if (!cursor.isNull(idxEnd)) cursor.getLong(idxEnd) else beginMs
                val isAllDay = !cursor.isNull(idxAllDay) && cursor.getInt(idxAllDay) == 1
                val location = cursor.getString(idxLocation)?.trim().takeUnless { it.isNullOrEmpty() }
                val notes = cursor.getString(idxDesc)?.trim() ?: ""

                if (isAllDay) {
                    // Android CalendarContract stores all-day event boundaries in UTC midnight
                    var cursorDay = Instant.ofEpochMilli(beginMs).atZone(ZoneOffset.UTC).toLocalDate()
                    val exclusiveEnd = Instant.ofEpochMilli(endMs).atZone(ZoneOffset.UTC).toLocalDate()
                        .let { if (it.isAfter(cursorDay)) it else cursorDay.plusDays(1) }

                    var guard = 0
                    while (cursorDay.isBefore(exclusiveEnd) && guard < 31) {
                        if (!cursorDay.isBefore(startDate) && !cursorDay.isAfter(endDate)) {
                            val dayStr = cursorDay.format(dateFormatter)
                            items.put(
                                JSONObject().apply {
                                    put("id", "gcal-$eventId-$dayStr")
                                    put("googleEventId", eventId)
                                    put("title", title)
                                    put("date", dayStr)
                                    put("start_time", JSONObject.NULL)
                                    put("end_time", JSONObject.NULL)
                                    put("duration_minutes", JSONObject.NULL)
                                    put("is_all_day", true)
                                    put("address", location ?: JSONObject.NULL)
                                    put("notes", notes)
                                    put("htmlLink", JSONObject.NULL)
                                }
                            )
                        }
                        cursorDay = cursorDay.plusDays(1)
                        guard++
                    }
                } else {
                    val startZdt = Instant.ofEpochMilli(beginMs).atZone(zone)
                    val endZdt = Instant.ofEpochMilli(endMs).atZone(zone)
                    val dayStr = startZdt.toLocalDate().format(dateFormatter)
                    val startHHMM = startZdt.toLocalTime().format(timeFormatter)

                    val durationMin = ((endMs - beginMs) / 60000L).toInt()
                    val endHHMM: String? = if (endMs > beginMs) {
                        if (endZdt.toLocalDate() == startZdt.toLocalDate()) {
                            endZdt.toLocalTime().format(timeFormatter)
                        } else {
                            "23:59"
                        }
                    } else {
                        null
                    }

                    items.put(
                        JSONObject().apply {
                            put("id", "gcal-$eventId-$dayStr-$startHHMM")
                            put("googleEventId", eventId)
                            put("title", title)
                            put("date", dayStr)
                            put("start_time", startHHMM)
                            put("end_time", endHHMM ?: JSONObject.NULL)
                            put("duration_minutes", if (durationMin > 0) durationMin else JSONObject.NULL)
                            put("is_all_day", false)
                            put("address", location ?: JSONObject.NULL)
                            put("notes", notes)
                            put("htmlLink", JSONObject.NULL)
                        }
                    )
                }
            }
        }

        return items.toString()
    }
}
