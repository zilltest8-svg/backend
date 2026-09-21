import 'package:flutter/material.dart';

import '../core/export.dart';
import '../core/history.dart';
import '../core/time.dart';
import '../core/types.dart';
import '../state/app_state.dart';
import '../state/sheet.dart';
import 'dashboard.dart' show Efficiency, numbered;
import 'dialogs.dart';
import 'layout.dart';
import 'theme.dart';
import 'visuals.dart';
import 'widgets.dart';

/* ----------------------------------------------------------------- insights */

/// Facts worth surfacing, all derived from the day rather than guessed at.
List<String> _insights(DayResult day) {
  final works = day.blocks.where((b) => b.isWork).toList();
  final breaks = day.blocks.where((b) => !b.isWork).toList();
  if (works.isEmpty) return ['Nothing loaded yet — add punches to see insights.'];

  Block longestOf(List<Block> list) => list.reduce((a, b) => b.to - b.from > a.to - a.from ? b : a);
  final longest = longestOf(works);
  final longestBreak = breaks.isEmpty ? null : longestOf(breaks);

  return [
    '${works.length} work session${works.length == 1 ? '' : 's'}, averaging ${human(day.worked / works.length)} each.',
    'Longest stretch ${hm(longest.to - longest.from)}, from ${clockTime(longest.from)}.',
    if (longestBreak != null)
      '${breaks.length} break${breaks.length == 1 ? '' : 's'} totalling ${hm(day.breakMs)}'
          ' — longest ${hm(longestBreak.to - longestBreak.from)} at ${clockTime(longestBreak.from)}.'
    else
      'No breaks taken on this day.',
    if (day.leave != null)
      day.reached
          ? 'Goal was met at ${clockShort(day.leave)}; that is ${human((day.elapsed - day.span).abs())} past it.'
          : 'Break time has pushed the exit ${human(day.billableBreak)} later, to ${clockShort(day.leave)}.',
    if (day.remaining > 0)
      '${hm(day.remaining)} of work still owed against the ${hm(day.span - day.billableBreak)} target.',
  ];
}

class InsightsPage extends StatefulWidget {
  const InsightsPage({super.key});

  @override
  State<InsightsPage> createState() => _InsightsPageState();
}

class _InsightsPageState extends State<InsightsPage> {
  @override
  Widget build(BuildContext context) {
    // Live figures, so it follows the clock rather than only real changes.
    return ValueListenableBuilder<int>(
      valueListenable: AppScope.of(context).clock,
      builder: (context, _, _) => _page(context),
    );
  }

