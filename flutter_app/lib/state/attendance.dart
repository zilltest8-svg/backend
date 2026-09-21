/// State for the live attendance panel: who is signed in, today's punches, and
/// the device sync. Deliberately separate from the store — this data is fetched
/// live from the HR API and is never written to storage.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/time.dart';
import 'attendance_api.dart';

enum AuthState { checking, signedOut, signingIn, signedIn }

/// How often the HR API is called while signed in. A device pull is real work
/// on the HR side, so this is a minute rather than the second the clock ticks
/// at — the punch data it would find does not change faster than that anyway.
const autoSync = Duration(seconds: 60);

class AttendanceController extends ChangeNotifier {
  AttendanceController({
    required String Function() proxyBase,
    required this.say,
    required this.onFetched,
    String? session,
    void Function(String? session)? onSession,
  }) : _client = AttendanceClient(proxyBase, cookie: session, onCookie: onSession) {
    final today = dayKey(nowMs());
    startDate = today;
    endDate = today;
  }

  final AttendanceClient _client;

  /// Surfaces the sync result as a toast, so the outcome is never silent.
  final void Function(String text, bool ok) say;

  /// Every successful fetch, so the store can take the punches in.
  final void Function(TodayReport report) onFetched;

  AuthState auth = AuthState.checking;

  /// The sign-in dialog puts itself up once when the app finds itself signed
  /// out. Kept here rather than on the panel, which is rebuilt on every visit
  /// to the dashboard and would otherwise ask again each time.
  bool askedLogin = false;
  HrUser? user;

  /// Sign-in failure, shown on the login dialog.
  String? authError;

  /// The range Sync pulls from the punch devices — not what today shows.
  late String startDate;
  late String endDate;
  TodayReport? today;
  bool loading = false;

  /// Fetch failure, shown on the panel.
  String? error;

  /// When the punches on screen came back.
  int? fetchedAt;

  /// Last device pull, or null until Sync is pressed.
  SyncResult? sync;
  bool syncing = false;
  String? syncError;

  /// When the next automatic sync is due, for the countdown on the panel.
  int? nextSyncAt;

  Timer? _poll;

  /// Until a range is picked by hand it means "today", and has to keep meaning
  /// that when the app is left open past midnight.
  bool _rangePicked = false;

  /// Guards against a slow response overwriting a newer one.
  int _requestId = 0;

  /// The proxy holds the session in a cookie, so a restart has to ask whether it
  /// is still valid rather than reading it.
  Future<void> start() async {
    try {
      final s = await _client.checkSession();
      user = s.user;
      _setAuth(s.authenticated ? AuthState.signedIn : AuthState.signedOut);
    } catch (_) {
      // A proxy that is down is indistinguishable from being signed out, and
      // showing the login form is the useful answer either way.
      _setAuth(AuthState.signedOut);
    }
  }

  void _setAuth(AuthState next) {
    auth = next;
    notifyListeners();
    _updatePolling();
  }

  /// True when the failure means the session is gone, so the caller can stop.
  bool _handleFailure(Object err) {
    if (err is! AttendanceError || !err.unauthenticated) return false;
    user = null;
    today = null;
    sync = null;
    loading = false;
    syncing = false;
    error = null;
    syncError = null;
    _setAuth(AuthState.signedOut);
    return true;
  }

  Future<void> _load() async {
    final id = ++_requestId;
    loading = true;
    error = null;
    notifyListeners();
    try {
      final report = await _client.fetchToday();
      if (id != _requestId) return;
      today = report;
      loading = false;
      error = null;
      fetchedAt = nowMs();
      notifyListeners();
      onFetched(report);
    } catch (err) {
      if (id != _requestId) return;
      if (_handleFailure(err)) return;
      loading = false;
      error = err is AttendanceError ? err.message : "Could not load today's punches.";
      notifyListeners();
    }
  }

  Future<void> signIn(String email, String password) async {
    authError = null;
    _setAuth(AuthState.signingIn);
    try {
      user = await _client.login(email, password);
      authError = null;
      askedLogin = false; // so an expired session, hours on, does prompt
      _setAuth(AuthState.signedIn);
    } catch (err) {
      authError = err is AttendanceError ? err.message : 'Sign-in failed.';
      _setAuth(AuthState.signedOut);
    }
  }

  Future<void> signOut() async {
    try {
      await _client.logout();
    } catch (_) {
      // Signing out locally still holds when the proxy could not be told.
    }
    // Signing out on purpose is not a reason to be asked to sign straight back in.
    askedLogin = true;
    _requestId++; // abandon anything in flight
    user = null;
    today = null;
    sync = null;
    error = null;
    authError = null;
    syncError = null;
    fetchedAt = null;
    _setAuth(AuthState.signedOut);
  }

  void setRange(String start, String end) {
    _rangePicked = true;
    startDate = start;
    endDate = end;
    notifyListeners();
  }

  void refresh() {
    if (auth == AuthState.signedIn) unawaited(_load());
  }

  /// `quiet` skips the toast — an automatic sync every minute should not shout.
  Future<void> _sync(bool quiet) async {
    if (auth != AuthState.signedIn || syncing) return;
    if (!_rangePicked) startDate = endDate = dayKey(nowMs());
    syncing = true;
    syncError = null;
    notifyListeners();
    try {
      final result = await _client.runSync(startDate, endDate);
      sync = result;
      if (!quiet) say(result.message, true);
      // A pull that added rows changes what my-today would answer, so read it
      // again rather than leaving the tiles on pre-sync numbers.
      await _load();
    } catch (err) {
      final message = err is AttendanceError ? err.message : 'Sync failed.';
      final signedOut = _handleFailure(err);
      if (!signedOut) syncError = message;
      // With a sync every minute, a toast per failure would never stop; the
      // strip on the panel carries it, and only a pressed button speaks up.
      if (!quiet || signedOut) say(message, false);
      // The device pull failing is no reason to show stale punches as well.
      if (!signedOut) await _load();
    } finally {
      // Always clears, whatever happened above. Leaving it true would disable
      // the button for good, and a disabled button looks exactly like a click
      // that did nothing.
      syncing = false;
      notifyListeners();
    }
  }

  /// Sync now, out of turn. Says what happened, unlike the automatic ones.
  void startSync() => unawaited(_sync(false));

  /// Signed in means polling: a sync straight away, then one every minute for
  /// as long as the app is open, whichever screen is showing.
  void _updatePolling() {
    final wanted = auth == AuthState.signedIn;
    if (wanted == (_poll != null)) return;
    _poll?.cancel();
    _poll = null;
    nextSyncAt = null;
    if (!wanted) return;
    void run() {
      nextSyncAt = nowMs() + autoSync.inMilliseconds;
      unawaited(_sync(true));
    }

    run();
    _poll = Timer.periodic(autoSync, (_) => run());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }
}
