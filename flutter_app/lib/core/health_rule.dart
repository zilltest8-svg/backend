/// The health break rule the HR system enforces, read off the day the
/// calculator already produced (ported from `src/healthRule.ts`):
///
///   - A break counts only if it is 15 minutes or longer. A shorter gap does
///     not reset the continuous-work timer.
///   - Reminders at 2h, 3h and 4h of continuous work; at 4h 15m the system
///     punches you out, and 30 minutes of rest are owed before returning.
///   - One hour of counted break is required per eight hours of work target.
///
/// This module only observes. It never changes a punch or the exit time —
/// what it says is why the HR system did, or is about to do, what it does.
library;

import 'dart:math' as math;

import 'time.dart';
import 'types.dart';

/// A gap shorter than this is not a break: it does not reset the timer and does not count.
const int kMinBreak = 15 * kMin;

/// Continuous work at which the three reminders fire.
const List<int> kRemindAt = [120 * kMin, 180 * kMin, 240 * kMin];

/// Continuous work at which the HR system punches you out.
const int kAutoOut = 255 * kMin;

/// Rest owed after an automatic punch-out.
const int kRestAfterAutoOut = 30 * kMin;

/// 0 none · 1 the 2h nudge · 2 the 3h reminder · 3 the 4h warning · 4 auto punch-out
typedef HealthStage = int;

enum HealthTone { info, warn, strong, stop }

class HealthAlert {
  const HealthAlert({
    required this.stage,
    required this.tone,
    required this.title,
    required this.message,
    required this.why,
  });

  final HealthStage stage;
  final HealthTone tone;
  final String title;

  /// What to do, in the policy's own voice.
  final String message;

  /// Why it fired: the stretch, when it began, what did and did not count, what comes next.
  final String why;
}

class Health {
  const Health({
    required this.streak,
    required this.streakStart,
    required this.working,
    required this.shortBreak,
    required this.ignored,
    required this.longest,
    required this.counted,
    required this.required,
    required this.stage,
    required this.nextAt,
    required this.autoOut,
    required this.restLeft,
    required this.autoOutAt,
    required this.alert,
  });

  /// The unbroken stretch so far: runs while you work and through any gap under 15 min. 0 after a real break.
  final int streak;
  final int? streakStart;
  final bool working;

  /// Away right now, but for less than 15 minutes, so the stretch is still alive.
  final bool shortBreak;

  /// Gaps under 15 minutes inside the current stretch — they did not reset it.
  final int ignored;

  /// The longest stretch of the day, the one the system tracks.
  final int longest;

  /// Break time that counts: gaps of 15 minutes or more, the live one included once it qualifies.
  final int counted;

  /// Counted break the policy asks for today.
  final int required;
  final HealthStage stage;

  /// When the next reminder lands if the stretch goes on; null when none is open or none is left.
  final int? nextAt;

  /// The last stretch reached the auto punch-out length and has ended — the system punched you out.
  final bool autoOut;

  /// Rest still owed after that punch-out, 0 otherwise.
  final int restLeft;

  /// When that punch-out happened, or null.
  final int? autoOutAt;
  final HealthAlert? alert;

  /// What non-ticking widgets care about, so a tick that changes none of it is cheap.
  String get shape => '$stage|$autoOut|${restLeft > 0}|${streakStart ?? ''}|$shortBreak';
}

HealthStage _stageOf(int streak) {
  if (streak >= kAutoOut) return 4;
  if (streak >= kRemindAt[2]) return 3;
  if (streak >= kRemindAt[1]) return 2;
  if (streak >= kRemindAt[0]) return 1;
  return 0;
}

const _tones = [HealthTone.info, HealthTone.info, HealthTone.warn, HealthTone.strong, HealthTone.stop];

const _titles = ['', '2 hours of continuous work', '3 hours without a break', '4 hours without a break', 'Auto punch-out'];

const _advice = [
  '',
  'Time for a short break. Get up, stretch, move around and step away for at least 15 minutes — a shorter break does not count.',
  'Please step away and recharge. A break of 15 minutes or more resets your continuous-work timer.',
  'Stop, move around and give your body the rest it needs. At 4h 15m the system punches you out automatically.',
  "You've reached 4h 15m of continuous work — the system punches you out at this point. Please take at least 30 minutes before returning.",
];

