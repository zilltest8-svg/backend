/// History in Firestore. One document per stored day, under the owner:
///
///     users/{owner}/days/{YYYY-MM-DD}
///       sessions:    [{id, in, out}]   the punches of that day
///       at:          int               midnight of the day, UTC ms
///       savedAt:     int               when the punches were last written
///       submittedAt: int?              when the day was signed off
///       updatedAt:   server timestamp
///
/// The store is a mirror of what `AppState` holds in memory: every change the
/// app makes is written through as a per-day set or delete, and every change
/// that lands from elsewhere (another device, the console) comes back through
/// the snapshot listener. Nothing here knows about the UI.
library;

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import '../core/time.dart';
import '../core/types.dart';

/// One day as it is stored in the cloud.
class CloudDay {
  const CloudDay({required this.key, required this.sessions, required this.stamp});

  final String key;
  final List<Session> sessions;
  final DayStamp stamp;

  /// A fingerprint of everything that is written, so unchanged days are not
  /// rewritten and days that come back unchanged are not re-applied.
  String get signature {
    final punches = [for (final s in sessions) '${s.id}:${s.inAt}-${s.out ?? 'open'}'].join('|');
    return '$punches#${stamp.savedAt}#${stamp.submittedAt ?? ''}';
  }

  Map<String, dynamic> toDoc() => {
    'sessions': [for (final s in sessions) s.toJson()],
    'at': sessions.isEmpty ? (startOfDayKey(key) ?? 0) : startOfDay(sessions.first.inAt),
    'savedAt': stamp.savedAt,
    'submittedAt': stamp.submittedAt,
    'updatedAt': FieldValue.serverTimestamp(),
  };

  static CloudDay? fromDoc(String key, Map<String, dynamic> data) {
    final raw = data['sessions'];
    final sessions = raw is List ? [for (final s in raw) ?Session.fromJson(s)] : <Session>[];
    if (sessions.isEmpty) return null;
    sessions.sort((a, b) => a.inAt.compareTo(b.inAt));
    final saved = data['savedAt'];
    final submitted = data['submittedAt'];
    return CloudDay(
      key: key,
      sessions: sessions,
      stamp: DayStamp(
        savedAt: saved is num ? saved.toInt() : (sessions.last.out ?? sessions.last.inAt),
        submittedAt: submitted is num ? submitted.toInt() : null,
      ),
    );
  }
}

/// Split the app's flat session list and per-day stamps into cloud days.
Map<String, CloudDay> cloudDaysOf(List<Session> sessions, DayMeta meta) {
  final byDay = <String, List<Session>>{};
  for (final s in [...sessions]..sort((a, b) => a.inAt.compareTo(b.inAt))) {
    byDay.putIfAbsent(dayKey(s.inAt), () => []).add(s);
  }
  return {
    for (final e in byDay.entries)
      e.key: CloudDay(
        key: e.key,
        sessions: e.value,
        stamp: meta[e.key] ?? DayStamp(savedAt: e.value.last.out ?? e.value.last.inAt),
      ),
  };
}

/// What a snapshot from the cloud looks like to the app.
class CloudSnapshot {
  const CloudSnapshot({required this.days, required this.first, required this.fromCache});

  /// Every day the owner has stored, keyed by `YYYY-MM-DD`.
  final Map<String, CloudDay> days;

  /// The first snapshot after attaching. Local days missing from it are pushed
  /// up rather than treated as deleted elsewhere.
  final bool first;

  /// Served from the local cache; the server has not been reached yet.
  final bool fromCache;
}

/// Everything about the owner that is not a day: `users/{owner}` itself.
///
///     settings: {target, free}
///     sheet:    {url, id, file}   the Google Drive connection and its last export
class CloudProfile {
  const CloudProfile({required this.data, required this.exists, required this.first});

  final Map<String, dynamic> data;

  /// False when the owner has no profile in the cloud yet.
  final bool exists;

  /// The first snapshot after attaching.
  final bool first;
}

class CloudHistory {
  CloudHistory(this._db);

  final FirebaseFirestore _db;

  String? _owner;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _sub;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _profileSub;
  bool _first = true;

  /// What the cloud last agreed with, per day, so writes are diffs.
  final Map<String, String> _synced = {};

