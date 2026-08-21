/**
 * The history screen, as a PDF: one table, laid out to land on ONE page.
 *
 * Every day is a banded row carrying its own totals, and that day's sessions and
 * breaks are the plain rows directly beneath it — so the day and the punches
 * that add up to it are read together instead of being looked up twice.
 *
 * Two things buy the single page. The report is measured before anything is
 * drawn and scaled to fit (never up, and never past the point of being
 * readable), and when it still will not fit, the table runs in two columns.
 * Only a selection far bigger than a full month spills onto a second page.
 */
import type { DayEntry, Totals } from "./history";
import { Pdf, PAGE_H, ellipsize, type Align, type Rgb } from "./pdf";
import { clockShort, clockTime, dateDMY, dayMonth, hm, weekday } from "./time";

const INK: Rgb = [0.09, 0.09, 0.12];
const MUTED: Rgb = [0.42, 0.43, 0.5];
const FAINT: Rgb = [0.62, 0.63, 0.68];
const LINE: Rgb = [0.85, 0.86, 0.9];
const BAND: Rgb = [0.95, 0.955, 0.97];
const DAY_BAND: Rgb = [0.91, 0.925, 0.95];
const GREEN: Rgb = [0.11, 0.51, 0.33];
const AMBER: Rgb = [0.68, 0.45, 0.06];
const ACCENT: Rgb = [0.29, 0.34, 0.72];

const MARGIN = 36;
const ROW_H = 13.5;
const HEAD_H = 16.5;
const PAD = 5;
const GUTTER = 18;
/**
 * Below this the type stops being readable, and an illegible single page helps
 * nobody — so a selection that would need it flows over at a comfortable size
 * instead. Anything up to a very full month still lands on one page.
 */
const ONE_PAGE_FLOOR = 0.63;
/** Used when one page is off the table; roomy enough to read at a glance. */
const COMFORT_SCALE = 0.85;

interface Column {
  title: string;
  width: number;
  align?: Align;
}

/**
 * Day rows and punch rows share this grid, which is what makes it one table:
 * a day fills the totals on the right, a punch fills the times in the middle.
 */
const WIDE: Column[] = [
  { title: "Date", width: 72 },
  { title: "Session / break", width: 74 },
  { title: "Type", width: 44 },
  { title: "In", width: 62 },
  { title: "Out", width: 62 },
  { title: "Length", width: 52, align: "right" },
  { title: "Day work", width: 54, align: "right" },
  { title: "Day break", width: 54, align: "right" },
  { title: "Leave by", width: 49.28 },
];

/** The same rows at half width, for when the table has to run two-up. */
const NARROW: Column[] = [
  { title: "Date / entry", width: 74 },
  { title: "Type", width: 38 },
  { title: "In", width: 50 },
  { title: "Out", width: 50 },
  { title: "Time", width: 40.64, align: "right" },
];

interface Cell {
  text: string;
  color?: Rgb;
  bold?: boolean;
}

/** Vertical metrics, all scaled by the same factor so proportions hold. */
interface Style {
  scale: number;
  row: number;
  head: number;
  cell: number;
}

/** A line of the table: a day and its totals, or one session or break. */
interface Entry {
  kind: "day" | "punch" | "totals";
  day?: DayEntry;
  caption?: string;
  isWork?: boolean;
  from?: string;
  to?: string;
  length?: string;
  /** A day that has no punches at all. */
  bare?: boolean;
}

/** Left edge of every column in the table. */
function edges(left: number, columns: Column[]): number[] {
  const out = [left];
  for (const c of columns) out.push((out[out.length - 1] ?? left) + c.width);
  return out;
}

const totalWidth = (columns: Column[]): number => columns.reduce((sum, c) => sum + c.width, 0);

/** Days and their punches, interleaved into the single list the table draws. */
function entriesOf(days: DayEntry[]): Entry[] {
  const out: Entry[] = [];
  for (const day of days) {
    const blocks = day.result.blocks;
    out.push({ kind: "day", day, bare: blocks.length === 0 });
    let work = 0;
    let brk = 0;
    for (const block of blocks) {
      const isWork = block.kind === "work";
      out.push({
        kind: "punch",
        day,
        caption: isWork ? `Session ${(work += 1)}` : `Break ${(brk += 1)}`,
        isWork,
        from: clockTime(block.from),
        to: block.live ? "Running" : clockTime(block.to),
        length: hm(block.to - block.from),
      });
    }
  }
  return out;
}

