import 'package:flutter/material.dart';

import '../core/compute.dart';
import '../core/time.dart';
import '../core/types.dart';
import '../core/verdict.dart';
import '../state/app_state.dart';
import '../state/attendance.dart';
import '../state/sheet.dart';
import 'dialogs.dart';
import 'layout.dart';
import 'theme.dart';
import 'visuals.dart';
import 'widgets.dart';

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    // The dashboard is nearly all running figures, so it follows the clock.
    return ValueListenableBuilder<int>(valueListenable: app.clock, builder: (context, _, _) => _build(context, app));
  }

  Widget _build(BuildContext context, AppState app) {
    final day = app.day;
    return Gap(
      children: [
        AttendancePanel(api: app.attendance, freeMinutes: app.settings.free, now: app.now),
        DayHero(day: day, target: app.settings.target, now: app.now),
        StatsStrip(
          day: day,
          saved: app.selected?.submittedAt != null,
          onSave: () => showDaySheet(context, app.selected?.key ?? dayKey(nowMs())),
        ),
        Cols(
          main: SessionTable(
            day: day,
            sheet: app.sheet,
            onDelete: app.deleteSession,
            onAdd: () => showSessionModal(context),
          ),
          side: Efficiency(day: day),
        ),
        StatusBar(day: day, target: app.settings.target),
      ],
    );
  }
}

/* --------------------------------------------------------------- attendance */

class _Cell {
  const _Cell(this.label, this.value, this.note, {this.tail, this.tone});

  final String label;
  final String value;
  final String? tail;
  final String note;
  final Color? tone;
}

/// The live HR panel: sign-in, the device sync, and today's numbers straight
/// from the API.
class AttendancePanel extends StatefulWidget {
  const AttendancePanel({super.key, required this.api, required this.freeMinutes, required this.now});

  final AttendanceController api;

  /// The user's own free-break allowance, from Settings.
  final int freeMinutes;

  final int now;

  @override
  State<AttendancePanel> createState() => _AttendancePanelState();
}

class _AttendancePanelState extends State<AttendancePanel> {
  @override
  void initState() {
    super.initState();
    _maybeAsk();
  }

  @override
  void didUpdateWidget(AttendancePanel old) {
    super.didUpdateWidget(old);
    _maybeAsk();
  }