  Widget _page(BuildContext context) {
    final app = AppScope.of(context);
    final day = app.day;
    final days = app.days;
    final live = !day.stale;

    final worked = days.fold<int>(0, (a, d) => a + d.result.worked);
    final breaks = days.fold<int>(0, (a, d) => a + d.result.breakMs);

    /// `7:32` with the live seconds dimmed behind it, while that figure is moving.
    (String, String?) split(int ms, bool ticking) {
      if (!ticking) return (hm(ms), null);
      final full = hms(ms);
      final i = full.lastIndexOf(':');
      return (full.substring(0, i), full.substring(i));
    }

    final tiles = [
      (
        Icons.timer_outlined,
        TileTone.blue,
        'Total work time',
        split(day.worked, live && day.status == DayStatus.working),
        '${(day.worked / kMin).round()} minutes',
      ),
      (
        Icons.coffee_outlined,
        TileTone.amber,
        'Total break time',
        split(day.breakMs, live && day.status == DayStatus.onBreak),
        '${(day.breakMs / kMin).round()} minutes',
      ),
      (
        Icons.bar_chart,
        TileTone.violet,
        'Office span',
        split(day.elapsed, live && day.sessions.isNotEmpty),
        'first in → now',
      ),
    ];

    Widget mini({Widget? icon, required String label, required Widget value, required String sub}) => Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: C.card2,
        borderRadius: BorderRadius.circular(13),
        border: Border.all(color: C.line2),
      ),
      child: Row(
        children: [
          if (icon != null) ...[icon, const SizedBox(width: 12)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: t(11, color: C.dim)),
                const SizedBox(height: 2),
                value,
                Text(sub, style: t(11, color: C.muted)),
              ],
            ),
          ),
        ],
      ),
    );
    final figure = t(20, weight: FontWeight.w600, height: 1.25);

    return Gap(
      children: [
        AppCard(
          child: days.isEmpty
              ? const Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [H2('Stored days'), EmptyRow('Nothing stored yet — load a day to see it here.')],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    CardHead(
                      title: H2('Last ${days.length.clamp(0, 14)} stored ${days.length == 1 ? 'day' : 'days'}'),
                      trailing: Wrap(
                        spacing: 12,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          _key(C.green, 'work'),
                          _key(C.amber, 'break'),
                          _key(C.accent, '${hm(app.settings.target * kMin)} goal'),
                        ],
                      ),
                    ),
                    const SizedBox(height: 12),
                    DayBars(days: days, target: app.settings.target),
                  ],
                ),
        ),
        Cols(
          main: Gap(
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const H2('This day'),
                    const SizedBox(height: 14),
                    AutoGrid(
                      minWidth: 200,
                      gap: 12,
                      children: [
                        for (final (i, (icon, tone, label, (value, tail), sub)) in tiles.indexed)
                          Entrance(
                            delay: 0.05 * i,
                            dy: 10,
                            ms: 400,
                            child: mini(
                              icon: IconTile(icon, tone: tone),
                              label: label,
                              value: ValueWithTail(value, tail: tail, style: figure),
                              sub: sub,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const H2('What the day says'),
                    const SizedBox(height: 14),
                    for (final (i, line) in _insights(day).indexed)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Entrance(
                          dx: -8,
                          dy: 0,
                          ms: 300,
                          delay: 0.04 * i,
                          child: Container(
                            width: double.infinity,
                            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
                            decoration: BoxDecoration(
                              color: C.card2,
                              borderRadius: BorderRadius.circular(11),
                              border: Border.all(color: C.line2),
                            ),
                            child: Text(line, style: t(12.5, color: C.dim, height: 1.6)),
                          ),
                        ),
                      ),
                    Hint(
                      'Exit = first punch-in + ${hm(day.span - day.billableBreak)} work + every break minute'
                      '${day.billableBreak > 0 ? ' (currently ${(day.billableBreak / kMin).round()} min)' : ''}.',
                    ),
                  ],
                ),
              ),
            ],
          ),
          side: Gap(
            children: [
              Efficiency(day: day),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    H2('Across ${days.length} stored ${days.length == 1 ? 'day' : 'days'}'),
                    const SizedBox(height: 14),
                    mini(
                      label: 'Worked in total',
                      value: Text(hm(worked), style: figure.copyWith(color: C.green)),
                      sub: days.isEmpty ? 'nothing stored yet' : '${hm(worked / days.length)} a day on average',
                    ),
                    const SizedBox(height: 10),
                    mini(
                      label: 'Break in total',
                      value: Text(hm(breaks), style: figure),
                      sub: days.isEmpty ? '—' : '${hm(breaks / days.length)} a day on average',
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

Widget _key(Color color, String label) => Row(
  mainAxisSize: MainAxisSize.min,
  children: [
    Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3)),
    ),
    const SizedBox(width: 6),
    Text(label, style: t(11, color: C.muted)),
  ],
);

/* ------------------------------------------------------------------ history */

class HistoryPage extends StatefulWidget {
  const HistoryPage({super.key});

  @override
  State<HistoryPage> createState() => _HistoryPageState();
}

class _HistoryPageState extends State<HistoryPage> {
  String? _open;

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final days = app.days;
    final filter = app.filter;
    final selectedKey = app.selected?.key;

    final months = monthsOf(days);
    final visible = daysInMonth(days, filter.month);
    final totals = totalsOf(visible);
    final scope = filter.month == 'all' ? 'All stored days' : monthLabelFromKey(filter.month);

    // A month or day saved in the filter can outlive its data — deleting the last
    // day of August leaves `2026-08` selected with nothing to select it from. Keep
    // the option around rather than letting the dropdown have no matching item.
    final monthMissing = filter.month != 'all' && !months.any((m) => m.key == filter.month);
    final dayMissing = filter.day != 'latest' && !visible.any((d) => d.key == filter.day);

