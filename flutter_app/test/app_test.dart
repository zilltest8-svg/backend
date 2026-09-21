import 'dart:convert';

import 'package:chronos/core/time.dart';
import 'package:chronos/main.dart';
import 'package:chronos/state/app_state.dart';
import 'package:chronos/state/attendance.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Two stored days, the newer one still running, written the way the app stores them.
String _store() {
  final today = startOfToday();
  final yesterday = today - kDayMs;
  return jsonEncode({
    'sessions': [
      {'id': 'a', 'in': yesterday + 9 * 60 * kMin, 'out': yesterday + 13 * 60 * kMin},
      {'id': 'b', 'in': yesterday + 14 * 60 * kMin, 'out': yesterday + 18 * 60 * kMin},
      {'id': 'c', 'in': today + 60 * kMin, 'out': today + 90 * kMin},
      {'id': 'd', 'in': today + 120 * kMin, 'out': null},
    ],
    'settings': {'target': 480, 'free': 0},
    'filter': {'month': 'all', 'day': 'latest'},
  });
}

/// A few frames rather than one: a route transition only finishes on the frame
/// after its clock runs out. `pumpAndSettle` is no use here — the backdrop and
/// the timer ring animate for as long as the app is open.
Future<void> _frames(WidgetTester tester) async {
  for (var i = 0; i < 4; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
}

/// The binding checks for stray timers before tear-downs run, so the clock has
/// to be stopped inside the test body.
Future<void> _shutdown(WidgetTester tester, AppState state) async {
  await tester.pumpWidget(const SizedBox());
  state.dispose();
}

Future<AppState> _boot(WidgetTester tester, Size size, {bool stored = true, String? consent = 'granted'}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  SharedPreferences.setMockInitialValues({'otc.consent': 'granted', if (stored) 'otc.v3': _store()});
  final state = AppState(await SharedPreferences.getInstance());

  await tester.pumpWidget(ZilTimeApp(state: state));
  // The test binding answers every HTTP call with a 400, which reads as signed
  // out — so the sign-in dialog comes up, as it would with the proxy down.
  for (var i = 0; i < 10; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 10)));
    await tester.pump(const Duration(milliseconds: 300));
  }
  expect(state.attendance.auth, AuthState.signedOut);
  expect(find.text('WORK EMAIL'), findsOneWidget);
  await tester.tap(find.text('Cancel'));
  await _frames(tester);
  expect(find.text('WORK EMAIL'), findsNothing);
  return state;
}

void main() {
  for (final size in const [Size(1400, 900), Size(820, 1000), Size(420, 900)]) {
    testWidgets('every screen lays out at ${size.width.round()}px', (tester) async {
      final state = await _boot(tester, size);
      expect(state.days, hasLength(2));
      expect(find.text('Sessions & Breaks'), findsOneWidget);

      for (final view in AppView.values) {
        state.setView(view);
        await _frames(tester);
        expect(tester.takeException(), isNull, reason: '$view at $size');
      }

      // Open a stored day in the history list, then the sheet that edits it.
      state.setView(AppView.history);
      await _frames(tester);
      await tester.tap(find.text(dayMonth(startOfToday())).first);
      await _frames(tester);
      await tester.ensureVisible(find.text('Edit day'));
      await tester.tap(find.text('Edit day'));
      await _frames(tester);
      expect(find.text('Submit to history'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _shutdown(tester, state);
    });
  }

  testWidgets('loaded punches are saved without being asked', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final state = await _boot(tester, const Size(1400, 900), stored: false, consent: null);
    expect(find.text('Start Timer'), findsNothing);
    expect(find.text('Apply to Dashboard'), findsNothing);
    expect(find.text('Keep your day on this device?'), findsNothing);

    final today = startOfToday() + 9 * 60 * kMin;
    state.loadJson(
      jsonEncode({
        'sessions_today': [
          {'id': 1, 'punch_in': ist(today).toIso8601String().replaceFirst('Z', '+05:30'), 'punch_out': null},
        ],
      }),
    );
    await _frames(tester);
    expect(state.day.sessions, hasLength(1));

    // Still punched in, so the day is in progress; punching out signs it off.
    expect(state.selected?.submittedAt, isNull);
    state.loadJson(
      jsonEncode({
        'sessions_today': [
          {
            'id': 1,
            'punch_in': ist(today).toIso8601String().replaceFirst('Z', '+05:30'),
            'punch_out': ist(today + 60 * kMin).toIso8601String().replaceFirst('Z', '+05:30'),
          },
        ],
      }),
    );
    await _frames(tester);
    expect(state.selected?.submittedAt, isNotNull);

    final prefs = await SharedPreferences.getInstance();
    expect(jsonDecode(prefs.getString('otc.v3')!)['sessions'], hasLength(1));

    // Let the toast's own timer run out before the test ends.
    await tester.pump(const Duration(seconds: 5));
    await _shutdown(tester, state);
  });
}