  /// Opening the screen while signed out puts the dialog up on its own;
  /// dismissing it leaves the prompt below, so there is always a way back in.
  void _maybeAsk() {
    final api = widget.api;
    if (api.auth != AuthState.signedOut || api.askedLogin) return;
    api.askedLogin = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) showHrLogin(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    final api = widget.api;

    if (api.auth == AuthState.checking) {
      return const AppCard(child: Lead('Checking your HR session…'));
    }
    if (api.auth != AuthState.signedIn) {
      return AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const H2(
              'Sign in to see your attendance',
              leading: IconTile(Icons.timer_outlined, tone: TileTone.violet, small: true),
            ),
            const SizedBox(height: 6),
            const Lead(
              'This panel reads live from the HR API rather than your stored punches, so it needs your work login.',
            ),
            const SizedBox(height: 16),
            Btn('Sign in to HR', icon: Icons.login, kind: BtnKind.primary, onPressed: () => showHrLogin(context)),
          ],
        ),
      );
    }

    // The punches from my-today go through the same calculator as the rest of the
    // app, so worked, break, remaining and the exit time are one implementation.
    //
    // `free` comes from Settings, NOT from the API's `break_minutes` — that field
    // measures the break actually taken (it equals the gap between the punches),
    // and feeding a measurement in as an allowance would forgive every break and
    // pull the exit time earlier by exactly the length of it.
    final settings = Settings(target: api.today?.targetMinutes ?? 480, free: widget.freeMinutes);
    final day = computeDay(api.today?.sessions ?? const [], settings, widget.now);
    final cells = _cells(day, settings);
    final sync = api.sync;
    final problem = api.error ?? api.syncError;

    return Gap(
      children: [
        Wrap(
          alignment: WrapAlignment.spaceBetween,
          crossAxisAlignment: WrapCrossAlignment.end,
          spacing: 16,
          runSpacing: 12,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                const H2(
                  'Live attendance',
                  leading: IconTile(Icons.timer_outlined, tone: TileTone.violet, small: true),
                ),
                const SizedBox(height: 6),
                Text(
                  [
                    api.user?.name ?? api.user?.email ?? 'Signed in',
                    if (api.today?.status != null) api.today!.status!,
                    if (api.fetchedAt != null) 'updated ${clockShort(api.fetchedAt)}',
                  ].join(' · '),
                  style: t(12, color: C.muted),
                ),
              ],
            ),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.end,
              spacing: 10,
              runSpacing: 10,
              children: [
                _RangeField(
                  label: 'Sync from',
                  value: api.startDate,
                  max: api.endDate,
                  onChanged: (v) => api.setRange(v, api.endDate),
                ),
                _RangeField(
                  label: 'To',
                  value: api.endDate,
                  min: api.startDate,
                  onChanged: (v) => api.setRange(api.startDate, v),
                ),
                Btn(
                  api.syncing ? 'Syncing…' : 'Sync now',
                  icon: Icons.timer_outlined,
                  kind: BtnKind.primary,
                  small: true,
                  tooltip: 'Do not wait for the next automatic sync — pull ${api.startDate} to ${api.endDate} now',
                  onPressed: api.syncing ? null : api.startSync,
                ),
                Btn('Sign out', kind: BtnKind.ghost, small: true, onPressed: api.signOut),
              ],
            ),
          ],
        ),
        _NextSyncBar(api: api, now: widget.now),
        if (problem != null)
          Preview(
            tone: Tone.error,
            tail: LinkBtn('Try again', onPressed: api.refresh),
            children: [
              Text(
                problem,
                style: t(12, color: C.red, weight: FontWeight.w700),
              ),
            ],
          ),
        // What the last device pull reported — but only when it found something or
        // went wrong. A sync runs every minute, and "added 0 records" sixty times
        // an hour is noise.
        if (sync != null && api.syncError == null && (sync.status != 'completed' || sync.newRecords > 0))
          Preview(
            tone: sync.status == 'completed' ? Tone.ok : Tone.warn,
            tail: Text('synced ${clockShort(sync.at)}', style: t(12, color: C.muted)),
            children: [
              Text(sync.message, style: const TextStyle(fontWeight: FontWeight.w700)),
              Text(
                sync.rangeStart == sync.rangeEnd ? sync.rangeStart : '${sync.rangeStart} → ${sync.rangeEnd}',
                style: m(11, color: C.dim),
              ),
              if (sync.devices.isNotEmpty)
                Text(
                  [for (final d in sync.devices) '${d.name}: ${d.totalRecords} read, ${d.newRecords} new'].join(' · '),
                  style: m(11, color: C.dim),
                ),
            ],
          ),
        AutoGrid(
          minWidth: 210,
          children: [
            for (final (i, c) in cells.indexed)
              Entrance(
                delay: 0.05 * i,
                dy: 10,
                ms: 400,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 16),
                  decoration: raised(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Kicker(c.label, spacing: 1.6),
                      const SizedBox(height: 10),
                      ValueWithTail(
                        api.loading && api.today == null ? '…' : c.value,
                        tail: api.loading && api.today == null ? null : c.tail,
                        tailScale: 0.55,
                        style: t(26, color: c.tone ?? C.ink, weight: FontWeight.w600, spacing: -0.6, height: 1.2),
                      ),
                      const SizedBox(height: 7),
                      Text(c.note, style: t(11.5, color: C.muted)),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }

  List<_Cell> _cells(DayResult day, Settings settings) {
    final api = widget.api;
    final now = widget.now;
    final running = day.status == DayStatus.working;
    final onBreak = day.status == DayStatus.onBreak;
    final open = day.sessions.where((s) => s.out == null).firstOrNull;
    final target = settings.target * kMin;
    String seconds(num ms) => '${p2((ms.abs() ~/ 1000) % 60)}s';

    // Straight off the response's earliest punch_in, not the store.
    final first = (day.first == null ? '--:--' : clockTime(day.first)).split(' ');
    final slipping = !day.reached && day.leave != null && onBreak && day.billableBreak > 0;

    return [
      _Cell(
        'First in',
        first.first,
        day.first == null
            ? 'not punched in yet'
            : '${day.sessions.length} punch${day.sessions.length == 1 ? '' : 'es'} today',
        tail: first.length > 1 ? first[1] : null,
      ),
      _Cell(
        'Today',
        api.today == null ? '--' : hoursMinutes(day.worked),
        api.today == null
            ? 'nothing loaded yet'
            : 'of ${hoursMinutes(target)}${open != null ? ' · running ${hoursMinutes(now - open.inAt)}' : ''}',
        // A still tail reads as a stopped clock, so it only shows while moving.
        tail: api.today != null && running ? seconds(day.worked) : null,
        tone: day.reached ? C.green : null,
      ),
      _Cell(
        'Target ETA',
        day.reached
            ? 'Met'
            : day.leave != null
            ? clock24(day.leave!)
            : '--:--',
        day.reached
            ? '${hoursMinutes(day.overtime)} over'
            : day.leave == null
            ? 'not punched in'
            : running
            ? 'if working'
            : onBreak
            ? (day.billableBreak > 0
                  ? 'on break — slipping'
                  : 'on break — ${hoursMinutes(settings.free * kMin - day.breakMs)} free left')
            : 'punched out',
        // The exit second only moves while a break is actually pushing it back.
        tail: slipping ? ':${p2(ist(day.leave!).second)}' : null,
        tone: day.reached ? C.green : null,
      ),
      _Cell(
        'Pace',
        day.reached
            ? '+${human(day.overtime)}'
            : day.remaining > 0
            ? '-${human(day.remaining)}'
            : '0',
        day.reached
            ? 'target met'
            : day.sessions.isEmpty
            ? 'no punches today'
            : '${human(day.remaining)} still owed',
        tail: !running
            ? null
            : day.reached
            ? seconds(day.overtime)
            : day.remaining > 0
            ? seconds(day.remaining)
            : null,
        tone: day.reached
            ? C.green
            : day.remaining > 0
            ? C.red
            : null,
      ),
      _Cell(
        'Break',
        hoursMinutes(day.breakMs),
        // The API reports its own break total; showing it next to the one derived
        // from the gaps makes a disagreement obvious instead of silent.
        api.today != null
            ? 'HR says ${api.today!.breakMinutes}m${settings.free > 0 ? ' · ${settings.free}m free' : ' · all of it pushes exit'}'
            : settings.free > 0
            ? '${settings.free}m free · rest pushes exit'
            : 'every minute pushes exit',
        tail: onBreak ? seconds(day.breakMs) : null,
      ),
    ];
  }
}

class _RangeField extends StatelessWidget {
  const _RangeField({required this.label, required this.value, required this.onChanged, this.min, this.max});

  final String label;
  final String value;
  final String? min;
  final String? max;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 148,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        FieldLabel(label),
        DateField(value: value, min: min, max: max, dense: true, onChanged: onChanged),
      ],
    ),
  );
}

