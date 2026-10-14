import 'package:chronos/core/compute.dart';
import 'package:chronos/core/health_rule.dart';
import 'package:chronos/core/time.dart';
import 'package:chronos/core/types.dart';
import 'package:flutter_test/flutter_test.dart';

/// An IST wall-clock instant on 7 Aug 2026, as UTC ms.
int at(int hour, int minute, {int day = 7}) => parseISO('2026-08-${p2(day)}T${p2(hour)}:${p2(minute)}:00')!;

const settings = Settings(target: 480, free: 0, health: true);

Health run(List<Session> sessions, int clock, {Settings s = settings}) => assessHealth(computeDay(sessions, s, clock), s);

Session s(String id, int inAt, int? out) => Session(id: id, inAt: inAt, out: out);

void main() {
  test('constants match the policy', () {
    expect(kMinBreak, 15 * kMin);
    expect(kRemindAt, [120 * kMin, 180 * kMin, 240 * kMin]);
    expect(kAutoOut, 255 * kMin);
    expect(kRestAfterAutoOut, 30 * kMin);
  });

  test('empty day', () {
    final h = run([], at(9, 0));
    expect(h.stage, 0);
    expect(h.streak, 0);
    expect(h.working, isFalse);
    expect(h.required, 60 * kMin);
    expect(h.alert, isNull);
    expect(h.nextAt, isNull);
  });

  test('one hour in: no alert, next reminder at 11:00', () {
    final h = run([s('a', at(9, 0), null)], at(10, 0));
    expect(h.stage, 0);
    expect(h.streak, 60 * kMin);
    expect(h.working, isTrue);
    expect(h.nextAt, at(11, 0));
    expect(h.alert, isNull);
  });

  test('2h05 straight: the friendly reminder, with the reason', () {
    final h = run([s('a', at(9, 0), null)], at(11, 5));
    expect(h.stage, 1);
    expect(h.alert!.tone, HealthTone.info);
    expect(h.alert!.title, contains('2 hours'));
    expect(h.alert!.why, contains('since 9:00 AM'));
    expect(h.alert!.why, contains('2h 5m'));
    expect(h.alert!.why, contains('12:00 PM'));
    expect(h.nextAt, at(12, 0));
  });

  test('a 10-minute gap does not reset the timer', () {
    final h = run([s('a', at(9, 0), at(10, 30)), s('b', at(10, 40), null)], at(11, 10));
    expect(h.streak, 130 * kMin);
    expect(h.ignored, 1);
    expect(h.counted, 0);
    expect(h.stage, 1);
    expect(h.alert!.why, contains('1 short gap'));
  });

  test('a 20-minute break resets the timer and counts toward the hour', () {
    final h = run([s('a', at(9, 0), at(11, 0)), s('b', at(11, 20), null)], at(11, 30));
    expect(h.streak, 10 * kMin);
    expect(h.streakStart, at(11, 20));
    expect(h.counted, 20 * kMin);
    expect(h.longest, 120 * kMin);
    expect(h.stage, 0);
    expect(h.ignored, 0);
  });

  test('3h, 4h, 4h15 while still working', () {
    final list = [s('a', at(9, 0), null)];
    expect(run(list, at(12, 0)).stage, 2);
    expect(run(list, at(12, 0)).alert!.tone, HealthTone.warn);
    expect(run(list, at(13, 0)).stage, 3);
    expect(run(list, at(13, 0)).alert!.tone, HealthTone.strong);
    expect(run(list, at(13, 0)).alert!.why, contains('1:15 PM'));
    final h = run(list, at(13, 15));
    expect(h.stage, 4);
    expect(h.alert!.tone, HealthTone.stop);
    expect(h.autoOut, isFalse);
    expect(h.nextAt, isNull);
  });

  test('punched out at 4h15: auto punch-out, 30-minute rest owed', () {
    final h = run([s('a', at(9, 0), at(13, 15))], at(13, 20));
    expect(h.autoOut, isTrue);
    expect(h.restLeft, 25 * kMin);
    expect(h.stage, 4);
    expect(h.streak, 0);
    expect(h.working, isFalse);
    expect(h.autoOutAt, at(13, 15));
    expect(h.alert!.title, contains('auto punched out'));
    expect(h.alert!.message, contains('at least 30 min'));
    expect(h.alert!.message, contains('1 hr total break'));
    expect(h.alert!.why, contains('4h 15m'));
    expect(h.alert!.why, contains('25m'));
    expect(h.alert!.why, contains('1:45 PM'));
    expect(h.longest, 255 * kMin);
  });

  test('after the 30 minutes the rest is done and the alert clears', () {
    final h = run([s('a', at(9, 0), at(13, 15))], at(13, 50));
    expect(h.autoOut, isTrue);
    expect(h.restLeft, 0);
    expect(h.stage, 0);
    expect(h.alert, isNull);
    expect(h.counted, 35 * kMin);
  });

  test('a 5-minute live break after 2h keeps the streak alive', () {
    final h = run([s('a', at(9, 0), at(11, 0))], at(11, 5));
    expect(h.shortBreak, isTrue);
    expect(h.working, isFalse);
    expect(h.streak, 125 * kMin);
    expect(h.stage, 1);
    expect(h.alert!.message, contains('10m more'));
    expect(h.counted, 0);
  });

  test('once the live break reaches 15 minutes the streak is over', () {
    final h = run([s('a', at(9, 0), at(11, 0))], at(11, 15));
    expect(h.shortBreak, isFalse);
    expect(h.streak, 0);
    expect(h.counted, 15 * kMin);
    expect(h.stage, 0);
    expect(h.longest, 120 * kMin);
  });

  test('a stored day reports but never alerts', () {
    final h = run([s('a', at(9, 0, day: 6), at(14, 0, day: 6))], at(10, 0, day: 7));
    expect(h.longest, 300 * kMin);
    expect(h.autoOut, isTrue);
    expect(h.restLeft, 0);
    expect(h.stage, 0);
    expect(h.alert, isNull);
  });

  test('the break quota scales with the target', () {
    const half = Settings(target: 240, free: 0, health: true);
    expect(run([], at(9, 0), s: half).required, 30 * kMin);
  });

  test('settings carry the health flag through json', () {
    expect(Settings.fromJson({'target': 480, 'free': 0}).health, isTrue);
    expect(Settings.fromJson({'target': 480, 'free': 0, 'health': false}).health, isFalse);
    expect(const Settings(health: false).toJson()['health'], isFalse);
    expect(const Settings().copyWith(health: false).health, isFalse);
  });
}
