/// Every time and date in this app is shown in India Standard Time (UTC+05:30),
/// on a 12-hour clock, regardless of what offset the API sends or what time zone
/// the machine is set to. Internally everything is absolute UTC milliseconds.
library;

const int kMin = 60000;
const int kIstOffset = 330; // minutes east of UTC
const int kDayMs = 24 * 60 * kMin;

const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const _days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const _daysFull = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

final _iso = RegExp(r'^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$');

int nowMs() => DateTime.now().millisecondsSinceEpoch;

/// Parse an ISO timestamp to UTC ms. A missing offset is read as IST.
int? parseISO(Object? value) {
  if (value == null) return null;
  final text = value.toString().trim();
  if (text.isEmpty) return null;
  final m = _iso.firstMatch(text);
  if (m == null) return DateTime.tryParse(text)?.millisecondsSinceEpoch;

  var offset = kIstOffset;
  final zone = m.group(7);
  if (zone != null) {
    if (zone == 'Z') {
      offset = 0;
    } else {
      final z = RegExp(r'([+-])(\d{2}):?(\d{2})').firstMatch(zone);
      if (z != null) {
        offset = (z.group(1) == '-' ? -1 : 1) * (int.parse(z.group(2)!) * 60 + int.parse(z.group(3)!));
      }
    }
  }
  return DateTime.utc(
        int.parse(m.group(1)!),
        int.parse(m.group(2)!),
        int.parse(m.group(3)!),
        int.parse(m.group(4)!),
        int.parse(m.group(5)!),
        int.parse(m.group(6) ?? '0'),
      ).millisecondsSinceEpoch -
      offset * kMin;
}

/// Shift into IST so the UTC accessors read as Indian wall-clock time.
DateTime ist(int t) => DateTime.fromMillisecondsSinceEpoch(t + kIstOffset * kMin, isUtc: true);

String p2(int n) => n < 10 ? '0$n' : '$n';
int _h12(DateTime d) => d.hour % 12 == 0 ? 12 : d.hour % 12;
String _mer(DateTime d) => d.hour >= 12 ? 'PM' : 'AM';
int _dow(DateTime d) => d.weekday % 7; // Sunday = 0, as the labels are ordered

/// `09:47 AM`
String clockTime(int? t) {
  if (t == null) return '--:--';
  final d = ist(t);
  return '${p2(_h12(d))}:${p2(d.minute)} ${_mer(d)}';
}

/// `9:47 AM` — no leading zero, for headline use.
String clockShort(int? t) {
  if (t == null) return '--:--';
  final d = ist(t);
  return '${_h12(d)}:${p2(d.minute)} ${_mer(d)}';
}

/// `03:00:07 PM`
String clockWithSeconds(int t) {
  final d = ist(t);
  return '${p2(_h12(d))}:${p2(d.minute)}:${p2(d.second)} ${_mer(d)}';
}

/// `17:30` — 24-hour, for the ETA tile.
String clock24(int t) {
  final d = ist(t);
  return '${p2(d.hour)}:${p2(d.minute)}';
}

/// `07/08/2026` — Indian day-first date format.
String dateDMY(int t) {
  final d = ist(t);
  return '${p2(d.day)}/${p2(d.month)}/${d.year}';
}

/// `Fri`
String shortDay(int t) => _days[_dow(ist(t))];

/// `FRIDAY` once upper-cased by the caller.
String weekday(int t) => _daysFull[_dow(ist(t))];

/// `06 Aug 2026`
String dateLabel(int t) {
  final d = ist(t);
  return '${p2(d.day)} ${_months[d.month - 1]} ${d.year}';
}

String dayKey(int t) {
  final d = ist(t);
  return '${d.year}-${p2(d.month)}-${p2(d.day)}';
}

/// `2026-08` — the key a stored day is filed and filtered under.
String monthKey(int t) {
  final d = ist(t);
  return '${d.year}-${p2(d.month)}';
}

/// `Aug 2026`
String monthLabel(int t) {
  final d = ist(t);
  return '${_months[d.month - 1]} ${d.year}';
}

/// `Aug 2026` from a stored `2026-08` key, for a month with no days left in it.
String monthLabelFromKey(String key) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(key);
  if (m == null) return key;
  final index = int.parse(m.group(2)!) - 1;
  if (index < 0 || index > 11) return key;
  return '${_months[index]} ${m.group(1)}';
}

/// `07 Aug` — day and month only, for dense history rows.
String dayMonth(int t) {
  final d = ist(t);
  return '${p2(d.day)} ${_months[d.month - 1]}';
}

/// Midnight IST of the day containing `t`, as UTC ms.
int startOfDay(int t) {
  final d = ist(t);
  return DateTime.utc(d.year, d.month, d.day).millisecondsSinceEpoch - kIstOffset * kMin;
}

int startOfToday() => startOfDay(nowMs());

/// Midnight IST of a `YYYY-MM-DD` key.
int? startOfDayKey(String key) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(key.trim());
  if (m == null) return null;
  return DateTime.utc(int.parse(m.group(1)!), int.parse(m.group(2)!), int.parse(m.group(3)!)).millisecondsSinceEpoch -
      kIstOffset * kMin;
}

/// `7:32`
String hm(num ms) {
  final neg = ms < 0;
  final total = ms.abs() ~/ kMin;
  return '${neg ? '-' : ''}${total ~/ 60}:${p2(total % 60)}';
}

/// `7:32:09`
String hms(num ms) {
  final s = ms.abs() ~/ 1000;
  return '${s ~/ 3600}:${p2((s ~/ 60) % 60)}:${p2(s % 60)}';
}

/// Split for per-place animation: `["7", "32", "09"]`
List<String> hmsParts(num ms) {
  final s = ms.abs() ~/ 1000;
  return ['${s ~/ 3600}', p2((s ~/ 60) % 60), p2(s % 60)];
}

/// `8h 00m` — padded, for the goal headline.
String hoursMinutes(num ms) {
  final total = (ms.abs() / kMin).round();
  return '${total ~/ 60}h ${p2(total % 60)}m';
}

/// `1h 26m`
String human(num ms) {
  final total = (ms.abs() / kMin).round();
  final h = total ~/ 60;
  return '${h > 0 ? '${h}h ' : ''}${total % 60}m';
}

/// Current IST wall-clock as `"14:05"`.
String inputTimeNow() => clock24(nowMs());

/// "09:30" to minutes past midnight.
int? minutesFromInput(String value) {
  final m = RegExp(r'^(\d{1,2}):(\d{2})$').firstMatch(value.trim());
  if (m == null) return null;
  final h = int.parse(m.group(1)!);
  final mi = int.parse(m.group(2)!);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}