  /// The profile as last written or received, so unchanged profiles are not rewritten.
  String? _profileSynced;

  String? get owner => _owner;

  DocumentReference<Map<String, dynamic>> _profile(String owner) => _db.collection('users').doc(owner);

  CollectionReference<Map<String, dynamic>> _days(String owner) => _profile(owner).collection('days');

  /// The one thing about the profile that matters for diffing: its content, in a fixed order.
  static String _fingerprint(Map<String, dynamic> data) {
    final keys = data.keys.toList()..sort();
    return [for (final k in keys) '$k=${data[k]}'].join(';');
  }

  /// Firestore document ids may not contain `/`; an email is otherwise fine.
  static String ownerId(String raw) => raw.trim().toLowerCase().replaceAll('/', '_');

  /// Start mirroring `owner`'s history. The listener fires with the full set
  /// of days on every change, local or remote.
  void attach(
    String owner,
    void Function(CloudSnapshot snap) onSnapshot,
    void Function(Object error) onError, {
    void Function(CloudProfile profile)? onProfile,
  }) {
    if (owner == _owner) return;
    detach();
    _owner = owner;
    _first = true;
    if (onProfile != null) {
      var firstProfile = true;
      _profileSub = _profile(owner).snapshots().listen((doc) {
        final data = doc.data() ?? const {};
        final content = {for (final e in data.entries) if (e.key != 'updatedAt') e.key: e.value};
        _profileSynced = doc.exists ? _fingerprint(content) : null;
        final first = firstProfile;
        firstProfile = false;
        onProfile(CloudProfile(data: content, exists: doc.exists, first: first));
      }, onError: onError);
    }
    // Data changes only: a metadata-only event (a pending write being
    // acknowledged) would rerun the whole merge for nothing.
    _sub = _days(owner).snapshots().listen((snap) {
      final days = <String, CloudDay>{};
      for (final doc in snap.docs) {
        final day = CloudDay.fromDoc(doc.id, doc.data());
        if (day != null) days[doc.id] = day;
      }
      // What the snapshot holds is what the cloud holds, our own pending
      // writes included — a write that is later refused surfaces as an error.
      _synced
        ..clear()
        ..addEntries(days.entries.map((e) => MapEntry(e.key, e.value.signature)));
      final first = _first;
      _first = false;
      onSnapshot(CloudSnapshot(days: days, first: first, fromCache: snap.metadata.isFromCache));
    }, onError: onError);
  }

  void detach() {
    unawaited(_sub?.cancel());
    unawaited(_profileSub?.cancel());
    _sub = null;
    _profileSub = null;
    _owner = null;
    _synced.clear();
    _profileSynced = null;
  }

  /// Write the profile if it differs from what the cloud holds.
  Future<void> pushProfile(Map<String, dynamic> data) async {
    final owner = _owner;
    if (owner == null) return;
    final print = _fingerprint(data);
    if (print == _profileSynced) return;
    _profileSynced = print;
    await _profile(owner).set({...data, 'updatedAt': FieldValue.serverTimestamp()}, SetOptions(merge: true));
  }

  /// Write the days that changed and delete the ones that are gone, in one batch.
  Future<void> push(Map<String, CloudDay> days) async {
    final owner = _owner;
    if (owner == null) return;
    final col = _days(owner);
    final batch = _db.batch();
    var writes = 0;
    for (final day in days.values) {
      if (_synced[day.key] == day.signature) continue;
      batch.set(col.doc(day.key), day.toDoc());
      _synced[day.key] = day.signature;
      writes++;
    }
    for (final key in _synced.keys.toList()) {
      if (days.containsKey(key)) continue;
      batch.delete(col.doc(key));
      _synced.remove(key);
      writes++;
    }
    if (writes > 0) await batch.commit();
  }

  /// Remove every day the owner has stored.
  Future<void> clear() async {
    final owner = _owner;
    if (owner == null) return;
    final all = await _days(owner).get();
    final batch = _db.batch();
    for (final doc in all.docs) {
      batch.delete(doc.reference);
    }
    batch.delete(_profile(owner));
    _synced.clear();
    _profileSynced = null;
    await batch.commit();
  }

  void dispose() => detach();
}
