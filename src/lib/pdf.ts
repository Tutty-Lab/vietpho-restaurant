// ============================================================================
// PDF-Export – ECHTES Vektor-PDF (Text + Linien), nicht mehr als Screenshot.
//
// Frühere Versionen haben die HTML-Seite mit html2canvas "abfotografiert" und
// das Bild in die PDF geklebt. Das war fragil: ob eine Seite sauber wird, hing
// an Font-Laden, Stylesheet-Laden, Klon-Timing, Browser und Speicher – die
// erste Seite kam z. B. gelegentlich ganz ohne Styles heraus. Deshalb musste
// man auf jedem Gerät nachkontrollieren.
//
// Jetzt zeichnen wir die PDF direkt mit jsPDF + autoTable: reiner Text und
// echte Tabellenlinien. Das Ergebnis ist DETERMINISTISCH – auf jedem Handy,
// Browser und In-App-Webview identisch, die Linien können nie "verschwinden",
// die Datei ist winzig, und es gibt kein Timing/keine Schrift zum Abwarten.
//
// Schrift: die eingebaute Helvetica (Standard-14, kein Nachladen). Sie deckt
// Deutsch inkl. Umlaute/ß ab. Vietnamesische Namen werden auf ASCII übertragen
// (siehe T()) – bewusst ohne Diakritika, so gewünscht.
// ============================================================================

import { jsPDF } from "jspdf";
import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  weekdayKeyOf,
} from "./demand";
import { minutesToDecimalHours, minutesToTime } from "./time";
import { MONTH_NAMES_DE } from "./dateFormat";
import { holidayNames } from "./holidays";
import { format } from "date-fns";

/** Dateiname säubern: Umlaute/Akzente weg, nur unbedenkliche Zeichen behalten. */
export function safeFileName(text: string): string {
  const plain = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // Akzente entfernen: "Tuấn" -> "Tuan"
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
  return plain.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "Stundenzettel";
}

// ── Text für die eingebaute Schrift aufbereiten ────────────────────────────
// Helvetica kann Latin-1 (inkl. ä ö ü ß). Alles darüber (vietnamesische
// Diakritika, Typo-Anführungszeichen, Gedankenstrich) wird auf ein passendes
// ASCII/Latin-1-Zeichen abgebildet, damit nie ein Kästchen/"?" erscheint.
const PUNCT: Record<string, string> = {
  "–": "-", // – en dash
  "—": "-", // — em dash
  "‘": "'",
  "’": "'",
  "‚": ",",
  "“": '"',
  "”": '"',
  "„": '"',
  "…": "...",
  " ": " ", // geschütztes Leerzeichen
};

function T(input: string | undefined | null): string {
  if (!input) return "";
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (PUNCT[ch]) {
      out += PUNCT[ch];
    } else if (code <= 0xff) {
      // Latin-1: Deutsch inkl. Umlaute/ß bleibt erhalten.
      out += ch;
    } else if (ch === "đ" || ch === "Đ") {
      out += ch === "đ" ? "d" : "D";
    } else {
      // z. B. vietnamesische Vokale: zerlegen und Diakritika entfernen.
      const stripped = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\xff]*$/.test(stripped) ? stripped : "";
    }
  }
  return out;
}

// ── gemeinsame Farb-/Maß-Konstanten ────────────────────────────────────────
const INK: [number, number, number] = [15, 23, 42]; // slate-900
const MUTED: [number, number, number] = [100, 116, 139]; // slate-500
const LINE: [number, number, number] = [71, 85, 105]; // slate-600
const GRID: [number, number, number] = [148, 163, 184]; // slate-400
const HEAD_FILL: [number, number, number] = [241, 245, 249]; // slate-100
const SHADE_FILL: [number, number, number] = [248, 250, 252]; // slate-50
const DIVIDER: [number, number, number] = [203, 213, 225]; // slate-300

const MARGIN = 14; // mm

