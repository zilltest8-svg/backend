import 'dart:convert';

import 'package:chronos/core/compute.dart';
import 'package:chronos/core/export.dart';
import 'package:chronos/core/history.dart';
import 'package:chronos/core/history_pdf.dart';
import 'package:chronos/core/time.dart';
import 'package:chronos/core/types.dart';
import 'package:flutter_test/flutter_test.dart';

/// An IST wall-clock instant on 7 Aug 2026, as UTC ms.
int at(int hour, int minute, {int day = 7}) => parseISO('2026-08-${p2(day)}T${p2(hour)}:${p2(minute)}:00')!;

void main() {
  group('time', () {
    test('a missing offset is read as IST', () {
      expect(parseISO('2026-08-07T09:47:00'), DateTime.utc(2026, 8, 7, 4, 17).millisecondsSinceEpoch);
      expect(parseISO('2026-08-07T04:17:00Z'), parseISO('2026-08-07T09:47:00+05:30'));
      expect(parseISO('not a date'), isNull);
    });

    test('formats in IST on a 12-hour clock', () {
      final t = at(15, 0) + 7000;
      expect(clockTime(at(9, 47)), '09:47 AM');
      expect(clockShort(at(0, 5)), '12:05 AM');
      expect(clockWithSeconds(t), '03:00:07 PM');
      expect(dateDMY(t), '07/08/2026');
      expect(dateLabel(t), '07 Aug 2026');
      expect(weekday(t), 'Friday');
      expect(dayKey(at(23, 59)), '2026-08-07');
      expect(startOfDayKey('2026-08-07'), startOfDay(t));
    });

    test('durations', () {
      expect(hm(452 * kMin), '7:32');
      expect(hm(-5 * kMin), '-0:05');
      expect(hms(452 * kMin + 9000), '7:32:09');
      expect(hoursMinutes(480 * kMin), '8h 00m');
      expect(human(86 * kMin), '1h 26m');
      expect(minutesFromInput('09:30'), 570);
      expect(minutesFromInput('24:00'), isNull);
    });
  });

  group('computeDay', () {
    const settings = Settings();

    test('every break minute pushes the exit', () {
      final day = computeDay(
        [Session(id: 'a', inAt: at(9, 0), out: at(13, 0)), Session(id: 'b', inAt: at(13, 45), out: null)],
        settings,
        at(15, 0),
      );

      expect(day.status, DayStatus.working);
      expect(day.worked, (4 * 60 + 75) * kMin);
      expect(day.breakMs, 45 * kMin);
      expect(day.leave, at(17, 45));
      expect(day.office, day.elapsed - day.breakMs);
      expect(day.blocks.map((b) => b.kind), [BlockKind.work, BlockKind.breakTime, BlockKind.work]);
      expect(day.reached, isFalse);
    });

    test('free minutes are forgiven', () {
      final day = computeDay(
        [Session(id: 'a', inAt: at(9, 0), out: at(13, 0)), Session(id: 'b', inAt: at(13, 45), out: null)],
        const Settings(free: 30),
        at(15, 0),
      );
      expect(day.billableBreak, 15 * kMin);
      expect(day.leave, at(17, 15));
    });

    test('punched out today is a live break', () {
      final day = computeDay([Session(id: 'a', inAt: at(9, 0), out: at(13, 0))], settings, at(13, 20));
      expect(day.status, DayStatus.onBreak);
      expect(day.liveBreak, 20 * kMin);
    });

    test('a closed earlier day freezes at its last punch', () {
      final day = computeDay([Session(id: 'a', inAt: at(9, 0), out: at(18, 0))], settings, at(11, 0, day: 9));
      expect(day.stale, isTrue);
      expect(day.now, at(18, 0));
      expect(day.status, DayStatus.out);
      expect(day.breakMs, 0);
    });

    test('overlapping punches are never counted twice', () {
      final day = computeDay(
        [Session(id: 'a', inAt: at(9, 0), out: at(12, 0)), Session(id: 'b', inAt: at(11, 0), out: at(13, 0))],
        settings,
        at(13, 0),
      );
      expect(day.worked, 4 * 60 * kMin);
    });
  });

  group('payload', () {
    final response = jsonEncode({
      'status': 'working',
      'target_minutes': 450,
      'sessions_today': [
        {'id': 1, 'punch_in': '2026-08-07T09:00:00+05:30', 'punch_out': '2026-08-07T13:00:00+05:30'},
        {'id': 2, 'punch_in': '2026-08-07T13:45:00+05:30', 'punch_out': null},
        {'id': 3, 'punch_in': null},
      ],
      'current_session': {'id': 2, 'punch_in': '2026-08-07T13:45:00+05:30'},
    });

    test('reads a whole-day response', () {
      final parsed = parsePayload(response);
      expect(parsed.full, isTrue);
      expect(parsed.added, 2);
      expect(parsed.skipped, 1);
      expect(parsed.target, 450);
      expect(parsed.sessions.first.id, '1');
    });

    test('reports what is wrong in words', () {
      expect(() => parsePayload('{'), throwsFormatException);
      expect(() => parsePayload('{"a":1}'), throwsFormatException);
    });

    test('merge identifies a punch by when it started', () {
      final merged = mergeSessions(
        [Session(id: 'm1', inAt: at(9, 0), out: null)],
        [Session(id: '1', inAt: at(9, 0), out: at(13, 0))],
      );
      expect(merged, hasLength(1));
      expect(merged.single.out, at(13, 0));
    });

    test('replaceDay leaves the other days alone', () {
      final kept = Session(id: 'x', inAt: at(9, 0, day: 6), out: at(17, 0, day: 6));
      final next = replaceDay(
        [kept, Session(id: 'old', inAt: at(8, 0), out: at(9, 0))],
        [Session(id: 'new', inAt: at(10, 0), out: null)],
      );
      expect(next.map((s) => s.id), ['x', 'new']);
    });
  });

  group('history and export', () {
    final sessions = [
      Session(id: 'a', inAt: at(9, 0, day: 6), out: at(18, 0, day: 6)),
      Session(id: 'b', inAt: at(9, 0), out: at(13, 0)),
      Session(id: 'c', inAt: at(14, 0), out: at(18, 0)),
    ];
    // Read the morning after: the same evening, a punched-out day is still on a
    // live break, which would be a fourth row.
    final days = buildHistory(sessions, const Settings(), const {}, at(10, 0, day: 8));

    test('days come newest first and the filter picks one', () {
      expect(days.map((d) => d.key), ['2026-08-07', '2026-08-06']);
      expect(resolveDay(days, const Filter())?.key, '2026-08-07');
      expect(resolveDay(days, const Filter(day: '2026-08-06'))?.key, '2026-08-06');
      expect(totalsOf(days).worked, 17 * 60 * kMin);
    });

    test('one CSV row per session and break', () {
      final rows = toRows(days.first.result);
      expect(rows.map((r) => r[2]), ['Work', 'Break', 'Work']);
      expect(rows.first.sublist(0, 7), ['07/08/2026', 'Fri', 'Work', '1', '09:00 AM', '01:00 PM', '4:00']);
      expect(toCSV(days.first.result).split('\n'), hasLength(4));
    });

    test('the PDF is a well-formed single page', () {
      final bytes = historyPdf(days, totalsOf(days), ReportMeta(scope: 'All stored days', at: at(20, 0)));
      final text = latin1.decode(bytes);
      expect(text, startsWith('%PDF-1.4'));
      expect(text, endsWith('%%EOF'));
      expect(text, contains('/Count 1 '));
      // The xref offset in the trailer must point at the xref table.
      final xref = int.parse(RegExp(r'startxref\n(\d+)').firstMatch(text)!.group(1)!);
      expect(text.substring(xref, xref + 4), 'xref');
    });
  });
}
