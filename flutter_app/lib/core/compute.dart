import 'dart:convert';
import 'dart:math' as math;

import 'time.dart';
import 'types.dart';

/// The rule this app implements:
///
///   exit = first punch-in + work target + every break minute
///
/// Lunch is just break time — take it whenever you like, it pushes your exit
/// back by exactly as long as you were away. `settings.free` optionally gifts
/// the first N break minutes.
DayResult computeDay(List<Session> sessions, Settings settings, int clock) {
  final sorted = [...sessions]..sort((a, b) => a.inAt.compareTo(b.inAt));
  final target = settings.target * kMin;

  if (sorted.isEmpty) {
    return DayResult(
      sessions: sorted,
      blocks: const [],
      now: clock,
      first: null,
      last: null,
      worked: 0,
      breakMs: 0,
      billableBreak: 0,
      efficiency: 0,
      span: target,
      elapsed: 0,
      office: 0,
      officeGoal: target,
      frac: 0,
      leave: null,
      remaining: target,
      overtime: 0,
      reached: false,
      status: DayStatus.empty,
      liveBreak: 0,
      stale: false,
    );
  }
  final first = sorted.first;

  // Data from an earlier day must not keep counting, or an open session would
  // claim you had been at work for days. A day that was punched out of stops at
  // that last punch — anything later is time at home, and counting it would have
  // every stored day reporting fourteen hours in the office. Only a day left open
  // falls back to freezing at the day's end.
  final stale = dayKey(first.inAt) != dayKey(clock);
  final closed = sorted.every((s) => s.out != null);
  final frozen = closed ? sorted.map((s) => s.out!).reduce(math.max) : startOfDay(first.inAt) + kDayMs - kMin;
  final now = stale ? math.min(clock, frozen) : clock;

  final blocks = <Block>[];
  var worked = 0;
  var breakMs = 0;
  var open = false;
  int? prevOut;

  for (final s in sorted) {
    final running = s.out == null;
    final rawEnd = running ? math.max(now, s.inAt) : s.out!;

    // Clip against the previous session so an overlap (two punches covering the
    // same minutes) is never counted twice and never swallows a break.
    final start = prevOut == null ? s.inAt : math.max(s.inAt, prevOut);
    final end = math.max(start, rawEnd);

    if (prevOut != null && s.inAt > prevOut) {
      breakMs += s.inAt - prevOut;
      blocks.add(Block(kind: BlockKind.breakTime, from: prevOut, to: s.inAt, live: false));
    }
    if (end > start || running) {
      if (running) open = true;
      worked += end - start;
      blocks.add(Block(kind: BlockKind.work, from: start, to: end, live: running, sessionId: s.id));
    }
    prevOut = prevOut == null ? end : math.max(prevOut, end);
  }

  final last = prevOut!;

  // Punched out with nothing after it, on the same day => you are on a break right
  // now. A day that is already over has no such break: nobody is coming back to
  // punch in, so counting the evening as break time would inflate every stored day.
  var liveBreak = 0;
  var onBreak = false;
  if (!open && !stale && now > last && dayKey(last) == dayKey(now)) {
    onBreak = true;
    liveBreak = now - last;
    breakMs += liveBreak;
    blocks.add(Block(kind: BlockKind.breakTime, from: last, to: now, live: true));
  }

  final billable = math.max(0, breakMs - settings.free * kMin);
  final leave = first.inAt + target + billable;
  final span = math.max(kMin, leave - first.inAt);
  final elapsed = math.max(0, now - first.inAt);

  // "Time in office" is the clock-to-clock window minus every minute you were
  // away, so the headline counter stalls during a break instead of running on.
  // The goal loses the same break minutes, which keeps `reached` unchanged:
  // office >= officeGoal is exactly elapsed >= span.
  final office = math.max(0, elapsed - breakMs);
  final officeGoal = math.max(kMin, span - breakMs);

  return DayResult(
    sessions: sorted,
    blocks: blocks,
    now: now,
    first: first.inAt,
    last: last,
    worked: worked,
    breakMs: breakMs,
    billableBreak: billable,
    efficiency: target > 0 ? math.min(1, worked / target) : 0,
    span: span,
    elapsed: elapsed,
    office: office,
    officeGoal: officeGoal,
    frac: math.min(1, office / officeGoal),
    leave: leave,
    remaining: target - worked,
    overtime: math.max(0, worked - target),
    reached: elapsed >= span,
    status: open
        ? DayStatus.working
        : onBreak
        ? DayStatus.onBreak
        : DayStatus.out,
    liveBreak: liveBreak,
    stale: stale,
  );
}

