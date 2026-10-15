/// A single punch pair. `out == null` means the session is still running.
class Session {
  const Session({required this.id, required this.inAt, this.out});

  final String id;
  final int inAt;
  final int? out;

  Session copyWith({int? inAt, int? out, bool clearOut = false}) =>
      Session(id: id, inAt: inAt ?? this.inAt, out: clearOut ? null : (out ?? this.out));

  /// Stored under the same `in` / `out` keys the first version of the app wrote.
  Map<String, dynamic> toJson() => {'id': id, 'in': inAt, 'out': out};

  static Session? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final at = raw['in'];
    if (at is! num) return null;
    final out = raw['out'];
    return Session(
      id: raw['id']?.toString() ?? 't${at.toInt()}',
      inAt: at.toInt(),
      out: out is num ? out.toInt() : null,
    );
  }
}

enum BlockKind { work, breakTime }

/// One contiguous stretch of the day — either worked or on break.
class Block {
  const Block({required this.kind, required this.from, required this.to, required this.live, this.sessionId});

  final BlockKind kind;
  final int from;
  final int to;
  final bool live;
  final String? sessionId;

  bool get isWork => kind == BlockKind.work;
}

class Settings {
  const Settings({this.target = 480, this.free = 0});

  /// Minutes of actual work owed (480 = 8h).
  final int target;

  /// Break minutes that do NOT push the exit time.
  final int free;

  Settings copyWith({int? target, int? free}) => Settings(target: target ?? this.target, free: free ?? this.free);

  Map<String, dynamic> toJson() => {'target': target, 'free': free};

  static Settings fromJson(Object? raw) {
    if (raw is! Map) return const Settings();
    final target = raw['target'];
    final free = raw['free'];
    return Settings(target: target is num ? target.round() : 480, free: free is num ? free.round() : 0);
  }
}

/// Which stored day the calculator is looking at.
class Filter {
  const Filter({this.month = 'all', this.day = 'latest'});

  /// `"all"`, or a `YYYY-MM` month key.
  final String month;

  /// `"latest"` (follow the newest stored day), or a `YYYY-MM-DD` day key.
  final String day;

  Filter copyWith({String? month, String? day}) => Filter(month: month ?? this.month, day: day ?? this.day);

  Map<String, dynamic> toJson() => {'month': month, 'day': day};

  static Filter fromJson(Object? raw) {
    if (raw is! Map) return const Filter();
    final month = raw['month'];
    final day = raw['day'];
    return Filter(month: month is String ? month : 'all', day: day is String ? day : 'latest');
  }
}

/// Per-day bookkeeping kept alongside the punches, keyed by `YYYY-MM-DD`.
/// `savedAt` is when those punches were last written; `submittedAt` is when the
/// day was signed off in the day sheet, and is dropped again if it changes after.
class DayStamp {
  const DayStamp({required this.savedAt, this.submittedAt});

  final int savedAt;
  final int? submittedAt;

  Map<String, dynamic> toJson() => {'savedAt': savedAt, if (submittedAt != null) 'submittedAt': submittedAt};

  static DayStamp? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final saved = raw['savedAt'];
    if (saved is! num) return null;
    final submitted = raw['submittedAt'];
    return DayStamp(savedAt: saved.toInt(), submittedAt: submitted is num ? submitted.toInt() : null);
  }
}

typedef DayMeta = Map<String, DayStamp>;

enum DayStatus { empty, working, onBreak, out }

class DayResult {
  const DayResult({
    required this.sessions,
    required this.blocks,
    required this.now,
    required this.first,
    required this.last,
    required this.worked,
    required this.breakMs,
    required this.billableBreak,
    required this.efficiency,
    required this.span,
    required this.elapsed,
    required this.office,
    required this.officeGoal,
    required this.frac,
    required this.leave,
    required this.remaining,
    required this.overtime,
    required this.reached,
    required this.status,
    required this.liveBreak,
    required this.stale,
  });

  final List<Session> sessions;
  final List<Block> blocks;

  /// Clock used for the maths — frozen at day-end when the data isn't today's.
  final int now;
  final int? first;
  final int? last;
  final int worked;
  final int breakMs;

  /// Break time that actually pushes the exit (total break minus any free allowance).
  final int billableBreak;

  /// Worked time as a share of the target, 0..1.
  final double efficiency;

  /// Time from the first punch-in until you may leave (target + billable break).
  final int span;

  /// Gross clock-to-clock window: first punch-in until now, breaks included.
  final int elapsed;

  /// Time actually in the office — `elapsed` with every break minute taken back out.
  final int office;

  /// What `office` has to reach before you may leave (`span` net of breaks).
  final int officeGoal;

  /// 0..1 progress around the ring — `office` against `officeGoal`.
  final double frac;
  final int? leave;
  final int remaining;
  final int overtime;
  final bool reached;
  final DayStatus status;
  final int liveBreak;

  /// True when the loaded data belongs to an earlier day.
  final bool stale;
}