/** Beschäftigungsart auf Deutsch (dieser Laden hat dafür kein eigenes Modul). */
function employmentLabelDe(type: Employee["employmentType"]): string {
  return type === "VOLLZEIT" ? "Vollzeit" : type === "TEILZEIT" ? "Teilzeit" : "Ausbildung";
}

function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

/** Kopfzeile (Titel links, Zeitraum rechts) + Trennlinie. Gibt neues Y zurück. */
function drawHeader(
  doc: jsPDF,
  title: string,
  schedule: Schedule,
  periodLabel: string,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN + 1;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(T(title), MARGIN, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...LINE);
  doc.text(T(periodLabel), pageW - MARGIN, y, { align: "right" });

  y += 4.5;
  doc.setFontSize(9);
  doc.setTextColor(...LINE);
  doc.text(T(schedule.companyName || "—"), MARGIN, y);
  if (schedule.address) {
    y += 3.6;
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(T(schedule.address), MARGIN, y);
  }

  y += 2.4;
  doc.setDrawColor(30, 41, 59); // slate-800
  doc.setLineWidth(0.5);
  doc.line(MARGIN, y, pageW - MARGIN, y);
  return y + 4;
}

/** Zweispaltiger Info-Block; gibt das Y darunter zurück. */
function drawInfoBlock(
  doc: jsPDF,
  pairs: Array<[string, string | null]>, // null = Feld zum Ausfüllen von Hand
  startY: number,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const colX = [MARGIN, pageW / 2 + 4];
  const labelW = 32;
  let y = startY;
  doc.setFontSize(8);

  for (let i = 0; i < pairs.length; i += 2) {
    for (let c = 0; c < 2; c++) {
      const pair = pairs[i + c];
      if (!pair) continue;
      const [label, value] = pair;
      const x = colX[c];
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.text(`${T(label)}:`, x, y);
      if (value === null) {
        // Leere Schreiblinie – wird auf dem Papier von Hand ergänzt.
        doc.setDrawColor(...GRID);
        doc.setLineWidth(0.2);
        doc.line(x + labelW, y, x + labelW + 45, y);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...INK);
        doc.text(T(value), x + labelW, y);
      }
    }
    y += 5;
  }
  return y + 1;
}

// ── Stundenzettel ──────────────────────────────────────────────────────────

type DayRow = {
  shaded: boolean;
  shiftCount: number;
  cells: string[]; // [datum/wd, beginn, ende, pause, arbeitszeit, bemerkung]
};

export function stundenzettelRowsFor(
  schedule: Schedule,
  employee: Employee,
  dates: string[],
): { rows: DayRow[]; totalMinutes: number } {
  const byDate = new Map<string, Shift[]>();
  for (const s of schedule.shifts) {
    if (s.employeeId !== employee.id) continue;
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.startMinutes - b.startMinutes);

  const feiertage = holidayNames(schedule.year, schedule.holidayState);
  const closedByDate = new Map(
    schedule.dateOverrides.filter((o) => o.closed).map((o) => [o.date, o] as const),
  );

  let totalMinutes = 0;
  const rows: DayRow[] = dates.map((d) => {
    const dienste = byDate.get(d) ?? [];
    totalMinutes += dienste.reduce((a, s) => a + s.paidMinutes, 0);
    const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
    const holiday = feiertage.get(d);
    const closed = closedByDate.get(d);
    const isWeekend = wd === "Samstag" || wd === "Sonntag";
    const shaded = Boolean(isWeekend || holiday || closed);
    const datum = `${format(parseIsoDate(d), "dd.MM.yyyy")}\n${wd}`;

    if (dienste.length === 0) {
      const bemerkung = closed
        ? closed.note || "Betriebsruhe"
        : holiday
          ? `Frei (Feiertag: ${holiday})`
          : "Frei";
      return { shaded, shiftCount: 0, cells: [datum, "", "", "", "0,00", bemerkung] };
    }

    // Geteilter Dienst (ca gãy): jedes Stück als eigene Zeile mit eigener
    // Arbeitszeit – nicht als ein durchgehender Block von Beginn bis Ende.
    // Die Lücke dazwischen ist unbezahlt und keine Pause.
    const pieces = dienste.flatMap((x) =>
      x.segments && x.segments.length > 1
        ? x.segments.map((g) => ({
            start: g.startMinutes,
            end: g.endMinutes,
            pause: "",
            paid: g.endMinutes - g.startMinutes,
          }))
        : [{
            start: x.startMinutes,
            end: x.endMinutes,
            pause: x.pauseMinutes > 0 ? `${x.pauseMinutes} Min` : "",
            paid: x.paidMinutes,
          }],
    );
    const beginn = pieces.map((x) => minutesToTime(x.start)).join("\n");
    const ende = pieces.map((x) => minutesToTime(x.end)).join("\n");
    const pause = pieces.map((x) => x.pause).join("\n");
    const arbeitszeit = pieces.map((x) => minutesToDecimalHours(x.paid)).join("\n");
    const bemerkung = holiday ? `Feiertag: ${holiday}` : "";
    return {
      shaded,
      shiftCount: pieces.length,
      cells: [datum, beginn, ende, pause, arbeitszeit, bemerkung],
    };
  });

  return { rows, totalMinutes };
}

