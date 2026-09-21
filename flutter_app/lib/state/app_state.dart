import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../core/compute.dart';
import '../core/history.dart';
import '../core/history_pdf.dart';
import '../core/time.dart';
import '../core/types.dart';
import '../platform/platform.dart';
import 'attendance.dart';
import 'attendance_api.dart';
import 'sheet.dart';

const _storeKey = 'otc.v3';
const _v2Key = 'otc.v2';
const _legacyKey = 'otc.v1';
const _consentKey = 'otc.consent';
const _proxyKey = 'otc.proxyBase';
const _sessionKey = 'otc.session';

/// Every key this app owns. Rejecting clears all of them — except the choice itself.
const _owned = [_storeKey, _v2Key, _legacyKey, urlKey, idKey, fileKey, _proxyKey, _sessionKey];

/// The live attendance backend. A desktop build always talks to this one — there
/// is no setting for it, so a release can never end up pointed at a developer's
/// localhost. (A browser build uses its own origin instead; the session there is
/// an httpOnly cookie, which only works same-origin.)
const backendBase = 'https://backend-sigma-seven-ta21oxlec0.vercel.app';

/// Past days don't change; recomputing the whole history 4× a second would be waste.
const _historyTick = 30000;

enum AppView { dashboard, insights, history, export, settings }

/// The app keeps punches in local storage. The consent choice governs that
/// storage: until it is granted nothing is written, and rejecting wipes whatever
/// is already there.
enum Consent { unknown, granted, denied }

class ToastMsg {
  const ToastMsg({required this.id, required this.text, required this.ok, this.actionLabel, this.actionHref});

  final int id;
  final String text;
  final bool ok;
  final String? actionLabel;
  final String? actionHref;
}

/// Seed the per-day timestamps for punches that predate them: the last thing
/// that happened that day is the truest "when was this recorded" we can recover.
DayMeta _seedMeta(List<Session> sessions) {
  final meta = <String, DayStamp>{};
  for (final s in sessions) {
    final key = dayKey(s.inAt);
    final at = s.out ?? s.inAt;
    final seen = meta[key];
    if (seen == null || seen.savedAt < at) meta[key] = DayStamp(savedAt: at);
  }
  return meta;
}

/// A per-day fingerprint of the punches, so only days that actually changed are re-stamped.
Map<String, String> _signature(List<Session> sessions) {
  final sig = <String, String>{};
  for (final s in [...sessions]..sort((a, b) => a.inAt.compareTo(b.inAt))) {
    final key = dayKey(s.inAt);
    sig[key] = '${sig[key] ?? ''}|${s.inAt}-${s.out ?? 'open'}';
  }
  return sig;
}

/// Stamp the days whose punches changed, and drop the days that no longer exist.
DayMeta _restamp(List<Session> prev, List<Session> next, DayMeta meta, int at) {
  final before = _signature(prev);
  final out = <String, DayStamp>{};
  _signature(next).forEach((key, value) {
    final kept = before[key] == value ? meta[key] : null;
    out[key] = kept ?? DayStamp(savedAt: at);
  });
  return out;
}

/// A day with every session punched out is signed off by itself. Punching back
/// in changes that day's punches, which drops the stamp again in `_restamp` —
/// so lunch reads "Saved" only until the afternoon's punch-in, and the day ends
/// up saved for good at the last punch-out. A day left open is never marked.
DayMeta _autoSubmit(List<Session> sessions, DayMeta meta, int at) {
  final open = {
    for (final s in sessions)
      if (s.out == null) dayKey(s.inAt),
  };
  return {
    for (final e in meta.entries)
      e.key: e.value.submittedAt == null && !open.contains(e.key)
          ? DayStamp(savedAt: e.value.savedAt, submittedAt: at)
          : e.value,
  };
}

List<Session> _sessionsOf(Object? raw) => raw is List ? [for (final s in raw) ?Session.fromJson(s)] : const [];

