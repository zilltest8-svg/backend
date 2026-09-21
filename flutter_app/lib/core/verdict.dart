import 'dart:math' as math;

import 'time.dart';
import 'types.dart';

enum Tone { ok, warn, error, idle }

class Verdict {
  const Verdict(this.text, this.tone);

  final String text;
  final Tone tone;
}

/// One sentence on how the day is going — the line along the bottom of the dashboard.
Verdict verdict(DayResult day, int target) {
  if (day.sessions.isEmpty) {
    return const Verdict("Load today's punches to see how your day is going.", Tone.idle);
  }
  if (day.stale) {
    return Verdict('Showing a stored day — ${hm(day.worked)} worked, exit was ${clockShort(day.leave)}.', Tone.idle);
  }
  if (day.reached) {
    return Verdict('Goal complete — you put in ${hm(day.worked)} of your ${hm(target * kMin)}. Free to go.', Tone.ok);
  }
  if (day.status == DayStatus.onBreak) {
    return Verdict('On a break — every minute away pushes your exit, now ${clockShort(day.leave)}.', Tone.warn);
  }
  if (day.status == DayStatus.out) {
    return Verdict(
      'Punched out with ${hm(math.max(0, day.remaining))} still owed — exit was ${clockShort(day.leave)}.',
      Tone.warn,
    );
  }
  return Verdict('On track — ${human(day.span - day.elapsed)} to go, leaving at ${clockShort(day.leave)}.', Tone.ok);
}