// Spalten des Stundenzettels: x-Position, Breite, Ausrichtung. Rechte Kante 196.
const SZ_COLS: Array<{ x: number; w: number; align: "left" | "center" }> = [
  { x: 14, w: 30, align: "left" }, // Datum / Wochentag
  { x: 44, w: 26, align: "center" }, // Arbeitsbeginn
  { x: 70, w: 26, align: "center" }, // Arbeitsende
  { x: 96, w: 20, align: "center" }, // Pause
  { x: 116, w: 26, align: "center" }, // Arbeitszeit
  { x: 142, w: 54, align: "left" }, // Bemerkung
];
const SZ_LEFT = 14;
const SZ_RIGHT = 196;
const SZ_HEAD = ["Datum / Wochentag", "Arbeitsbeginn", "Arbeitsende", "Pause", "Arbeitszeit", "Bemerkung"];

/**
 * Zeichnet die Stundenzettel-Tabelle VON HAND (jsPDF-Primitive, ohne autoTable).
 *
 * Warum von Hand: die eingebundene autoTable-Version berechnet zwar alle Zeilen,
 * zeichnet im minifizierten Bundle aber nur einen Teil (ein ganzer Monat wurde
 * ab ~Tag 23 abgeschnitten). Selbst gezeichnet haben wir volle Kontrolle über die
 * Zeilenhöhe – ein ganzer Monat passt garantiert auf EINE Seite – und es gibt
 * keine Fremd-Bibliothek mehr, die Zeilen verschluckt.
 */