class AppState extends ChangeNotifier {
  AppState(this._prefs) {
    final choice = _read(_consentKey);
    consent = switch (choice) {
      'granted' => Consent.granted,
      'denied' => Consent.denied,
      _ => Consent.unknown,
    };
    // An address saved by an earlier build would be a localhost one; drop it.
    unawaited(_prefs.remove(_proxyKey));
    _readStore();
    // Days stored before this rule existed get the same treatment.
    meta = _autoSubmit(sessions, meta, nowMs());

    sheet = SheetController(read: _read, remember: _remember, day: () => day, say: say)..addListener(notifyListeners);
    attendance = AttendanceController(
      proxyBase: () => backendBase,
      say: (text, ok) => say(text, ok),
      onFetched: _applyFetched,
      // The proxy's sealed session, kept so a restart stays signed in. Unused
      // in a browser, where the cookie is the browser's own business.
      session: _read(_sessionKey),
      onSession: (value) => value == null ? unawaited(_prefs.remove(_sessionKey)) : _remember(_sessionKey, value),
    )..addListener(notifyListeners);

    _recompute(force: true);
    unawaited(attendance.start());
    _scheduleTick();
  }

  /// The shared clock, on its own notifier. Only what shows a running figure
  /// listens to it, so a tick repaints a few numbers rather than rebuilding the
  /// sidebar, the backdrop and every card once a second.
  final clock = ValueNotifier<int>(nowMs());

  /// Ticks land on the second, so the seconds on screen change when the real
  /// ones do instead of up to a tick late.
  void _scheduleTick() {
    _clock = Timer(Duration(milliseconds: 1000 - nowMs() % 1000), () {
      now = nowMs();
      final before = _shape;
      _recompute();
      clock.value = now;
      // The day turning a corner — goal met, break begun, midnight — changes
      // things outside the ticking widgets, so that does go to everyone.
      if (_shape != before) notifyListeners();
      _scheduleTick();
    });
  }

  /// Everything about the day that the non-ticking parts of the UI depend on.
  String get _shape => '${selected?.key}|${day.status}|${day.reached}|${day.stale}|${days.length}|$_coarse';

  final SharedPreferences _prefs;
  late final SheetController sheet;
  late final AttendanceController attendance;
  late Timer _clock;
  Timer? _toastTimer;

  /// Every punch ever loaded, across every day — history lives here.
  List<Session> sessions = const [];
  Settings settings = const Settings();
  Filter filter = const Filter();
  DayMeta meta = const {};

  Consent consent = Consent.unknown;

  int now = nowMs();
  AppView view = AppView.dashboard;
  ToastMsg? toast;

  /// Every stored day, newest first.
  List<DayEntry> days = const [];

  /// The calculator works on exactly one day: feeding it several would read the
  /// night between them as a break. The filter decides which one that is.
  DayEntry? selected;
  late DayResult day;

  int _coarse = -1;

  /// True while the app may write to storage. Saving is the default — the
  /// punches fetched every minute are kept without being asked for — and only
  /// an explicit "Reject & wipe" in Settings turns it off.
  bool get canPersist => consent != Consent.denied;

  /// The filter is pointing somewhere on purpose, rather than following the newest day.
  bool get browsing => filter.day != 'latest' || filter.month != 'all';

  bool get running => day.sessions.any((s) => s.out == null) && !day.stale;

  /* ---------------------------------------------------------------- storage */

  /// Reading is unconditional — data already on this machine belongs to the user
  /// and dropping it would be silent data loss. In a browser that includes what
  /// the React version of the app wrote under the same keys.
  String? _read(String key) => _prefs.getString(key) ?? legacyRead(key);

  void _remember(String key, String value) {
    if (canPersist) unawaited(_prefs.setString(key, value));
  }

  void _readStore() {
    try {
      final raw = _read(_storeKey);
      if (raw != null) {
        final parsed = jsonDecode(raw);
        if (parsed is Map && parsed['sessions'] is List) {
          sessions = _sessionsOf(parsed['sessions']);
          settings = Settings.fromJson(parsed['settings']);
          filter = Filter.fromJson(parsed['filter']);
          final stored = parsed['meta'];
          meta = stored is Map
              ? {for (final e in stored.entries) '${e.key}': ?DayStamp.fromJson(e.value)}
              : _seedMeta(sessions);
          return;
        }
      }
      // v2: sessions + settings, one flat day, no history bookkeeping
      final v2 = _read(_v2Key);
      if (v2 != null) {
        final parsed = jsonDecode(v2);
        if (parsed is Map && parsed['sessions'] is List) {
          sessions = _sessionsOf(parsed['sessions']);
          settings = Settings.fromJson(parsed['settings']);
          meta = _seedMeta(sessions);
          return;
        }
      }
      // v1: the flat shape the first version wrote
      final old = _read(_legacyKey);
      if (old != null) {
        final v1 = jsonDecode(old);
        if (v1 is Map && v1['sessions'] is List) {
          sessions = _sessionsOf(v1['sessions']);
          settings = Settings.fromJson(v1);
          meta = _seedMeta(sessions);
        }
      }
    } on FormatException {
      // corrupt storage — fall through to defaults
    }
  }