/** What one entry puts in each column. `cont` marks a day resumed in a new column. */
function cellsOf(entry: Entry, totals: Totals, cols: number, cont = false): (Cell | null)[] {
  const wide = cols === 1;

  if (entry.kind === "totals") {
    const label = `${totals.days} ${totals.days === 1 ? "day" : "days"}`;
    return wide
      ? [
          { text: label, bold: true },
          { text: "Totals", bold: true },
          null,
          null,
          null,
          { text: hm(totals.office), bold: true },
          { text: hm(totals.worked), color: GREEN, bold: true },
          { text: hm(totals.breakMs), color: AMBER, bold: true },
          null,
        ]
      : [
          // No room for both totals here; the strip at the top carries the rest.
          { text: `${label} worked`, bold: true },
          null,
          null,
          null,
          { text: hm(totals.worked), color: GREEN, bold: true },
        ];
  }

  const day = entry.day;
  if (!day) return [];
  const r = day.result;

  if (entry.kind === "day") {
    const out = r.status === "working" ? "Running" : clockTime(r.last);
    const name = `${weekday(day.at)}${cont ? " (cont.)" : ""}`;
    return wide
      ? [
          { text: dateDMY(r.first ?? day.at), bold: true },
          { text: entry.bare ? "No punches" : name, color: entry.bare ? FAINT : MUTED, bold: !entry.bare },
          null,
          { text: clockTime(r.first), bold: true },
          { text: out, bold: true },
          { text: hm(r.office), bold: true },
          { text: hm(r.worked), color: GREEN, bold: true },
          { text: hm(r.breakMs), color: AMBER, bold: true },
          { text: r.leave == null ? "--:--" : clockShort(r.leave), color: MUTED },
        ]
      : [
          {
            // Half width has no room for the weekday and the marker both.
            text: cont
              ? `${dayMonth(day.at)} (cont.)`
              : `${dayMonth(day.at)} ${weekday(day.at).slice(0, 3)}`,
            bold: true,
          },
          entry.bare ? { text: "none", color: FAINT } : null,
          { text: clockTime(r.first), bold: true },
          { text: out, bold: true },
          { text: hm(r.worked), color: GREEN, bold: true },
        ];
  }

  const type = { text: entry.isWork ? "Work" : "Break", color: entry.isWork ? GREEN : AMBER };
  // The leading space is the indent that hangs a punch under its day.
  const caption = { text: `  ${entry.caption ?? ""}`, color: entry.isWork ? INK : MUTED };
  return wide
    ? [
        null,
        caption,
        type,
        { text: entry.from ?? "" },
        { text: entry.to ?? "" },
        { text: entry.length ?? "", bold: entry.isWork },
        null,
        null,
        null,
      ]
    : [
        caption,
        type,
        { text: entry.from ?? "" },
        { text: entry.to ?? "" },
        { text: entry.length ?? "", bold: entry.isWork },
      ];
}

/** The grey band of column titles, repeated above every column of the table. */
function head(doc: Pdf, columns: Column[], x0: number, style: Style): void {
  const x = edges(x0, columns);
  doc.rect(x0, doc.y + style.head * 0.61, totalWidth(columns), style.head, BAND);
  columns.forEach((col, i) => {
    const from = x[i] ?? x0;
    doc.text(col.title, from + PAD, {
      size: style.cell * 0.94,
      font: "bold",
      color: MUTED,
      align: col.align ?? "left",
      to: from + col.width - PAD,
    });
  });
  doc.down(style.head);
}

/** One line of the table. Day rows get the darker band that groups them. */
function row(
  doc: Pdf,
  columns: Column[],
  x0: number,
  cells: (Cell | null)[],
  style: Style,
  band: Rgb | null,
): void {
  const x = edges(x0, columns);
  if (band) doc.rect(x0, doc.y + style.row * 0.67, totalWidth(columns), style.row, band);
  columns.forEach((col, i) => {
    const cell = cells[i];
    if (!cell || !cell.text) return;
    const from = x[i] ?? x0;
    const font = cell.bold ? "bold" : "regular";
    doc.text(ellipsize(cell.text, col.width - PAD * 2, style.cell, font), from + PAD, {
      size: style.cell,
      font,
      color: cell.color ?? INK,
      align: col.align ?? "left",
      to: from + col.width - PAD,
    });
  });
  doc.down(style.row);
}

/**
 * The table, in `cols` columns. Rows are dealt down the first column and then
 * the second, evenly, and a column that opens on a punch restates the day it
 * belongs to — a time with no date above it says nothing.
 */