/// How long until the next automatic sync, as a bar that fills over the minute
/// and starts again when the HR API has been called.
class _NextSyncBar extends StatelessWidget {
  const _NextSyncBar({required this.api, required this.now});

  final AttendanceController api;
  final int now;

  @override
  Widget build(BuildContext context) {
    final every = autoSync.inMilliseconds;
    final left = ((api.nextSyncAt ?? now) - now).clamp(0, every);
    final busy = api.syncing || api.loading;
    final filled = busy ? 1.0 : 1 - left / every;

    return Row(
      children: [
        Pulse(on: busy, child: const Dot(Colors.white, size: 6)),
        const SizedBox(width: 8),
        SizedBox(
          width: 118,
          child: Text(busy ? 'Syncing…' : 'Next sync in ${(left / 1000).ceil()}s', style: m(11, color: C.dim)),
        ),
        Expanded(
          child: Container(
            height: 8,
            padding: const EdgeInsets.all(1.5),
            decoration: sunken(radius: 999),
            // Eased between the once-a-second values, so the bar glides rather
            // than stepping — and drops back quickly when a new minute starts.
            child: TweenAnimationBuilder<double>(
              tween: Tween(end: filled),
              duration: Duration(milliseconds: filled < 0.05 ? 250 : 1000),
              curve: Curves.linear,
              builder: (context, v, _) => Align(
                alignment: Alignment.centerLeft,
                child: FractionallySizedBox(
                  widthFactor: v.clamp(0.0, 1.0),
                  child: Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(999),
                      gradient: const LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Colors.white, Color(0xFF9A9A9A)],
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

/* --------------------------------------------------------------------- hero */

/// The timer card, the date and the exit time. (`Hero` is Flutter's own.)
class DayHero extends StatelessWidget {
  const DayHero({super.key, required this.day, required this.target, required this.now});

  final DayResult day;
  final int target;
  final int now;

  @override
  Widget build(BuildContext context) {
    final hasData = day.sessions.isNotEmpty;
    final live = hasData && !day.stale;
    final past = hasData && day.stale;
    final viewing = day.first ?? now;
    final pct = (day.frac * 100).round();
    // Punched out is its own thing: nothing is running, so the thread must not
    // travel as though it were.
    final tone = !hasData
        ? DayTone.idle
        : day.reached
        ? DayTone.done
        : day.status == DayStatus.onBreak
        ? DayTone.onBreak
        : day.status == DayStatus.out
        ? DayTone.idle
        : DayTone.working;

    final (label, chipTone) = switch (day.status) {
      DayStatus.working => ('Working', ChipTone.green),
      DayStatus.onBreak => ('On break · ${human(day.liveBreak)}', ChipTone.amber),
      DayStatus.out => ('Punched out', ChipTone.blue),
      DayStatus.empty => ('No data', ChipTone.muted),
    };

    final goal = hms(day.officeGoal);
    final sub = !hasData
        ? [TextSpan(text: "of $goal goal  •  add today's punches to start")]
        : day.reached
        ? [
            TextSpan(text: 'goal $goal reached  •  '),
            TextSpan(
              text: '+${human(day.office - day.officeGoal)} extra',
              style: t(12, color: C.dim, weight: FontWeight.w500),
            ),
          ]
        : [
            TextSpan(text: 'of $goal goal  •  '),
            TextSpan(
              text: '${hms(day.officeGoal - day.office)} still to work',
              style: t(12, color: C.dim, weight: FontWeight.w500),
            ),
          ];

    final timer = Entrance(
      child: AppCard(
        clip: true,
        padding: EdgeInsets.zero,
        child: Stack(
          children: [
            Padding(
              padding: const EdgeInsets.all(18),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  CardHead(
                    title: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.schedule, size: 15, color: C.dim),
                        const SizedBox(width: 9),
                        const Kicker('Time in office', size: 11, spacing: 1.4),
                      ],
                    ),
                    trailing: live
                        ? const StatusChip('LIVE', tone: ChipTone.green, dot: true, pulse: true)
                        : past
                        ? const StatusChip('Stored')
                        : null,
                  ),
                  const SizedBox(height: 14),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 22,
                    runSpacing: 14,
                    children: [
                      TimerRing(value: day.frac, tone: tone, live: live && day.status == DayStatus.working),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Counter(parts: hmsParts(day.office), done: day.reached && hasData),
                          const SizedBox(height: 7),
                          Text.rich(
                            TextSpan(children: sub),
                            style: t(12, color: C.muted),
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(999),
                    child: SizedBox(
                      height: 5,
                      child: TweenAnimationBuilder<double>(
                        tween: Tween(end: day.frac.clamp(0, 1).toDouble()),
                        duration: const Duration(milliseconds: 600),
                        curve: ease,
                        builder: (context, v, _) => LinearProgressIndicator(
                          value: v,
                          backgroundColor: C.raised,
                          color: day.reached ? C.green : C.ink,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 7),
                  Text('$pct%', style: m(11, color: C.muted)),
                  const SizedBox(height: 14),
                  Center(
                    child: StatusChip(
                      label,
                      tone: chipTone,
                      dot: true,
                      pulse: day.status == DayStatus.working || day.status == DayStatus.onBreak,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );

    final side = Gap(
      children: [
        Entrance(
          delay: 0.05,
          child: AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.calendar_today_outlined, size: 14, color: C.dim),
                    const SizedBox(width: 8),
                    Kicker(weekday(viewing), spacing: 1.6),
                  ],
                ),
                const SizedBox(height: 10),
                Text(dateLabel(viewing), style: t(22, weight: FontWeight.w600, spacing: -0.4)),
                const SizedBox(height: 6),
                Text(past ? 'stored day • IST' : 'IST • UTC +05:30', style: t(11.5, color: C.muted)),
                const SizedBox(height: 2),
                Text(past ? 'now ${clockShort(now)}' : clockWithSeconds(now), style: m(11.5, color: C.muted)),
              ],
            ),
          ),
        ),
        if (hasData && day.leave != null)
          Entrance(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 20),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: C.green.withValues(alpha: 0.35)),
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [C.green.withValues(alpha: 0.09), C.green.withValues(alpha: 0.03)],
                ),
              ),
              child: Column(
                children: [
                  Text(
                    'You can leave at',
                    style: t(12, color: C.green, weight: FontWeight.w600, spacing: 0.3),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    clockShort(day.leave),
                    style: t(34, color: C.green, weight: FontWeight.w600, spacing: -0.6, height: 1.2),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${hm(target * kMin)} work  •  ${hm(day.billableBreak)} break  •  from ${clockTime(day.first)}',
                    textAlign: TextAlign.center,
                    style: t(11, color: C.muted),
                  ),
                ],
              ),
            ),
          ),
      ],
    );

    return Cols(main: timer, side: side);
  }
}

/* -------------------------------------------------------------------- stats */

class StatsStrip extends StatelessWidget {
  const StatsStrip({super.key, required this.day, required this.onSave, required this.saved});

  final DayResult day;

  /// Opens the day sheet, where the day is checked over and signed off.
  final VoidCallback onSave;

  /// True once that day has been submitted, so the button says so.
  final bool saved;

  @override
  Widget build(BuildContext context) => AutoGrid(
    minWidth: 150,
    children: [
      // Worked, Break, Remaining and First in are all in the HR panel at the
      // top, so this row is down to what is only here: overtime once there is
      // any, and the button into the day sheet.
      if (day.overtime > 0)
        Entrance(
          dy: 10,
          ms: 400,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            decoration: raised(),
            child: Row(
              children: [
                const IconTile(Icons.star_outline, tone: TileTone.red),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Overtime', style: t(11.5, color: C.dim)),
                    Text(hm(day.overtime), style: t(24, weight: FontWeight.w600, spacing: -0.4)),
                    Text('hours', style: t(11, color: C.muted)),
                  ],
                ),
              ],
            ),
          ),
        ),
      Entrance(
        dy: 10,
        ms: 400,
        delay: day.overtime > 0 ? 0.05 : 0,
        child: Btn(
          saved ? 'Saved — edit day' : 'Add to History',
          icon: saved ? Icons.check : Icons.table_chart_outlined,
          wide: true,
          onPressed: day.sessions.isEmpty ? null : onSave,
        ),
      ),
    ],
  );
}

/* ----------------------------------------------------------------- sessions */

/// "Session 2" / "Break 1", numbered in the order they happened.
List<(Block, String)> numbered(List<Block> blocks) {
  var work = 0;
  var brk = 0;
  return [for (final b in blocks) (b, b.isWork ? 'Session ${work += 1}' : 'Break ${brk += 1}')];
}

class SessionTable extends StatelessWidget {
  const SessionTable({super.key, required this.day, required this.onDelete, required this.onAdd, required this.sheet});

