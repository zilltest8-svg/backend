/// The history screen, as a PDF: one table, laid out to land on ONE page.
///
/// Every day is a banded row carrying its own totals, and that day's sessions and
/// breaks are the plain rows directly beneath it — so the day and the punches
/// that add up to it are read together instead of being looked up twice.
///
/// Two things buy the single page. The report is measured before anything is
/// drawn and scaled to fit (never up, and never past the point of being
/// readable), and when it still will not fit, the table runs in two columns.
/// Only a selection far bigger than a full month spills onto a second page.
library;

import 'dart:math' as math;
import 'dart:typed_data';

import 'history.dart';
import 'pdf.dart';
import 'time.dart';
import 'types.dart';

const Rgb _ink = (0.09, 0.09, 0.12);
const Rgb _muted = (0.42, 0.43, 0.5);
const Rgb _faint = (0.62, 0.63, 0.68);
const Rgb _line = (0.85, 0.86, 0.9);
const Rgb _band = (0.95, 0.955, 0.97);
const Rgb _dayBand = (0.91, 0.925, 0.95);
const Rgb _green = (0.11, 0.51, 0.33);
const Rgb _amber = (0.68, 0.45, 0.06);
const Rgb _accent = (0.29, 0.34, 0.72);

const double _margin = 36;
const double _rowH = 13.5;
const double _headH = 16.5;
const double _pad = 5;
const double _gutter = 18;

/// Below this the type stops being readable, and an illegible single page helps
/// nobody — so a selection that would need it flows over at a comfortable size
/// instead. Anything up to a very full month still lands on one page.
const double _onePageFloor = 0.63;

/// Used when one page is off the table; roomy enough to read at a glance.
const double _comfortScale = 0.85;

class _Column {
  const _Column(this.title, this.width, [this.align = PdfAlign.left]);

  final String title;
  final double width;
  final PdfAlign align;
}

/// Day rows and punch rows share this grid, which is what makes it one table:
/// a day fills the totals on the right, a punch fills the times in the middle.
const _wide = [
  _Column('Date', 72),
  _Column('Session / break', 74),
  _Column('Type', 44),
  _Column('In', 62),
  _Column('Out', 62),
  _Column('Length', 52, PdfAlign.right),
  _Column('Day work', 54, PdfAlign.right),
  _Column('Day break', 54, PdfAlign.right),
  _Column('Leave by', 49.28),
];

/// The same rows at half width, for when the table has to run two-up.
const _narrow = [
  _Column('Date / entry', 74),
  _Column('Type', 38),
  _Column('In', 50),
  _Column('Out', 50),
  _Column('Time', 40.64, PdfAlign.right),
];

class _Cell {
  const _Cell(this.text, {this.color, this.bold = false});

  final String text;
  final Rgb? color;
  final bool bold;
}

/// Vertical metrics, all scaled by the same factor so proportions hold.
class _Style {
  const _Style({required this.scale, required this.row, required this.head, required this.cell});

  final double scale;
  final double row;
  final double head;
  final double cell;
}

enum _Kind { day, punch, totals }

/// A line of the table: a day and its totals, or one session or break.
class _Entry {
  const _Entry(
    this.kind, {
    this.day,
    this.caption,
    this.isWork = false,
    this.from,
    this.to,
    this.length,
    this.bare = false,
  });

  final _Kind kind;
  final DayEntry? day;
  final String? caption;
  final bool isWork;
  final String? from;
  final String? to;
  final String? length;

  /// A day that has no punches at all.
  final bool bare;
}

/// Left edge of every column in the table.
List<double> _edges(double left, List<_Column> columns) {
  final out = [left];
  for (final c in columns) {
    out.add(out.last + c.width);
  }
  return out;
}

double _totalWidth(List<_Column> columns) => columns.fold(0, (sum, c) => sum + c.width);

/// Days and their punches, interleaved into the single list the table draws.
List<_Entry> _entriesOf(List<DayEntry> days) {
  final out = <_Entry>[];
  for (final day in days) {
    final blocks = day.result.blocks;
    out.add(_Entry(_Kind.day, day: day, bare: blocks.isEmpty));
    var work = 0;
    var brk = 0;
    for (final block in blocks) {
      out.add(
        _Entry(
          _Kind.punch,
          day: day,
          caption: block.isWork ? 'Session ${work += 1}' : 'Break ${brk += 1}',
          isWork: block.isWork,
          from: clockTime(block.from),
          to: block.live ? 'Running' : clockTime(block.to),
          length: hm(block.to - block.from),
        ),
      );
    }
  }
  return out;
}

