import 'time.dart';
import 'types.dart';

/// One row per work session and per break, in the order they happened. The
/// day totals repeat on every row so the sheet can be filtered or pivoted
/// without needing a separate summary block.
const sheetHeaders = [
  'Date',
  'Day',
  'Type',
  'No.',
  'Punch In',
  'Punch Out',
  'Duration',
  'Minutes',
  'Total Work',
  'Total Break',
  'Time In Office',
  'Can Leave At',
];

/// The day as rows of plain strings, ready for a spreadsheet.
List<List<String>> toRows(DayResult day) {
  final first = day.first;
  if (first == null) return const [];

  final date = dateDMY(first);
  final dayName = shortDay(first);
  final totalWork = hm(day.worked);
  final totalBreak = hm(day.breakMs);
  final inOffice = hm(day.office);
  final leave = day.leave == null ? '' : clockShort(day.leave);

  var work = 0;
  var brk = 0;

  return [
    for (final b in day.blocks)
      [
        date,
        dayName,
        b.isWork ? 'Work' : 'Break',
        '${b.isWork ? work += 1 : brk += 1}',
        clockTime(b.from),
        b.live ? 'Running' : clockTime(b.to),
        hm(b.to - b.from),
        '${((b.to - b.from) / kMin).round()}',
        totalWork,
        totalBreak,
        inOffice,
        leave,
      ],
  ];
}

String _escapeCsv(String v) => RegExp(r'[",\n]').hasMatch(v) ? '"${v.replaceAll('"', '""')}"' : v;

String toCSV(DayResult day, {bool withHeaders = true}) {
  final rows = toRows(day).map((r) => r.map(_escapeCsv).join(','));
  return [if (withHeaders) sheetHeaders.join(','), ...rows].join('\n');
}

String csvFilename(DayResult day) {
  final stamp = day.first == null ? 'day' : dateDMY(day.first!).replaceAll('/', '-');
  return 'office-time-$stamp.csv';
}