  final DayResult day;
  final ValueChanged<String> onDelete;
  final VoidCallback onAdd;
  final SheetController sheet;

  @override
  Widget build(BuildContext context) {
    final rows = numbered(day.blocks);
    return Entrance(
      delay: 0.08,
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            CardHead(
              title: const H2('Sessions & Breaks'),
              trailing: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Btn('Add Manual', icon: Icons.add, kind: BtnKind.ghost, small: true, onPressed: onAdd),
                  const SizedBox(width: 8),
                  DriveButton(sheet: sheet, label: 'Save Day'),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
              child: _SessionGrid(
                type: Text('Type', style: _headStyle),
                start: Text('In / Start', style: _headStyle),
                end: Text('Out / End', style: _headStyle),
                length: Text('Duration', textAlign: TextAlign.right, style: _headStyle),
                menu: const SizedBox.shrink(),
              ),
            ),
            const Divider(height: 1, color: C.line2),
            const SizedBox(height: 8),
            if (rows.isEmpty)
              const EmptyRow('No sessions yet — they arrive with the next HR sync, or add one manually.'),
            for (final (i, (block, caption)) in rows.indexed)
              Padding(
                key: ValueKey('${block.kind}-${block.from}'),
                padding: const EdgeInsets.only(bottom: 6),
                child: Entrance(
                  dx: -10,
                  dy: 0,
                  ms: 280,
                  delay: (i * 0.04).clamp(0, 0.2).toDouble(),
                  child: _SessionRow(block: block, caption: caption, ticking: !day.stale, onDelete: onDelete),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

final _headStyle = t(11, color: C.muted, weight: FontWeight.w600);

/// The table's five columns, shared by the header and every row.
class _SessionGrid extends StatelessWidget {
  const _SessionGrid({
    required this.type,
    required this.start,
    required this.end,
    required this.length,
    required this.menu,
  });

  final Widget type;
  final Widget start;
  final Widget end;
  final Widget length;
  final Widget menu;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(flex: 15, child: type),
      const SizedBox(width: 10),
      Expanded(flex: 10, child: start),
      const SizedBox(width: 10),
      Expanded(flex: 10, child: end),
      const SizedBox(width: 10),
      Expanded(flex: 8, child: length),
      const SizedBox(width: 10),
      SizedBox(width: 26, child: menu),
    ],
  );
}

class _SessionRow extends StatelessWidget {
  const _SessionRow({required this.block, required this.caption, required this.ticking, required this.onDelete});

  final Block block;
  final String caption;
  final bool ticking;
  final ValueChanged<String> onDelete;

  @override
  Widget build(BuildContext context) {
    final isBreak = !block.isWork;
    final tint = isBreak ? C.amber : C.dim;
    final length = block.to - block.from;

    return Container(
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: isBreak
            ? C.amber.withValues(alpha: 0.06)
            : block.live
            ? const Color(0xFF1D1D22)
            : C.card2,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: block.live && !isBreak ? const Color(0xFF3A3A44) : Colors.transparent),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(width: 3, color: isBreak ? C.amber : Colors.transparent),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(9, 11, 12, 11),
                child: _SessionGrid(
                  type: Row(
                    children: [
                      Dot(isBreak ? C.amber : C.green),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(
                                    isBreak ? 'Break' : 'Work',
                                    overflow: TextOverflow.ellipsis,
                                    style: t(13, color: isBreak ? C.amber : C.ink, weight: FontWeight.w600),
                                  ),
                                ),
                                if (block.live) ...[
                                  const SizedBox(width: 7),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                    decoration: BoxDecoration(color: C.raised, borderRadius: BorderRadius.circular(5)),
                                    child: Text('LIVE', style: t(9, weight: FontWeight.w700, spacing: 0.6)),
                                  ),
                                ],
                              ],
                            ),
                            Text(caption, style: t(11, color: C.muted)),
                          ],
                        ),
                      ),
                    ],
                  ),
                  start: Text(clockTime(block.from), style: m(12, color: tint)),
                  end: block.live
                      ? Pulse(
                          low: 0.45,
                          ms: 1800,
                          child: Text(
                            'Running',
                            style: m(12, color: C.green, weight: FontWeight.w600),
                          ),
                        )
                      : Text(clockTime(block.to), style: m(12, color: tint)),
                  length: Text(
                    block.live && ticking ? hms(length) : hm(length),
                    textAlign: TextAlign.right,
                    style: m(12, color: isBreak ? C.amber : C.ink),
                  ),
                  menu: block.sessionId == null
                      ? const SizedBox.shrink()
                      : PopupMenuButton<String>(
                          tooltip: 'Row actions',
                          padding: EdgeInsets.zero,
                          color: C.card2,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                            side: const BorderSide(color: C.line),
                          ),
                          onSelected: onDelete,
                          itemBuilder: (context) => [
                            PopupMenuItem(
                              value: block.sessionId,
                              height: 36,
                              child: Text(
                                'Remove session',
                                style: t(12, color: C.red, weight: FontWeight.w600),
                              ),
                            ),
                          ],
                          child: const Icon(Icons.more_vert, size: 16, color: C.muted),
                        ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Saves the day to Drive. If nothing is connected yet it opens the shared setup