/// The message the HR system sends with an automatic punch-out, word for word.
const String kAutoOutMessage =
    "You've been auto punched out. Please take at least 30 min before returning. "
    'For your health, 1 hr total break is required per 8 net work hrs for your optimum health. '
    'Each break must be 15+ min to count. You can work 4 hrs, take 1 hr, then work 4 hrs, '
    'or split the 1 hr into 15+ min breaks.';

Health assessHealth(DayResult day, Settings settings) {
  final now = day.now;
  final required = (settings.target / 8 * kMin).round();

  int? stretchStart;
  var stretchEnd = 0;
  var ignored = 0;
  var longest = 0;
  var counted = 0;
  // The stretch that most recently ended, and when — what an auto punch-out is judged on.
  var lastLen = 0;
  var lastStart = 0;
  var lastEnd = 0;

  void close(int end) {
    final start = stretchStart;
    if (start == null) return;
    lastLen = end - start;
    lastStart = start;
    lastEnd = end;
    longest = math.max(longest, lastLen);
    stretchStart = null;
    ignored = 0;
  }

  for (final b in day.blocks) {
    if (b.isWork) {
      stretchStart ??= b.from;
      stretchEnd = b.to;
      continue;
    }
    final gap = b.to - b.from;
    if (gap >= kMinBreak) {
      counted += gap;
      close(b.from);
    } else if (stretchStart != null) {
      ignored += 1;
    }
  }

  final working = day.status == DayStatus.working;
  var shortBreak = false;
  var streak = 0;

  final open = stretchStart;
  if (open != null) {
    if (working) {
      streak = now - open;
    } else if (day.status == DayStatus.onBreak && stretchEnd - open < kAutoOut) {
      // Punched out for less than 15 minutes: the stretch is still alive.
      shortBreak = true;
      streak = now - open;
    } else {
      // The day is over, or the stretch hit the limit and the system ended it.
      close(stretchEnd);
    }
  }

  // Only a live day owes rest: a stored day's punch-out is just a fact about it.
  final autoOut = !working && !shortBreak && lastLen >= kAutoOut;
  final restLeft = autoOut && !day.stale && day.status == DayStatus.onBreak
      ? math.max(0, kRestAfterAutoOut - (now - lastEnd))
      : 0;

  var stage = stretchStart != null ? _stageOf(streak) : 0;
  if (autoOut && restLeft > 0) stage = 4;

  int? nextAt;
  final start = stretchStart;
  if (start != null) {
    for (final t in [...kRemindAt, kAutoOut]) {
      if (t > streak) {
        nextAt = start + t;
        break;
      }
    }
  }

  HealthAlert? alert;
  if (!day.stale && stage > 0) {
    if (autoOut) {
      final rest = restLeft > 0
          ? 'Rest ${human(restLeft)} more before punching back in (until ${clockShort(lastEnd + kRestAfterAutoOut)}).'
          : 'Your 30-minute rest is complete — you can punch back in.';
      alert = HealthAlert(
        stage: stage,
        tone: HealthTone.stop,
        title: "You've been auto punched out",
        message: kAutoOutMessage,
        why:
            'Why: your last stretch ran ${human(lastLen)}, from ${clockShort(lastStart)} to ${clockShort(lastEnd)}, '
            'past the 4h 15m limit. $rest',
      );
    } else {
      final parts = [
        'Why: you have worked ${human(streak)} without a break of 15 minutes or more, since ${clockShort(start)}.',
      ];
      if (ignored > 0) parts.add('$ignored short gap${ignored == 1 ? '' : 's'} under 15 min did not reset the timer.');
      if (stage == 3) {
        parts.add('Auto punch-out at ${clockShort(start! + kAutoOut)}.');
      } else if (nextAt != null) {
        parts.add('Next reminder at ${clockShort(nextAt)}.');
      }

      var message = _advice[stage];
      if (shortBreak) {
        final away = now - stretchEnd;
        message =
            "You're on a break of ${human(away)} so far. Breaks under 15 minutes do not reset the timer — "
            'stay away ${human(kMinBreak - away)} more for it to count.';
      }
      alert = HealthAlert(stage: stage, tone: _tones[stage], title: _titles[stage], message: message, why: parts.join(' '));
    }
  }

  return Health(
    streak: streak,
    streakStart: stretchStart,
    working: working,
    shortBreak: shortBreak,
    ignored: ignored,
    longest: math.max(longest, streak),
    counted: counted,
    required: required,
    stage: stage,
    nextAt: nextAt,
    autoOut: autoOut,
    restLeft: restLeft,
    autoOutAt: autoOut ? lastEnd : null,
    alert: alert,
  );
}