  /// Nothing is written back until consent is granted, and the write happens
  /// the moment it is.
  void _persist() {
    if (!canPersist) return;
    unawaited(
      _prefs.setString(
        _storeKey,
        jsonEncode({'sessions': sessions, 'settings': settings, 'filter': filter, 'meta': meta}),
      ),
    );
  }

  void _decide(Consent next) {
    if (next == Consent.denied) {
      for (final key in _owned) {
        unawaited(_prefs.remove(key));
        legacyRemove(key);
      }
    }
    // The choice itself is the one thing kept either way, so the question is
    // asked once rather than on every launch.
    unawaited(_prefs.setString(_consentKey, next == Consent.granted ? 'granted' : 'denied'));
    consent = next;
    _persist();
    notifyListeners();
  }

  void allow() {
    _decide(Consent.granted);
    say('Saved on this device from now on.', true);
  }

  /// Rejecting is not just a preference — it wipes what this app already wrote.
  void reject() {
    _decide(Consent.denied);
    say('Nothing will be stored. Anything already saved has been deleted.', true);
  }

  /* ----------------------------------------------------------------- derive */

  void _recompute({bool force = false}) {
    final coarse = now ~/ _historyTick * _historyTick;
    if (force || coarse != _coarse) {
      _coarse = coarse;
      days = buildHistory(sessions, settings, meta, coarse);
    }
    selected = resolveDay(days, filter);
    day = computeDay(selected?.sessions ?? const [], settings, now);
  }

  void _changed() {
    _recompute(force: true);
    _persist();
    notifyListeners();
  }

  void _setSessions(List<Session> next) {
    final at = nowMs();
    meta = _autoSubmit(next, _restamp(sessions, next, meta, at), at);
    sessions = next;
  }

  void setSettings({int? target, int? free}) {
    settings = settings.copyWith(target: target, free: free);
    _changed();
  }

  void setFilter({String? month, String? day}) {
    filter = filter.copyWith(month: month, day: day);
    _changed();
  }

  /* ------------------------------------------------------------------ toast */

  void say(String text, bool ok, {String? actionLabel, String? actionHref}) {
    toast = ToastMsg(id: nowMs(), text: text, ok: ok, actionLabel: actionLabel, actionHref: actionHref);
    _toastTimer?.cancel();
    _toastTimer = Timer(Duration(milliseconds: actionLabel != null ? 9000 : 4200), () {
      toast = null;
      notifyListeners();
    });
    notifyListeners();
  }

  /* ---------------------------------------------------------------- actions */

  void setView(AppView next) {
    view = next;
    notifyListeners();
  }

  void _take(ParseResult parsed) {
    // A full `sessions_today` response is the authority for that day, so a
    // second paste replaces it outright — sessions and breaks both re-derive
    // from exactly what was pasted instead of accumulating stale rows.
    _setSessions(parsed.full ? replaceDay(sessions, parsed.sessions) : mergeSessions(sessions, parsed.sessions));
    if (parsed.target != null) settings = settings.copyWith(target: parsed.target);
  }

  void loadJson(String text) {
    if (text.trim().isEmpty) return say('Paste a response first.', false);
    try {
      _loadParsed(parsePayload(text));
    } on FormatException catch (e) {
      say(e.message, false);
    }
  }

  void _loadParsed(ParseResult parsed) {
    if (parsed.added == 0) return say('No readable punch times in that response.', false);
    _take(parsed);
    // Follow what was just pasted, so loading an older day while browsing
    // another one still shows the thing that landed.
    filter = Filter(month: 'all', day: dayKey(parsed.sessions.first.inAt));
    _changed();
    say(
      '${parsed.full ? 'Updated' : 'Loaded'} ${parsed.added} session${parsed.added == 1 ? '' : 's'}'
      '${parsed.skipped > 0 ? ' (${parsed.skipped} skipped)' : ''}.',
      true,
    );
  }

