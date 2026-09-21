/// A small PDF writer — just enough for a paginated, tabular report, with no
/// dependency to install. Pages are A4 portrait and text is Helvetica in
/// WinAnsi, one of the fonts every reader ships, so nothing has to be embedded.
///
/// Coordinates are PDF-native: the origin is the bottom-left corner and `y`
/// grows upwards. The cursor (`y`) walks *down* the page as content is written.
library;

import 'dart:typed_data';

const double pageW = 595.28;
const double pageH = 841.89;

/// Real Helvetica advance widths for codes 32..126, in 1/1000 em. Measuring
/// against them — rather than guessing an average — is what keeps right-aligned
/// number columns flush with each other.
const _wRegular = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, //
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const _wBold = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, //
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

enum PdfFont { regular, bold }

enum PdfAlign { left, right, center }

/// Red, green and blue, each 0..1.
typedef Rgb = (double, double, double);

/// Width of `text` at `size` points.
double textWidth(String text, double size, [PdfFont font = PdfFont.regular]) {
  final table = font == PdfFont.bold ? _wBold : _wRegular;
  var em = 0;
  for (final code in text.runes) {
    final i = code - 32;
    em += i >= 0 && i < table.length ? table[i] : 556;
  }
  return em * size / 1000;
}

/// Cut a string down to `max` points, ending in an ellipsis when it does not fit.
String ellipsize(String text, double max, double size, [PdfFont font = PdfFont.regular]) {
  if (textWidth(text, size, font) <= max) return text;
  var cut = text;
  while (cut.length > 1 && textWidth('$cut...', size, font) > max) {
    cut = cut.substring(0, cut.length - 1);
  }
  return '$cut...';
}

/// WinAnsi has no room for anything above 0xFF, and `(`, `)`, `\` end a string.
String _escape(String text) {
  final out = StringBuffer();
  for (final code in text.runes) {
    final ch = String.fromCharCode(code);
    if (ch == '(' || ch == ')' || ch == r'\') {
      out.write('\\$ch');
    } else if (code < 32 || code > 255) {
      out.write('?');
    } else {
      out.write(ch);
    }
  }
  return out.toString();
}

String _num(double n) {
  final r = (n * 100).round() / 100;
  return r == r.roundToDouble() ? '${r.toInt()}' : '$r';
}

String _rgb(Rgb c) => '${_num(c.$1)} ${_num(c.$2)} ${_num(c.$3)}';

class Pdf {
  Pdf({this.margin = 36, this.footer = ''}) : y = pageH - margin;

  final double margin;

  /// Drawn bottom-centre on every page, with `#` replaced by "1 of 4".
  final String footer;

  final List<String> _pages = [];
  List<String> _ops = [];

  /// Baseline the next line is written on, measured from the bottom.
  double y;

  double get left => margin;
  double get right => pageW - margin;
  double get innerWidth => pageW - margin * 2;

  void text(
    String value,
    double x, {
    double size = 9,
    PdfFont font = PdfFont.regular,
    Rgb color = (0, 0, 0),
    PdfAlign align = PdfAlign.left,
    double? to,
  }) {
    final body = _escape(value);
    if (body.isEmpty) return;
    final edge = to ?? right;
    var at = x;
    if (align == PdfAlign.right) {
      at = edge - textWidth(value, size, font);
    } else if (align == PdfAlign.center) {
      at = x + (edge - x - textWidth(value, size, font)) / 2;
    }
    _ops.add(
      'BT /${font == PdfFont.bold ? 'F2' : 'F1'} ${_num(size)} Tf ${_rgb(color)} rg '
      '${_num(at)} ${_num(y)} Td ($body) Tj ET',
    );
  }

  /// Filled rectangle, given by its top-left corner.
  void rect(double x, double top, double w, double h, Rgb color) {
    _ops.add('${_rgb(color)} rg ${_num(x)} ${_num(top - h)} ${_num(w)} ${_num(h)} re f');
  }

  void hairline(double top, Rgb color, {double? x, double? to, double weight = 0.6}) {
    _ops.add(
      '${_rgb(color)} RG ${_num(weight)} w ${_num(x ?? left)} ${_num(top)} m '
      '${_num(to ?? right)} ${_num(top)} l S',
    );
  }

  /// Move the cursor down.
  void down(double points) => y -= points;

  /// The lowest baseline content may use, with room left for the footer.
  double get bottom => margin + (footer.isEmpty ? 0 : 24);

  void newPage() {
    _pages.add(_ops.join('\n'));
    _ops = [];
    y = pageH - margin;
  }

  /// Close the document and hand back the bytes.
  Uint8List bytes() {
    final streams = [..._pages, _ops.join('\n')];
    final total = streams.length;
    final body = [for (var i = 0; i < total; i++) _withFooter(streams[i], i + 1, total)];

    // 1 catalog, 2 page tree, 3/4 fonts, then a page and a content object each.
    int pageId(int i) => 5 + i * 2;
    final objects = <String>[
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Count $total /Kids [${[for (var i = 0; i < total; i++) '${pageId(i)} 0 R'].join(' ')}] >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ];
    for (var i = 0; i < total; i++) {
      objects.add(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${_num(pageW)} ${_num(pageH)}] '
        '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>',
      );
      objects.add('<< /Length ${body[i].length} >>\nstream\n${body[i]}\nendstream');
    }

    final out = StringBuffer('%PDF-1.4\n');
    final offsets = <int>[];
    for (var i = 0; i < objects.length; i++) {
      offsets.add(out.length);
      out.write('${i + 1} 0 obj\n${objects[i]}\nendobj\n');
    }

    final xref = out.length;
    out.write('xref\n0 ${objects.length + 1}\n0000000000 65535 f \n');
    for (final at in offsets) {
      out.write('${'$at'.padLeft(10, '0')} 00000 n \n');
    }
    out.write('trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF');

    // Every byte written above is Latin-1, so one char is one byte.
    final text = out.toString();
    final bytes = Uint8List(text.length);
    for (var i = 0; i < text.length; i++) {
      bytes[i] = text.codeUnitAt(i) & 0xff;
    }
    return bytes;
  }

  /// "Page 2 of 3" can only be written once the last page is known.
  String _withFooter(String stream, int page, int total) {
    if (footer.isEmpty) return stream;
    final label = footer.replaceAll('#', '$page of $total');
    final x = left + (innerWidth - textWidth(label, 8)) / 2;
    return '$stream\nBT /F1 8 Tf 0.55 0.55 0.6 rg ${_num(x)} ${_num(margin)} Td (${_escape(label)}) Tj ET';
  }
}