    Widget total(String value, String label, [Color color = C.ink]) => Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: value,
            style: m(12.5, color: color, weight: FontWeight.w600),
          ),
          TextSpan(text: ' $label'),
        ],
      ),
      style: t(11.5, color: color == C.ink ? C.dim : color),
    );

    return Entrance(
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            CardHead(
              title: const H2('History'),
              trailing: Wrap(
                spacing: 12,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Btn(
                    'Download PDF',
                    icon: Icons.download,
                    small: true,
                    tooltip:
                        'Download the ${visible.length} ${visible.length == 1 ? 'day' : 'days'} shown below as a PDF',
                    onPressed: visible.isEmpty ? null : () => app.downloadPdf(visible, scope),
                  ),
                  if (days.isNotEmpty) LinkBtn('Clear history', onPressed: app.clearAll),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const FieldLabel('Month'),
                      AppSelect<String>(
                        value: filter.month,
                        onChanged: (v) => app.setFilter(month: v, day: 'latest'),
                        items: [
                          ('all', 'All months (${days.length} days)'),
                          for (final mo in months)
                            (mo.key, '${monthLabel(mo.at)} (${mo.days} ${mo.days == 1 ? 'day' : 'days'})'),
                          if (monthMissing) (filter.month, '${monthLabelFromKey(filter.month)} (empty)'),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const FieldLabel('Day'),
                      AppSelect<String>(
                        value: filter.day,
                        onChanged: (v) => app.setFilter(day: v),
                        items: [
                          ('latest', 'Latest day'),
                          for (final d in visible) (d.key, '${dateLabel(d.at)} — ${shortDay(d.at)}'),
                          if (dayMissing) (filter.day, '${filter.day} (hidden)'),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (totals.days > 0) ...[
              const SizedBox(height: 12),
              Entrance(
                key: ValueKey('${filter.month}-${totals.days}'),
                dy: -6,
                ms: 240,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                  decoration: BoxDecoration(
                    color: C.card2,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: C.line2),
                  ),
                  child: Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 14,
                          runSpacing: 4,
                          children: [
                            total('${totals.days}', totals.days == 1 ? 'day' : 'days'),
                            total(hm(totals.worked), 'worked', C.green),
                            total(hm(totals.breakMs), 'break', C.amber),
                          ],
                        ),
                      ),
                      Text('avg ${hm(totals.worked / totals.days)} / day', style: t(11.5, color: C.muted)),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 12),
            if (visible.isEmpty)
              EmptyRow(
                days.isEmpty
                    ? 'Nothing stored yet — the days you load are kept here.'
                    : 'No days stored in that month.',
              ),
            for (final (i, d) in visible.indexed)
              Padding(
                key: ValueKey(d.key),
                padding: const EdgeInsets.only(bottom: 6),
                child: Entrance(
                  dx: -8,
                  dy: 0,
                  ms: 260,
                  delay: (i * 0.03).clamp(0, 0.18).toDouble(),
                  child: _HistoryRow(
                    day: d,
                    selected: d.key == selectedKey,
                    open: _open == d.key,
                    onToggle: () => setState(() => _open = _open == d.key ? null : d.key),
                    onDelete: () => app.deleteDay(d.key),
                    onShow: () => app.setFilter(month: 'all', day: d.key),
                    onEdit: () => showDaySheet(context, d.key),
                  ),
                ),
              ),
            if (visible.isNotEmpty)
              Hint(
                'Tap a day to see what happened inside it. Totals cover '
                '${filter.month == 'all' ? 'every stored day' : monthLabelFromKey(filter.month)}: '
                '${human(totals.office)} in the office.',
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Btn(
                    'Back to the latest day',
                    onPressed: () => app.setFilter(month: 'all', day: 'latest'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Btn(
                    'Edit the shown day',
                    icon: Icons.add,
                    kind: BtnKind.dashed,
                    onPressed: () => showDaySheet(context, selectedKey ?? visible.firstOrNull?.key ?? dayKey(nowMs())),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _HistoryRow extends StatefulWidget {
  const _HistoryRow({
    required this.day,
    required this.selected,
    required this.open,
    required this.onToggle,
    required this.onDelete,
    required this.onShow,
    required this.onEdit,
  });

  final DayEntry day;

  /// The day the calculator is showing — marked in the list.
  final bool selected;
  final bool open;
  final VoidCallback onToggle;
  final VoidCallback onDelete;
  final VoidCallback onShow;
  final VoidCallback onEdit;

  @override
  State<_HistoryRow> createState() => _HistoryRowState();
}

class _HistoryRowState extends State<_HistoryRow> {
  bool _hover = false;

  @override
  Widget build(BuildContext context) {
    final d = widget.day;
    final r = d.result;
    final times = '${clockTime(r.first)} → ${r.status == DayStatus.working ? 'running' : clockTime(r.last)}';
    final lit = _hover || widget.open;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: MouseRegion(
                cursor: SystemMouseCursors.click,
                onEnter: (_) => setState(() => _hover = true),
                onExit: (_) => setState(() => _hover = false),
                child: GestureDetector(
                  onTap: widget.onToggle,
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 160),
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    decoration: BoxDecoration(
                      color: widget.selected
                          ? C.accent.withValues(alpha: 0.09)
                          : lit
                          ? const Color(0xFF202026)
                          : C.card2,
                      borderRadius: BorderRadius.circular(11),
                      border: Border.all(
                        color: widget.selected
                            ? const Color(0xFF45455A)
                            : lit
                            ? C.line
                            : Colors.transparent,
                      ),
                    ),
                    child: LayoutBuilder(
                      builder: (context, box) {
                        final wide = box.maxWidth > 520;
                        return Row(
                          children: [
                            Expanded(
                              flex: 10,
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(dayMonth(d.at), style: t(13, weight: FontWeight.w600)),
                                  Text(
                                    wide ? weekday(d.at) : times,
                                    style: wide ? t(10.5, color: C.muted) : m(10.5, color: C.dim),
                                  ),
                                ],
                              ),
                            ),
                            if (wide)
                              Expanded(
                                flex: 12,
                                child: Text(times, style: m(11, color: C.dim)),
                              ),
                            const SizedBox(width: 10),
                            Text(hm(r.worked), style: m(12, color: C.green)),
                            const SizedBox(width: 10),
                            Text(hm(r.breakMs), style: m(12, color: C.amber)),
                            const SizedBox(width: 10),
                            if (wide)
                              StatusChip(
                                d.submittedAt == null ? 'In progress' : 'Saved ${clockTime(d.submittedAt)}',
                                tone: d.submittedAt == null ? ChipTone.muted : ChipTone.green,
                              )
                            else if (d.submittedAt != null)
                              const Icon(Icons.check_circle_outline, size: 15, color: C.green),
                            const SizedBox(width: 8),
                            AnimatedRotation(
                              turns: widget.open ? 0.25 : 0,
                              duration: const Duration(milliseconds: 220),
                              child: const Icon(Icons.chevron_right, size: 16, color: C.muted),
                            ),
                          ],
                        );
                      },
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(width: 6),
            XButton(danger: true, tooltip: 'Remove ${dateLabel(d.at)}', onPressed: widget.onDelete),
          ],
        ),
        Reveal(open: widget.open, child: widget.open ? _detail(d) : const SizedBox.shrink()),
      ],
    );
  }

  /// What happened inside one day, opened by tapping its row.
  Widget _detail(DayEntry d) {
    final r = d.result;
    Widget fact(String label, String value, [Color color = C.ink]) => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Kicker(label, size: 9.5, color: C.muted, spacing: 0.9),
        const SizedBox(height: 2),
        Text(
          value,
          style: m(13, color: color, weight: FontWeight.w600),
        ),
      ],
    );

    return Container(
      margin: const EdgeInsets.only(top: 6, bottom: 2),
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        color: const Color(0xFF101013),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: C.line2),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AutoGrid(
            minWidth: 92,
            gap: 10,
            children: [
              fact('Date', dateLabel(d.at)),
              fact('First in', clockTime(r.first)),
              fact('Last out', r.status == DayStatus.working ? 'running' : clockTime(r.last)),
              fact('Total work', hm(r.worked), C.green),
              fact('Total break', hm(r.breakMs), C.amber),
              fact('In office', hm(r.office)),
              fact('Could leave at', r.leave == null ? '--:--' : clockShort(r.leave)),
            ],
          ),
          const SizedBox(height: 12),
          if (r.blocks.isEmpty) const EmptyRow('No punches on this day.'),
          for (final (block, caption) in numbered(r.blocks))
            Container(
              margin: const EdgeInsets.only(bottom: 4),
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              decoration: BoxDecoration(
                color: block.isWork ? C.card2 : C.amber.withValues(alpha: 0.06),
                borderRadius: BorderRadius.circular(9),
              ),
              child: Row(
                children: [
                  Expanded(
                    flex: 10,
                    child: Row(
                      children: [
                        Dot(block.isWork ? C.green : C.amber, size: 6),
                        const SizedBox(width: 8),
                        Flexible(
                          child: Text(
                            caption,
                            overflow: TextOverflow.ellipsis,
                            style: t(12, color: block.isWork ? C.ink : C.amber, weight: FontWeight.w600),
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    flex: 12,
                    child: Text(
                      '${clockTime(block.from)} → ${block.live ? 'running' : clockTime(block.to)}',
                      style: m(12, color: block.isWork ? C.dim : C.amber),
                    ),
                  ),
                  Text(hm(block.to - block.from), style: m(12, color: block.isWork ? C.dim : C.amber)),
                ],
              ),
            ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              Btn(
                widget.selected ? 'On the dashboard' : 'Show on dashboard',
                small: true,
                onPressed: widget.selected ? null : widget.onShow,
              ),
              Btn('Edit day', icon: Icons.table_chart_outlined, small: true, onPressed: widget.onEdit),
            ],
          ),
        ],
      ),
    );
  }
}

/* ------------------------------------------------------------------- export */

/// Export options that don't need any setup, plus the saved endpoint.
class ExportPage extends StatefulWidget {
  const ExportPage({super.key});

  @override
  State<ExportPage> createState() => _ExportPageState();
}

class _ExportPageState extends State<ExportPage> {
  TextEditingController? _url;

  @override
  void dispose() {
    _url?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final sheet = app.sheet;
    final selected = app.selected;
    final url = _url ??= TextEditingController(text: sheet.url);
    // The setup dialog can change the URL from outside this field.
    if (url.text != sheet.url) url.text = sheet.url;

    final dayMissing = app.filter.day != 'latest' && !app.days.any((d) => d.key == app.filter.day);

    return Entrance(
      delay: 0.12,
      dy: 16,
      ms: 500,
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const H2('Save & export', leading: IconTile(Icons.add_to_drive, tone: TileTone.green, small: true)),
            const SizedBox(height: 14),
            CardHead(
              title: const Kicker('Day to save'),
              trailing: Btn(
                'Add session',
                icon: Icons.add,
                kind: BtnKind.ghost,
                small: true,
                onPressed: () => showSessionModal(context),
              ),
            ),
            const SizedBox(height: 8),
            AppSelect<String>(
              value: app.filter.day,
              onChanged: (v) => app.setFilter(month: 'all', day: v),
              items: [
                ('latest', 'Latest stored day'),
                for (final d in app.days) (d.key, '${shortDay(d.at)} ${dateLabel(d.at)}'),
                if (dayMissing) (app.filter.day, '${app.filter.day} (empty)'),
              ],
            ),
            const SizedBox(height: 10),
            if (sheet.empty)
              Preview.text(
                "Nothing stored for that day yet — add punches and they'll be ready to export.",
                tone: Tone.idle,
              )
            else
              Preview(
                tone: Tone.ok,
                tail: Text(
                  sheet.configured ? 'Drive connected' : 'not connected — Download CSV still works',
                  style: t(12, color: C.muted),
                ),
                children: [
                  Text(
                    selected == null ? 'This day' : dateLabel(selected.at),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  Text(
                    '${sheet.rowCount} ${sheet.rowCount == 1 ? 'row' : 'rows'} · ${sheetHeaders.length} columns',
                    style: m(11, color: C.dim),
                  ),
                ],
              ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: Btn(
                    sheet.sending ? 'Saving…' : 'Add to Drive',
                    icon: Icons.add_to_drive,
                    kind: BtnKind.primary,
                    onPressed: sheet.empty || sheet.sending ? null : sheet.saveToDrive,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(child: Btn('Download CSV', onPressed: sheet.empty ? null : sheet.downloadCsv)),
              ],
            ),
            if (sheet.lastSaved case final saved?) ...[
              const SizedBox(height: 12),
              Entrance(dy: -6, child: _SavedFileLink(saved)),
            ],
            const Padding(
              padding: EdgeInsets.only(top: 18, bottom: 14),
              child: Row(
                children: [
                  Kicker('Connected account', size: 10, color: C.muted, spacing: 1.5),
                  SizedBox(width: 12),
                  Expanded(child: Divider(height: 1, color: C.line2)),
                ],
              ),
            ),
            const FieldLabel('Apps Script web app URL'),
            TextField(
              controller: url,
              autocorrect: false,
              style: m(13),
              decoration: inputDecoration(hint: 'https://script.google.com/macros/s/.../exec'),
              onChanged: sheet.setUrl,
            ),
            if (sheet.url.trim().isNotEmpty) ...[
              const SizedBox(height: 10),
              Preview.text(
                sheet.configured
                    ? 'Connected — Add to Drive saves straight into your Drive.'
                    : urlProblem(sheet.url) ?? '',
                tone: sheet.configured ? Tone.ok : Tone.error,
              ),
            ],
            const SizedBox(height: 14),
            Wrap(
              spacing: 16,
              runSpacing: 8,
              children: [
                if (sheet.configured) ...[
                  LinkBtn(
                    sheet.sending ? 'Testing…' : 'Test connection',
                    onPressed: sheet.sending ? null : sheet.testConnection,
                  ),
                  LinkBtn('Open /exec ↗', onPressed: () => openLink(execEndpoint(sheet.url))),
                ],
                LinkBtn(sheet.configured ? 'Reconnect to Drive' : 'Connect to Drive', onPressed: sheet.openSetup),
              ],
            ),
            Hint(
              'One day per save, named office-time-DD-MM-YYYY.csv, in an Office Time folder; re-saving '
              'replaces that date rather than adding it twice. Picking a day here is the same choice as '
              'the History filter, so the dashboard follows it. Columns: ${sheetHeaders.join(' · ')}',
            ),
          ],
        ),
      ),
    );
  }
}

class _SavedFileLink extends StatelessWidget {
  const _SavedFileLink(this.file);

  final SavedFile file;

  @override
  Widget build(BuildContext context) => MouseRegion(
    cursor: SystemMouseCursors.click,
    child: GestureDetector(
      onTap: () => openLink(file.url.isEmpty ? file.folderUrl : file.url),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
        decoration: BoxDecoration(
          color: C.card2,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: C.line2),
        ),
        child: Row(
          children: [
            const Icon(Icons.add_to_drive, size: 15, color: C.ink),
            const SizedBox(width: 11),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(file.name, style: t(12.5, weight: FontWeight.w600)),
                  Text('in ${file.folder} — open in Drive', style: t(11, color: C.muted)),
                ],
              ),
            ),
            const Icon(Icons.north_east, size: 14, color: C.green),
          ],
        ),
      ),
    ),
  );
}