class ParseResult {
  const ParseResult({
    required this.sessions,
    required this.added,
    required this.skipped,
    required this.full,
    this.target,
  });

  final List<Session> sessions;
  final int? target;
  final int added;
  final int skipped;

  /// True when the response carried a whole-day list (`sessions_today`), which
  /// makes it the authority for that day — re-pasting it replaces the day rather
  /// than merging, so removed or corrected punches disappear instead of lingering.
  final bool full;
}

/// Read the punch API response into sessions. Throws a [FormatException] with a
/// readable message.
ParseResult parsePayload(String text) {
  Object? data;
  try {
    data = jsonDecode(text);
  } on FormatException catch (e) {
    throw FormatException('Invalid JSON: ${e.message}');
  }
  return parsePayloadData(data);
}

/// The same, for a response that has already been decoded.
ParseResult parsePayloadData(Object? data) {
  final payload = data is Map ? data : const {};
  final Object? whole = payload['sessions_today'] ?? payload['sessions'] ?? (data is List ? data : null);
  final Object? list = whole ?? (payload['current_session'] != null ? [payload['current_session']] : null);

  if (list is! List) throw const FormatException('No "sessions_today" array found in that response.');

  // Keyed by punch-in: the same punch listed twice in one response (say, once in
  // `sessions_today` and again as `current_session`) must collapse to one row.
  final byStart = <int, Session>{};
  var skipped = 0;

  for (final raw in list) {
    final row = raw is Map ? raw : const {};
    final punchIn = parseISO(row['punch_in'] ?? row['in'] ?? row['start']);
    if (punchIn == null) {
      skipped += 1;
      continue;
    }
    final punchOut = parseISO(row['punch_out'] ?? row['out'] ?? row['end']);
    final prev = byStart[punchIn];
    byStart[punchIn] = Session(
      id: row['id'] != null ? _idOf(row['id']) : (prev?.id ?? 't$punchIn'),
      inAt: punchIn,
      // a closed copy always beats an open one — it carries more information
      out: punchOut ?? prev?.out,
    );
  }

  final sessions = byStart.values.toList()..sort((a, b) => a.inAt.compareTo(b.inAt));
  final target = payload['target_minutes'];
  return ParseResult(
    sessions: sessions,
    added: sessions.length,
    skipped: skipped,
    full: whole is List,
    target: target is num && target > 0 ? target.round() : null,
  );
}

/// `12`, not `12.0`, for an id that arrived as a JSON number.
String _idOf(Object id) => id is num && id == id.roundToDouble() ? '${id.toInt()}' : '$id';

/// Merge incoming sessions over the existing ones. A punch is identified by the
/// minute it started, not just by id — otherwise the same punch arriving with a
/// different id (or added by hand first, then loaded from the API) would show up
/// twice and corrupt the break calculation.
List<Session> mergeSessions(List<Session> existing, List<Session> incoming) {
  final byStart = <int, Session>{};
  final idToStart = <String, int>{};

  void put(Session s) {
    // an id we've already seen wins over the start time, so a corrected punch-in
    // moves the existing row instead of adding a second one
    final known = idToStart[s.id];
    if (known != null && known != s.inAt) byStart.remove(known);
    byStart[s.inAt] = s;
    idToStart[s.id] = s.inAt;
  }

  existing.forEach(put);
  incoming.forEach(put);

  return byStart.values.toList()..sort((a, b) => a.inAt.compareTo(b.inAt));
}

/// Replace every session belonging to the incoming day. Used when the response
/// carried a full `sessions_today` list, so a second paste reflects that response
/// exactly — punches that vanished upstream vanish here too.
List<Session> replaceDay(List<Session> existing, List<Session> incoming) {
  if (incoming.isEmpty) return existing;
  final key = dayKey(incoming.first.inAt);
  return [...existing.where((s) => dayKey(s.inAt) != key), ...incoming]..sort((a, b) => a.inAt.compareTo(b.inAt));
}

/// Move every punch forward by whole days so stale data becomes today's.
List<Session> shiftToToday(List<Session> sessions, int today) {
  if (sessions.isEmpty) return sessions;
  final delta = today - startOfDay(sessions.first.inAt);
  if (delta == 0) return sessions;
  return [
    for (final s in sessions) Session(id: s.id, inAt: s.inAt + delta, out: s.out == null ? null : s.out! + delta),
  ];
}