function table(doc: Pdf, entries: Entry[], totals: Totals, cols: number, style: Style): void {
  const columns = cols === 1 ? WIDE : NARROW;
  const width = totalWidth(columns);
  let i = 0;

  while (i < entries.length) {
    const top = doc.y;
    const fits = Math.max(2, Math.floor((top - doc.bottom - style.head) / style.row));
    const per = Math.min(fits, Math.ceil((entries.length - i) / cols));

    for (let c = 0; c < cols && i < entries.length; c += 1) {
      doc.y = top;
      const x0 = doc.left + c * (width + GUTTER);
      head(doc, columns, x0, style);

      const opener = entries[i];
      const restated = opener?.kind === "punch" && opener.day;
      if (restated) {
        row(doc, columns, x0, cellsOf({ kind: "day", day: opener.day }, totals, cols, true), style, DAY_BAND);
      }

      // At least one real entry per column, or a restated day row on a short
      // column would leave nothing consumed and the loop would never end.
      const quota = Math.max(1, per - (restated ? 1 : 0));
      for (let used = 0; used < quota && i < entries.length; used += 1, i += 1) {
        const entry = entries[i];
        if (!entry) break;
        if (entry.kind === "totals") doc.hairline(doc.y + style.row * 0.67, LINE);
        row(
          doc,
          columns,
          x0,
          cellsOf(entry, totals, cols),
          style,
          entry.kind === "day" ? DAY_BAND : null,
        );
      }
    }

    if (i < entries.length) doc.newPage();
  }
}

export interface ReportMeta {
  /** "Aug 2026" or "All stored days" — what the month filter was set to. */
  scope: string;
  /** Whatever was typed in the search box, if anything. */
  query?: string;
  /** When the report was made. */
  at: number;
}

/** Height the whole report wants at full size, with the table in `cols`. */
function heightOf(rows: number, cols: number): number {
  const header = 73; // title, scope line and the totals strip
  return header + HEAD_H + Math.ceil(rows / cols) * ROW_H + 6;
}

/**
 * Pick the layout. One wide column is preferred while it fits, and a small
 * shrink beats splitting the table in two; past that, two columns and whatever
 * scale it takes — unless that would be too small to read, in which case the
 * report stays comfortable and runs onto another page.
 */
function planLayout(rows: number): { cols: number; style: Style } {
  const room = PAGE_H - MARGIN * 2 - 24;
  const wide = room / heightOf(rows, 1);
  // Each extra column can need a restated day row, so budget one for it.
  const split = room / heightOf(rows + 1, 2);

  const cols = wide >= 0.85 ? 1 : 2;
  const need = cols === 1 ? wide : split;
  const scale = need >= 1 ? 1 : need >= ONE_PAGE_FLOOR ? need : COMFORT_SCALE;

  return {
    cols,
    style: {
      scale,
      row: ROW_H * scale,
      head: HEAD_H * scale,
      cell: (cols === 1 ? 8.5 : 8) * scale,
    },
  };
}

/** The visible history as a print-ready PDF — one page wherever it can be. */
export function historyPdf(days: DayEntry[], totals: Totals, meta: ReportMeta): Blob {
  const entries = entriesOf(days);
  if (entries.length > 0) entries.push({ kind: "totals" });
  const { cols, style } = planLayout(entries.length);
  const s = style.scale;
  const doc = new Pdf(MARGIN, "Office time history  ·  page #");

  doc.down(6 * s);
  doc.text("Office time history", doc.left, { size: 17 * s, font: "bold", color: INK });
  doc.text(`Generated ${dateDMY(meta.at)}, ${clockTime(meta.at)}`, doc.left, {
    size: 8.5 * s,
    color: MUTED,
    align: "right",
  });
  doc.down(15 * s);

  const filtered = meta.query?.trim() ? `  ·  matching "${meta.query.trim()}"` : "";
  doc.text(`${meta.scope}${filtered}`, doc.left, { size: 10 * s, color: ACCENT });
  doc.down(18 * s);

  doc.rect(doc.left, doc.y + 12 * s, doc.innerWidth, 30 * s, BAND);
  const facts: [string, string, Rgb][] = [
    ["Days", String(totals.days), INK],
    ["Worked", hm(totals.worked), GREEN],
    ["Break", hm(totals.breakMs), AMBER],
    ["In office", hm(totals.office), INK],
    ["Avg / day", hm(totals.worked / Math.max(1, totals.days)), INK],
  ];
  const cell = doc.innerWidth / facts.length;
  facts.forEach(([label], i) =>
    doc.text(label, doc.left + cell * i + 8, { size: 7.5 * s, color: MUTED }),
  );
  doc.down(13 * s);
  facts.forEach(([, value, color], i) =>
    doc.text(value, doc.left + cell * i + 8, { size: 11 * s, font: "bold", color }),
  );
  doc.down(21 * s);

  if (entries.length === 0) {
    doc.text("No days in this selection.", doc.left, { size: 9, color: MUTED });
    return doc.blob();
  }

  table(doc, entries, totals, cols, style);
  return doc.blob();
}

export function historyPdfFilename(meta: ReportMeta): string {
  const stamp = dateDMY(meta.at).replace(/\//g, "-");
  const scope = meta.scope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `office-time-history-${scope}-${stamp}.pdf`;
}
