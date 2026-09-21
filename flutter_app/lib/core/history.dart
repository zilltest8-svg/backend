/// Stored punches are one flat list spanning every day that was ever loaded.
/// This module is what turns that list into days and months: the calculator only
/// ever looks at one day at a time, so a day has to be picked out before
/// `computeDay` sees it — otherwise the gap between Monday evening and Tuesday
/// morning would be counted as a break.
library;

import 'compute.dart';
import 'time.dart';
import 'types.dart';

class DayEntry {
  const DayEntry({
    required this.key,
    required this.month,
    required this.at,
    required this.sessions,
    required this.result,
    required this.savedAt,
    required this.submittedAt,
  });

  /// `2026-08-07`
  final String key;

  /// `2026-08`
  final String month;

  /// Midnight IST of the day, as UTC ms — sorts the entry and labels it.
  final int at;
  final List<Session> sessions;
  final DayResult result;

  /// When these punches were last written to storage; null for pre-history data.
  final int? savedAt;

  /// When the day was signed off in the day sheet; null while it is still in progress.
  final int? submittedAt;
}

class MonthEntry {
  MonthEntry({required this.key, required this.at, required this.days});

  final String key;
  final int at;
  int days;
}

/// Split the flat list into days, each already sorted by punch-in.
Map<String, List<Session>> groupByDay(List<Session> sessions) {
  final byDay = <String, List<Session>>{};
  for (final s in [...sessions]..sort((a, b) => a.inAt.compareTo(b.inAt))) {
    byDay.putIfAbsent(dayKey(s.inAt), () => []).add(s);
  }
  return byDay;
}

/// Every stored day, newest first, each with its own totals.
List<DayEntry> buildHistory(List<Session> sessions, Settings settings, DayMeta meta, int clock) {
  final days = <DayEntry>[];
  groupByDay(sessions).forEach((key, list) {
    final first = list.first;
    days.add(
      DayEntry(
        key: key,
        month: monthKey(first.inAt),
        at: startOfDay(first.inAt),
        sessions: list,
        result: computeDay(list, settings, clock),
        savedAt: meta[key]?.savedAt,
        submittedAt: meta[key]?.submittedAt,
      ),
    );
  });
  return days..sort((a, b) => b.at.compareTo(a.at));
}

/// The months those days fall in, newest first.
List<MonthEntry> monthsOf(List<DayEntry> days) {
  final months = <String, MonthEntry>{};
  for (final d in days) {
    final seen = months[d.month];
    if (seen != null) {
      seen.days += 1;
    } else {
      months[d.month] = MonthEntry(key: d.month, at: d.at, days: 1);
    }
  }
  return months.values.toList()..sort((a, b) => b.at.compareTo(a.at));
}

List<DayEntry> daysInMonth(List<DayEntry> days, String month) =>
    month == 'all' ? days : days.where((d) => d.month == month).toList();

/// Which day the calculator should show. An explicitly picked day always wins,
/// even if the month filter has since moved off it; otherwise it follows the
/// newest day in the filtered range, so today's punches stay live by default.
DayEntry? resolveDay(List<DayEntry> days, Filter filter) {
  if (filter.day != 'latest') {
    for (final d in days) {
      if (d.key == filter.day) return d;
    }
  }
  final inMonth = daysInMonth(days, filter.month);
  if (inMonth.isNotEmpty) return inMonth.first;
  return days.isEmpty ? null : days.first;
}

class Totals {
  const Totals({this.days = 0, this.worked = 0, this.breakMs = 0, this.office = 0});

  final int days;
  final int worked;
  final int breakMs;
  final int office;
}

/// Roll a set of days up into one line of numbers.
Totals totalsOf(List<DayEntry> days) {
  var worked = 0, breakMs = 0, office = 0;
  for (final d in days) {
    worked += d.result.worked;
    breakMs += d.result.breakMs;
    office += d.result.office;
  }
  return Totals(days: days.length, worked: worked, breakMs: breakMs, office: office);
}