/* ----------------------------------------------------------------- settings */

/// Minutes in, minutes out — the two numbers the whole calculation rests on.
class SettingsPage extends StatefulWidget {
  const SettingsPage({super.key});

  @override
  State<SettingsPage> createState() => _SettingsPageState();
}

class _SettingsPageState extends State<SettingsPage> {
  final _target = TextEditingController();
  final _free = TextEditingController();
  final _targetFocus = FocusNode();
  final _freeFocus = FocusNode();

  @override
  void initState() {
    super.initState();
    // Committed on blur, as the number inputs were.
    _targetFocus.addListener(() => _onBlur(_targetFocus, _commitTarget));
    _freeFocus.addListener(() => _onBlur(_freeFocus, _commitFree));
  }

  void _onBlur(FocusNode node, VoidCallback commit) {
    if (!node.hasFocus) commit();
  }

  int? _parse(String raw) {
    final n = double.tryParse(raw.trim());
    return n == null || !n.isFinite || n < 0 ? null : n.round();
  }

  void _commitTarget() {
    final n = _parse(_target.text);
    if (n != null) AppScope.read(context).setSettings(target: n < 1 ? 1 : n);
  }

  void _commitFree() {
    final n = _parse(_free.text);
    if (n != null) AppScope.read(context).setSettings(free: n);
  }