/// What one entry puts in each column. `cont` marks a day resumed in a new column.
List<_Cell?> _cellsOf(_Entry entry, Totals totals, int cols, {bool cont = false}) {
  final wide = cols == 1;

  if (entry.kind == _Kind.totals) {
    final label = '${totals.days} ${totals.days == 1 ? 'day' : 'days'}';
    return wide
        ? [
            _Cell(label, bold: true),
            const _Cell('Totals', bold: true),
            null,
            null,
            null,
            _Cell(hm(totals.office), bold: true),
            _Cell(hm(totals.worked), color: _green, bold: true),
            _Cell(hm(totals.breakMs), color: _amber, bold: true),
            null,
          ]
        : [
            // No room for both totals here; the strip at the top carries the rest.
            _Cell('$label worked', bold: true),
            null,
            null,
            null,
            _Cell(hm(totals.worked), color: _green, bold: true),
          ];
  }

  final day = entry.day;
  if (day == null) return const [];
  final r = day.result;

  if (entry.kind == _Kind.day) {
    final out = r.status == DayStatus.working ? 'Running' : clockTime(r.last);
    final name = '${weekday(day.at)}${cont ? ' (cont.)' : ''}';
    return wide
        ? [
            _Cell(dateDMY(r.first ?? day.at), bold: true),
            _Cell(entry.bare ? 'No punches' : name, color: entry.bare ? _faint : _muted, bold: !entry.bare),
            null,
            _Cell(clockTime(r.first), bold: true),
            _Cell(out, bold: true),
            _Cell(hm(r.office), bold: true),
            _Cell(hm(r.worked), color: _green, bold: true),
            _Cell(hm(r.breakMs), color: _amber, bold: true),
            _Cell(r.leave == null ? '--:--' : clockShort(r.leave), color: _muted),
          ]
        : [
            // Half width has no room for the weekday and the marker both.
            _Cell(
              cont ? '${dayMonth(day.at)} (cont.)' : '${dayMonth(day.at)} ${weekday(day.at).substring(0, 3)}',
              bold: true,
            ),
            entry.bare ? const _Cell('none', color: _faint) : null,
            _Cell(clockTime(r.first), bold: true),
            _Cell(out, bold: true),
            _Cell(hm(r.worked), color: _green, bold: true),
          ];
  }

  final type = _Cell(entry.isWork ? 'Work' : 'Break', color: entry.isWork ? _green : _amber);
  // The leading space is the indent that hangs a punch under its day.
  final caption = _Cell('  ${entry.caption ?? ''}', color: entry.isWork ? _ink : _muted);
  final times = [_Cell(entry.from ?? ''), _Cell(entry.to ?? ''), _Cell(entry.length ?? '', bold: entry.isWork)];
  return wide ? [null, caption, type, ...times, null, null, null] : [caption, type, ...times];
}

/// The grey band of column titles, repeated above every column of the table.
void _head(Pdf doc, List<_Column> columns, double x0, _Style style) {
  final x = _edges(x0, columns);
  doc.rect(x0, doc.y + style.head * 0.61, _totalWidth(columns), style.head, _band);
  for (var i = 0; i < columns.length; i++) {
    final col = columns[i];
    doc.text(
      col.title,
      x[i] + _pad,
      size: style.cell * 0.94,
      font: PdfFont.bold,
      color: _muted,
      align: col.align,
      to: x[i] + col.width - _pad,
    );
  }
  doc.down(style.head);
}

/// One line of the table. Day rows get the darker band that groups them.
void _row(Pdf doc, List<_Column> columns, double x0, List<_Cell?> cells, _Style style, Rgb? band) {
  final x = _edges(x0, columns);
  if (band != null) doc.rect(x0, doc.y + style.row * 0.67, _totalWidth(columns), style.row, band);
  for (var i = 0; i < columns.length; i++) {
    final cell = i < cells.length ? cells[i] : null;
    if (cell == null || cell.text.isEmpty) continue;
    final col = columns[i];
    final font = cell.bold ? PdfFont.bold : PdfFont.regular;
    doc.text(
      ellipsize(cell.text, col.width - _pad * 2, style.cell, font),
      x[i] + _pad,
      size: style.cell,
      font: font,
      color: cell.color ?? _ink,
      align: col.align,
      to: x[i] + col.width - _pad,
    );
  }
  doc.down(style.row);
}