  /// Every fetch flows into the store by itself, so the whole dashboard reads
  /// the HR response rather than only the panel at the top. Silent, because a
  /// toast every minute would be unbearable, and deliberately without moving the
  /// filter: yanking the view back to today while someone is reading an older
  /// day would be rude.
  void _applyFetched(TodayReport report) {
    // An empty response never wipes the day — before the first punch of the
    // morning my-today has nothing, and that is not a reason to erase punches.
    if (report.sessions.isEmpty) return;
    try {
      _take(parsePayloadData(report.raw));
    } on FormatException {
      return;
    }
    _changed();
  }

  void addManual(String date, String punchIn, String punchOut) {
    final mIn = minutesFromInput(punchIn);
    if (mIn == null) return say('Enter a punch-in time.', false);
    final mOut = punchOut.isEmpty ? null : minutesFromInput(punchOut);

    // The date typed into the dialog wins, so a day with nothing stored yet can
    // be started by hand; it falls back to the day on screen.
    final base = startOfDayKey(date) ?? selected?.at ?? startOfToday();
    final tIn = base + mIn * kMin;
    var tOut = mOut == null ? null : base + mOut * kMin;
    if (tOut != null && tOut < tIn) tOut += kDayMs; // crossed midnight

    _setSessions(mergeSessions(sessions, [Session(id: 'm$tIn', inAt: tIn, out: tOut)]));
    filter = Filter(month: 'all', day: dayKey(tIn));
    _changed();
    say('Session added to ${dateLabel(tIn)}.', true);
  }

  void deleteSession(String id) {
    _setSessions(sessions.where((s) => s.id != id).toList());
    _changed();
  }

  void deleteDay(String key) {
    _setSessions(sessions.where((s) => dayKey(s.inAt) != key).toList());
    if (filter.day == key) filter = filter.copyWith(day: 'latest');
    _changed();
  }

  void clearAll() {
    if (sessions.isEmpty) return;
    _setSessions(const []);
    filter = const Filter();
    _changed();
    say('History cleared.', true);
  }

  /// Move only the day on screen — the other stored days must stay where they are.
  void shiftSelectedToToday() {
    final current = selected;
    if (current == null) return;
    final moved = shiftToToday(current.sessions, startOfToday());
    _setSessions(replaceDay(sessions.where((s) => dayKey(s.inAt) != current.key).toList(), moved));
    filter = const Filter();
    _changed();
    say('Moved to today.', true);
  }

  /// Submitting the day sheet: the edited punches replace that day and sign it
  /// off, in a single update — `_restamp` drops the meta of a day whose punches
  /// changed, so stamping in a second step would undo itself.
  void commitDay(String key, List<Session> edited) {
    final next = [...sessions.where((s) => dayKey(s.inAt) != key), ...edited]..sort((a, b) => a.inAt.compareTo(b.inAt));
    final at = nowMs();
    final stamped = _restamp(sessions, next, meta, at);
    // A day can be emptied from the sheet, in which case there is nothing to sign off.
    final stamp = stamped[key];
    if (stamp != null) stamped[key] = DayStamp(savedAt: stamp.savedAt, submittedAt: at);
    sessions = next;
    meta = stamped;
    filter = Filter(month: 'all', day: key);
    _changed();

    final base = startOfDayKey(key);
    final label = base == null ? key : dateLabel(base);
    say(
      edited.isEmpty
          ? 'Cleared $label.'
          : 'Saved $label to history — ${edited.length} session${edited.length == 1 ? '' : 's'}.',
      true,
    );
  }

  /// The days on screen in the history panel, saved as a PDF report.
  Future<void> downloadPdf(List<DayEntry> list, String scope) async {
    if (list.isEmpty) return say('Nothing to download yet.', false);
    final report = ReportMeta(scope: scope, at: nowMs());
    final path = await saveFile(
      historyPdf(list, totalsOf(list), report),
      historyPdfFilename(report),
      'application/pdf',
    );
    final count = '${list.length} ${list.length == 1 ? 'day' : 'days'}';
    say(path == null ? 'PDF downloaded — $count.' : 'PDF saved to $path — $count.', true);
  }

  @override
  void dispose() {
    _clock.cancel();
    clock.dispose();
    _toastTimer?.cancel();
    sheet.dispose();
    attendance.dispose();
    super.dispose();
  }
}
