package at.hafner.gruenraum.calendar

import android.content.ContentUris
import android.content.Context
import android.provider.CalendarContract
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

class NativeCalendarReader(private val context: Context) {

    private val dateFormatter = DateTimeFormatter.ISO_LOCAL_DATE
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")

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