/// dialog instead of failing, so the button is never a dead end.
class DriveButton extends StatefulWidget {
  const DriveButton({super.key, required this.sheet, required this.label});

  final SheetController sheet;
  final String label;

  @override
  State<DriveButton> createState() => _DriveButtonState();
}

class _DriveButtonState extends State<DriveButton> {
  bool _done = false;

  Future<void> _click() async {
    final sheet = widget.sheet;
    if (!sheet.configured) return sheet.openSetup();
    if (!await sheet.saveToDrive() || !mounted) return;
    setState(() => _done = true);
    await Future<void>.delayed(const Duration(seconds: 2));
    if (mounted) setState(() => _done = false);
  }

  @override
  Widget build(BuildContext context) {
    final sheet = widget.sheet;
    return Btn(
      _done
          ? 'Saved to Drive'
          : sheet.sending
          ? 'Saving…'
          : widget.label,
      icon: _done
          ? Icons.check
          : sheet.sending
          ? null
          : Icons.save_outlined,
      kind: _done ? BtnKind.done : BtnKind.normal,
      small: true,
      tooltip: sheet.configured ? 'Save this day as a CSV in your Drive' : 'Connect Google Drive',
      onPressed: sheet.empty || sheet.sending ? null : _click,
    );
  }
}

/* --------------------------------------------------------------- efficiency */

