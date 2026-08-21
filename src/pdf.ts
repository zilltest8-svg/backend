/**
 * A small PDF writer — just enough for a paginated, tabular report, with no
 * dependency to install. Pages are A4 portrait and text is Helvetica in
 * WinAnsi, one of the fonts every reader ships, so nothing has to be embedded.
 *
 * Coordinates are PDF-native: the origin is the bottom-left corner and `y`
 * grows upwards. The cursor (`y`) walks *down* the page as content is written.
 */

export const PAGE_W = 595.28;
export const PAGE_H = 841.89;

/**
 * Real Helvetica advance widths for codes 32..126, in 1/1000 em. Measuring
 * against them — rather than guessing an average — is what keeps right-aligned
 * number columns flush with each other.
 */
const W_REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const W_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

export type Font = "regular" | "bold";
export type Align = "left" | "right" | "center";
/** Red, green and blue, each 0..1. */
export type Rgb = [number, number, number];

export interface TextOpts {
  size?: number;
  font?: Font;
  color?: Rgb;
  align?: Align;
  /** Right edge for `align: "right"`, or the box's right edge for centring. */
  to?: number;
}

/** Width of `text` at `size` points. */
export function textWidth(text: string, size: number, font: Font = "regular"): number {
  const table = font === "bold" ? W_BOLD : W_REGULAR;
  let em = 0;
  for (const ch of text) {
    em += table[ch.charCodeAt(0) - 32] ?? 556;
  }
  return (em * size) / 1000;
}

/** Cut a string down to `max` points, ending in an ellipsis when it does not fit. */
export function ellipsize(text: string, max: number, size: number, font: Font = "regular"): string {
  if (textWidth(text, size, font) <= max) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, size, font) > max) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/** WinAnsi has no room for anything above 0xFF, and `(`, `)`, `\` end a string. */
function escape(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code < 32 || code > 255) out += "?";
    else out += ch;
  }
  return out;
}

const num = (n: number): string => (Math.round(n * 100) / 100).toString();
const rgb = (c: Rgb): string => `${num(c[0])} ${num(c[1])} ${num(c[2])}`;

export class Pdf {
  private readonly pages: string[] = [];
  private ops: string[] = [];
  /** Baseline the next line is written on, measured from the bottom. */
  y: number;

  constructor(
    readonly margin = 36,
    /** Drawn bottom-centre on every page, with `#` replaced by "1 of 4". */
    private readonly footer = "",
  ) {
    this.y = PAGE_H - margin;
  }

  get left(): number {
    return this.margin;
  }

  get right(): number {
    return PAGE_W - this.margin;
  }

  get innerWidth(): number {
    return PAGE_W - this.margin * 2;
  }

  text(value: string, x: number, opts: TextOpts = {}): void {
    const { size = 9, font = "regular", color = [0, 0, 0], align = "left", to = this.right } = opts;
    const body = escape(value);
    if (!body) return;
    let at = x;
    if (align === "right") at = to - textWidth(value, size, font);
    else if (align === "center") at = x + (to - x - textWidth(value, size, font)) / 2;
    this.ops.push(
      `BT /${font === "bold" ? "F2" : "F1"} ${num(size)} Tf ${rgb(color)} rg ${num(at)} ${num(this.y)} Td (${body}) Tj ET`,
    );
  }

  /** Filled rectangle, given by its top-left corner. */
  rect(x: number, top: number, w: number, h: number, color: Rgb): void {
    this.ops.push(`${rgb(color)} rg ${num(x)} ${num(top - h)} ${num(w)} ${num(h)} re f`);
  }

  hairline(top: number, color: Rgb, x = this.left, to = this.right, weight = 0.6): void {
    this.ops.push(
      `${rgb(color)} RG ${num(weight)} w ${num(x)} ${num(top)} m ${num(to)} ${num(top)} l S`,
    );
  }

  /** Move the cursor down. */
  down(points: number): void {
    this.y -= points;
  }

  /** The lowest baseline content may use, with room left for the footer. */
  get bottom(): number {
    return this.margin + (this.footer ? 24 : 0);
  }

  /**
   * Start a new page when `height` more points will not fit. Returns true when
   * it broke, so a table can repeat its header row at the top of the new page.
   */
  breakIfNeeded(height: number): boolean {
    if (this.y - height >= this.bottom) return false;
    this.newPage();
    return true;
  }

  newPage(): void {
    this.pages.push(this.ops.join("\n"));
    this.ops = [];
    this.y = PAGE_H - this.margin;
  }

  /** Close the document and hand back the bytes. */
  blob(): Blob {
    const streams = [...this.pages, this.ops.join("\n")];
    const total = streams.length;
    const body = streams.map((stream, i) => this.withFooter(stream, i + 1, total));

    // 1 catalog, 2 page tree, 3/4 fonts, then a page and a content object each.
    const pageId = (i: number): number => 5 + i * 2;
    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Count ${total} /Kids [${body.map((_, i) => `${pageId(i)} 0 R`).join(" ")}] >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];
    for (const [i, stream] of body.entries()) {
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId(i) + 1} 0 R >>`,
      );
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    }

    let out = "%PDF-1.4\n";
    const offsets: number[] = [];
    for (const [i, obj] of objects.entries()) {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${obj}\nendobj\n`;
    }

    const xref = out.length;
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const at of offsets) out += `${String(at).padStart(10, "0")} 00000 n \n`;
    out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

    // Every byte written above is Latin-1, so one char is one byte.
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: "application/pdf" });
  }

  /** "Page 2 of 3" can only be written once the last page is known. */
  private withFooter(stream: string, page: number, total: number): string {
    if (!this.footer) return stream;
    const label = this.footer.replace("#", `${page} of ${total}`);
    const x = this.left + (this.innerWidth - textWidth(label, 8)) / 2;
    return `${stream}\nBT /F1 8 Tf 0.55 0.55 0.6 rg ${num(x)} ${num(this.margin)} Td (${escape(label)}) Tj ET`;
  }
}
