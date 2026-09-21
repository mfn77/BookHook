package tr.bookhook.app.util

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/**
 * Mirrors the web app's nowLogical()/todayStr() exactly: the "logical day" rolls over at
 * 06:00 local time, not midnight, so a member checking in at 2am still lands on "yesterday".
 * Keep this in sync with the nowLogical()/todayStr() functions in style.css's sibling, index.html.
 */
private val DATE_FORMAT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd")

fun logicalToday(now: LocalDateTime = LocalDateTime.now()): LocalDate {
    return if (now.hour < 6) now.toLocalDate().minusDays(1) else now.toLocalDate()
}

fun logicalTodayStr(now: LocalDateTime = LocalDateTime.now()): String {
    return logicalToday(now).format(DATE_FORMAT)
}