class Efficiency extends StatelessWidget {
  const Efficiency({super.key, required this.day});

  final DayResult day;

  @override
  Widget build(BuildContext context) => Entrance(
    delay: 0.1,
    child: AppCard(
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Efficiency', style: t(12, color: C.dim)),
                const SizedBox(height: 6),
                Text(
                  '${(day.efficiency * 100).round()}%',
                  style: t(40, color: C.green, weight: FontWeight.w700, spacing: -1.5, height: 1.1),
                ),
                const SizedBox(height: 4),
                Text('of goal achieved', style: t(11.5, color: C.muted)),
              ],
            ),
          ),
          Donut(value: day.efficiency),
        ],
      ),
    ),
  );
}

/* --------------------------------------------------------------- status bar */

class StatusBar extends StatelessWidget {
  const StatusBar({super.key, required this.day, required this.target});

  final DayResult day;
  final int target;

  @override
  Widget build(BuildContext context) {
    final v = verdict(day, target);
    final color = Preview.toneColor(v.tone);
    final idle = v.tone == Tone.idle;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 13),
      decoration: BoxDecoration(
        color: idle ? Colors.white.withValues(alpha: 0.03) : color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: idle ? C.line : color.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(v.tone == Tone.ok ? Icons.check_circle_outline : Icons.info_outline, size: 16, color: color),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              v.text,
              style: t(12.5, color: color, weight: FontWeight.w500),
            ),
          ),
        ],
      ),
    );
  }
}