function drawStundenzettelTable(
  doc: jsPDF,
  startY: number,
  rows: DayRow[],
  totalMinutes: number,
): void {
  const FS = 6.5; // Schriftgröße (pt)
  const LH = 2.5; // Höhe je Textzeile (mm)
  const PADV = 0.7; // Innenabstand oben/unten (mm)
  const headH = LH + 2 * PADV;
  const footH = LH + 2 * PADV;

  doc.setFontSize(FS);
  doc.setFont("helvetica", "normal");

  // Zellinhalte in Zeilen zerlegen (Bemerkung ggf. auf Spaltenbreite umbrechen).
  const bodyLines = rows.map((r) =>
    r.cells.map((c, ci) => {
      const parts = T(c).split("\n");
      if (ci === 5 && T(c)) {
        return parts.flatMap((p) => (p ? (doc.splitTextToSize(p, SZ_COLS[ci].w - 3) as string[]) : [""]));
      }
      return parts;
    }),
  );
  const rowMax = bodyLines.map((cells) => Math.max(1, ...cells.map((l) => l.length)));
  const rowH = rowMax.map((n) => n * LH + 2 * PADV);

  const drawCellText = (
    text: string,
    ci: number,
    yBaseline: number,
    style: "normal" | "bold",
    color: [number, number, number],
  ) => {
    if (!text) return;
    const col = SZ_COLS[ci];
    doc.setFont("helvetica", style);
    doc.setTextColor(...color);
    const tx = col.align === "center" ? col.x + col.w / 2 : col.x + 1.5;
    doc.text(text, tx, yBaseline, { align: col.align });
  };

  // ---- Kopfzeile ----
  let y = startY;
  doc.setFillColor(...HEAD_FILL);
  doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, headH, "F");
  SZ_HEAD.forEach((h, ci) => drawCellText(h, ci, y + PADV + LH * 0.72, "bold", INK));
  y += headH;

  // ---- Datenzeilen ----
  const rowTops: number[] = [];
  rows.forEach((r, ri) => {
    const h = rowH[ri];
    rowTops.push(y);
    if (r.shaded) {
      doc.setFillColor(...SHADE_FILL);
      doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, h, "F");
    }
    // Ca sáng/ca chiều: dünne Trennlinie zwischen den Diensten (Spalten 1–4).
    if (r.shiftCount >= 2) {
      doc.setDrawColor(...DIVIDER);
      doc.setLineWidth(0.2);
      for (let k = 1; k < r.shiftCount; k++) {
        const yy = y + (h * k) / r.shiftCount;
        doc.line(SZ_COLS[1].x, yy, SZ_COLS[4].x + SZ_COLS[4].w, yy);
      }
    }
    bodyLines[ri].forEach((lines, ci) => {
      const offset = (rowMax[ri] - lines.length) / 2; // vertikal zentrieren
      lines.forEach((ln, j) => {
        const yBase = y + PADV + (offset + j) * LH + LH * 0.72;
        if (ci === 0 && j === 0) drawCellText(ln, ci, yBase, "bold", INK);
        else if (ci === 0 || ci === 5) drawCellText(ln, ci, yBase, "normal", MUTED);
        else drawCellText(ln, ci, yBase, "normal", INK);
      });
    });
    y += h;
  });

  // ---- Fußzeile (Gesamtstunden) ----
  const footTop = y;
  doc.setFillColor(...HEAD_FILL);
  doc.rect(SZ_LEFT, y, SZ_RIGHT - SZ_LEFT, footH, "F");
  drawCellText("Gesamtstunden", 0, y + PADV + LH * 0.72, "bold", INK);
  drawCellText(minutesToDecimalHours(totalMinutes), 4, y + PADV + LH * 0.72, "bold", INK);
  y += footH;
  const tableBottom = y;

  // ---- Gitter (nach den Füllungen, damit die Linien oben liegen) ----
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.2);
  for (const hy of [startY, ...rowTops, footTop, tableBottom]) doc.line(SZ_LEFT, hy, SZ_RIGHT, hy);
  for (const vx of [SZ_LEFT, ...SZ_COLS.slice(1).map((c) => c.x), SZ_RIGHT]) {
    doc.line(vx, startY, vx, tableBottom);
  }
}

/** Zeichnet EINEN Stundenzettel auf die aktuelle Seite. */
function drawStundenzettel(
  doc: jsPDF,
  schedule: Schedule,
  employee: Employee,
  dates: string[],
  periodLabel: string,
): void {
  const startY = drawHeader(doc, "Stundenaufzeichnung", schedule, periodLabel);
  const infoY = drawInfoBlock(
    doc,
    [
      ["Firmenname", schedule.companyName || "—"],
      ["Beschäftigungsart", employmentLabelDe(employee.employmentType)],
      ["Mitarbeiter", employee.name],
      ["Monat", MONTH_NAMES_DE[schedule.month - 1]],
      ["Jahr", String(schedule.year)],
    ],
    startY,
  );

  const { rows, totalMinutes } = stundenzettelRowsFor(schedule, employee, dates);

  drawStundenzettelTable(doc, infoY, rows, totalMinutes);

  // Zusammenfassung: FESTE Position im reservierten Band am Seitenende –
  // unabhängig davon, wo die Tabelle endet (keine Kollision).
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  const summaryY = pageH - 30;
  const col3 = (pageW - 2 * MARGIN) / 3;

  // Leere Schreiblinien – der Chef trägt die Stunden von Hand ein.
  // Azubis bekommen keine Zuschläge – nur die Gesamtstunden.
  const summary =
    employee.employmentType === "AZUBI"
      ? ["Gesamtstunden"]
      : ["Gesamtstunden", "Nachtstunden (ab 20 Uhr)", "Sonntagsstunden"];
  summary.forEach((label, i) => {
    const x = MARGIN + i * col3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(T(label), x, summaryY);
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.2);
    doc.line(x, summaryY + 7, x + 40, summaryY + 7);
  });
}