/// The table, in `cols` columns. Rows are dealt down the first column and then
/// the second, evenly, and a column that opens on a punch restates the day it
/// belongs to — a time with no date above it says nothing.
void _table(Pdf doc, List<_Entry> entries, Totals totals, int cols, _Style style) {
  final columns = cols == 1 ? _wide : _narrow;
  final width = _totalWidth(columns);
  var i = 0;

  while (i < entries.length) {
    final top = doc.y;
    final fits = math.max(2, ((top - doc.bottom - style.head) / style.row).floor());
    final per = math.min(fits, ((entries.length - i) / cols).ceil());

    for (var c = 0; c < cols && i < entries.length; c++) {
      doc.y = top;
      final x0 = doc.left + c * (width + _gutter);
      _head(doc, columns, x0, style);

      final opener = entries[i];
      final restated = opener.kind == _Kind.punch && opener.day != null;
      if (restated) {
        _row(doc, columns, x0, _cellsOf(_Entry(_Kind.day, day: opener.day), totals, cols, cont: true), style, _dayBand);
      }

      // At least one real entry per column, or a restated day row on a short
      // column would leave nothing consumed and the loop would never end.
      final quota = math.max(1, per - (restated ? 1 : 0));
      for (var used = 0; used < quota && i < entries.length; used++, i++) {
        final entry = entries[i];
        if (entry.kind == _Kind.totals) doc.hairline(doc.y + style.row * 0.67, _line);
        _row(doc, columns, x0, _cellsOf(entry, totals, cols), style, entry.kind == _Kind.day ? _dayBand : null);
      }
    }

    if (i < entries.length) doc.newPage();
  }
}

class ReportMeta {
  const ReportMeta({required this.scope, required this.at, this.query = ''});

  /// "Aug 2026" or "All stored days" — what the month filter was set to.
  final String scope;

  /// Whatever was typed in the search box, if anything.
  final String query;

  /// When the report was made.
  final int at;
}

/// Height the whole report wants at full size, with the table in `cols`.
double _heightOf(int rows, int cols) {
  const header = 73; // title, scope line and the totals strip
  return header + _headH + (rows / cols).ceil() * _rowH + 6;
}

/// Pick the layout. One wide column is preferred while it fits, and a small
/// shrink beats splitting the table in two; past that, two columns and whatever
/// scale it takes — unless that would be too small to read, in which case the
/// report stays comfortable and runs onto another page.
(int, _Style) _planLayout(int rows) {
  const room = pageH - _margin * 2 - 24;
  final wide = room / _heightOf(rows, 1);
  // Each extra column can need a restated day row, so budget one for it.
  final split = room / _heightOf(rows + 1, 2);

  final cols = wide >= 0.85 ? 1 : 2;
  final need = cols == 1 ? wide : split;
  final scale = need >= 1
      ? 1.0
      : need >= _onePageFloor
      ? need
      : _comfortScale;

  return (cols, _Style(scale: scale, row: _rowH * scale, head: _headH * scale, cell: (cols == 1 ? 8.5 : 8) * scale));
}

/// The visible history as a print-ready PDF — one page wherever it can be.
Uint8List historyPdf(List<DayEntry> days, Totals totals, ReportMeta meta) {
  final entries = _entriesOf(days);
  if (entries.isNotEmpty) entries.add(const _Entry(_Kind.totals));
  final (cols, style) = _planLayout(entries.length);
  final s = style.scale;
  final doc = Pdf(margin: _margin, footer: 'Office time history  ·  page #');

  doc.down(6 * s);
  doc.text('Office time history', doc.left, size: 17 * s, font: PdfFont.bold, color: _ink);
  doc.text(
    'Generated ${dateDMY(meta.at)}, ${clockTime(meta.at)}',
    doc.left,
    size: 8.5 * s,
    color: _muted,
    align: PdfAlign.right,
  );
  doc.down(15 * s);

  final query = meta.query.trim();
  final filtered = query.isEmpty ? '' : '  ·  matching "$query"';
  doc.text('${meta.scope}$filtered', doc.left, size: 10 * s, color: _accent);
  doc.down(18 * s);

  doc.rect(doc.left, doc.y + 12 * s, doc.innerWidth, 30 * s, _band);
  final facts = <(String, String, Rgb)>[
    ('Days', '${totals.days}', _ink),
    ('Worked', hm(totals.worked), _green),
    ('Break', hm(totals.breakMs), _amber),
    ('In office', hm(totals.office), _ink),
    ('Avg / day', hm(totals.worked / math.max(1, totals.days)), _ink),
  ];
  final cell = doc.innerWidth / facts.length;
  for (var i = 0; i < facts.length; i++) {
    doc.text(facts[i].$1, doc.left + cell * i + 8, size: 7.5 * s, color: _muted);
  }
  doc.down(13 * s);
  for (var i = 0; i < facts.length; i++) {
    doc.text(facts[i].$2, doc.left + cell * i + 8, size: 11 * s, font: PdfFont.bold, color: facts[i].$3);
  }
  doc.down(21 * s);

  if (entries.isEmpty) {
    doc.text('No days in this selection.', doc.left, size: 9, color: _muted);
    return doc.bytes();
  }

  _table(doc, entries, totals, cols, style);
  return doc.bytes();
}

String historyPdfFilename(ReportMeta meta) {
  final stamp = dateDMY(meta.at).replaceAll('/', '-');
  final scope = meta.scope.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'^-|-$'), '');
  return 'office-time-history-$scope-$stamp.pdf';
}