  @override
  void dispose() {
    for (final c in [_target, _free]) {
      c.dispose();
    }
    for (final f in [_targetFocus, _freeFocus]) {
      f.dispose();
    }
    super.dispose();
  }

  /// A pasted response can carry its own target, so mirror it back into the
  /// field — but never over what is being typed.
  void _mirror(TextEditingController c, FocusNode f, String value) {
    if (!f.hasFocus && c.text != value) c.text = value;
  }

  @override
  Widget build(BuildContext context) {
    final app = AppScope.of(context);
    final settings = app.settings;
    final consent = app.consent;
    final stored = app.days.length;
    final dayWord = stored == 1 ? 'day' : 'days';
    _mirror(_target, _targetFocus, '${settings.target}');
    _mirror(_free, _freeFocus, '${settings.free}');

    Widget number(String label, TextEditingController c, FocusNode f, VoidCallback commit, String hint) => Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FieldLabel(label),
          TextField(
            controller: c,
            focusNode: f,
            keyboardType: TextInputType.number,
            style: m(13),
            decoration: inputDecoration(),
            onSubmitted: (_) => commit(),
          ),
          Hint(hint),
        ],
      ),
    );

    return Cols(
      main: Gap(
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const H2('Working day'),
                const SizedBox(height: 4),
                const Lead(
                  "Both in minutes. The exit time is the first punch-in plus the target plus every break minute that isn't free.",
                ),
                const SizedBox(height: 16),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    number(
                      'Work target',
                      _target,
                      _targetFocus,
                      _commitTarget,
                      '${hm(settings.target * kMin)} of actual work owed.',
                    ),
                    const SizedBox(width: 12),
                    number(
                      'Free break',
                      _free,
                      _freeFocus,
                      _commitFree,
                      settings.free > 0
                          ? "First ${settings.free} break minutes don't push the exit."
                          : 'Every break minute pushes the exit.',
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
      side: Gap(
        children: [
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const H2('Storage'),
                const SizedBox(height: 4),
                const Lead(
                  'Your punches are saved on this device automatically, including what the HR sync brings '
                  'in every minute. No cookies are set and nothing is sent anywhere else.',
                ),
                const SizedBox(height: 16),
                Preview.text(
                  switch (consent) {
                    Consent.granted => 'Saving — this day and every stored day survive a restart.',
                    Consent.denied => 'Off — nothing is written, so closing the app loses the day.',
                    Consent.unknown => 'Saving automatically — this day and every stored day survive a restart.',
                  },
                  tone: switch (consent) {
                    Consent.granted => Tone.ok,
                    Consent.denied => Tone.warn,
                    Consent.unknown => Tone.ok,
                  },
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: Btn(
                        'Save on this device',
                        kind: BtnKind.primary,
                        onPressed: consent == Consent.denied ? app.allow : null,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Btn('Stop & wipe', onPressed: consent == Consent.denied ? null : app.reject)),
                  ],
                ),
                const Hint('Stopping also deletes what is already saved on this device.'),
              ],
            ),
          ),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const H2('Stored data'),
                const SizedBox(height: 4),
                Lead(
                  app.canPersist
                      ? "$stored $dayWord kept in this device's local storage, filed by date."
                      : '$stored $dayWord in memory for this session only — allow storage above to keep them.',
                ),
                const SizedBox(height: 16),
                Btn(
                  'Clear all stored days',
                  kind: BtnKind.danger,
                  wide: true,
                  onPressed: stored == 0 ? null : app.clearAll,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