/**
 * Baut die Stundenzettel-PDF: eine A4-Seite je Mitarbeiter.
 * `dates` fehlt => ganzer Monat; `periodLabel` fehlt => Monat/Jahr.
 *
 * async + kurzer Yield je Seite: der Fortschritt (X/N) kann gerendert werden
 * und der Haupt-Thread bleibt auch auf schwachen Handys frei. Die Ausgabe
 * selbst ist trotzdem rein deterministisch – der Yield ändert nichts am Inhalt.
 */
export async function buildStundenzettelPdf(
  schedule: Schedule,
  employees: Employee[],
  opts: { dates?: string[]; periodLabel?: string } = {},
  onProgress?: (current: number, total: number) => void,
): Promise<jsPDF> {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const dates = opts.dates ?? datesOfMonth(schedule.year, schedule.month);
  const periodLabel = opts.periodLabel ?? monthLabelDe(schedule.year, schedule.month);

  for (let i = 0; i < employees.length; i++) {
    if (i > 0) doc.addPage();
    drawStundenzettel(doc, schedule, employees[i], dates, periodLabel);
    onProgress?.(i + 1, employees.length);
    if (employees.length > 1) await new Promise((r) => setTimeout(r, 0));
  }

  return doc;
}

// ── Datei ausliefern ─────────────────────────────────────────────────────────

/**
 * PDF-Blob direkt als Datei herunterladen. MIME application/octet-stream +
 * .pdf-Name => auch iOS Safari / In-App-Browser speichern die Datei, statt sie
 * in einen neuen Tab zu öffnen und dort hängen zu bleiben.
 */
export function deliver(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  // application/pdf statt octet-stream: Messenger/Zalo-WebView zeigt sonst Zeichensalat.
  const pdf = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  const url = URL.createObjectURL(pdf);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (document.body.contains(a)) document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 60_000);
}

/** jsPDF-Dokument als Datei speichern. */
export function savePdf(doc: jsPDF, filename: string): void {
  deliver(doc.output("blob"), filename);
}

// ── Schnittstelle wie bisher (die Oberfläche ruft genau diese Namen auf) ────

/** PDF-Dokument bauen: eine Seite je Mitarbeiter. */
export async function buildStundenzettelDoc(params: {
  schedule: Schedule;
  employees: Employee[];
  dates?: string[];
  periodLabel?: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<jsPDF> {
  return buildStundenzettelPdf(
    params.schedule,
    params.employees,
    { dates: params.dates, periodLabel: params.periodLabel },
    params.onProgress,
  );
}

/** PDF für einen oder mehrere Mitarbeiter bauen und herunterladen. */
export async function exportStundenzettelPdf(params: {
  schedule: Schedule;
  employees: Employee[];
  filename: string;
  dates?: string[];
  periodLabel?: string;
  onProgress?: (done: number, total: number) => void;
}): Promise<void> {
  if (params.employees.length === 0) return;
  const doc = await buildStundenzettelDoc(params);
  savePdf(doc, params.filename);
}

/** Alter Name des Downloads – bleibt als Alias erhalten. */
export const downloadPdfBlob = deliver;
