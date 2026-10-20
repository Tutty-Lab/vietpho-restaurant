import type { Employee, Schedule, Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_DE,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToDecimalHours, minutesToTime } from "../lib/time";
import { MONTH_NAMES_DE } from "../lib/dateFormat";
import { holidayNames as holidayNamesOf } from "../lib/holidays";
import { azubiTimesheetMode, isAzubiSchoolTermDate } from "../lib/azubi";
import { format } from "date-fns";
import { hourStatsFor } from "../lib/zuschlaege";

// Deutscher Monats-Titel für das offizielle Dokument.
function monthLabelDe(year: number, month: number): string {
  return `${MONTH_NAMES_DE[month - 1]} ${year}`;
}

function employmentLabelDe(employee: Employee, year: number, month: number): string {
  if (employee.employmentType === "VOLLZEIT") return "Vollzeit";
  if (employee.employmentType === "TEILZEIT") return "Teilzeit";

  const mode = azubiTimesheetMode(employee.azubi, year, month);
  if (mode === "off") return "Ausbildung - kein Einsatz";
  if (mode === "work") return "Ausbildung - Arbeit";
  return "Ausbildung - Schule/Arbeit";
}

/**
 * Ein A4-freundlicher Stundenzettel für einen Mitarbeiter.
 * Wird sowohl für die Bildschirm-Vorschau als auch für den Druck verwendet.
 */
export function StundenzettelPage({
  schedule,
  employee,
  dates,
  periodLabel,
}: {
  schedule: Schedule;
  employee: Employee;
  /** Nur diese Tage zeigen (Wochen-Stundenzettel); fehlend => ganzer Monat. */
  dates?: string[];
  /** Zeitraum-Text oben rechts; fehlend => Monat/Jahr. */
  periodLabel?: string;
}) {
  const rows = dates ?? datesOfMonth(schedule.year, schedule.month);
  const byDate = new Map<string, Shift>();
  const employeeShifts = schedule.shifts.filter((shift) => shift.employeeId === employee.id);
  for (const shift of employeeShifts) byDate.set(shift.date, shift);

  // Beim Wochen-Zettel zählen nur die Dienste der gezeigten Tage.
  const shownShifts = employeeShifts.filter((s) => rows.includes(s.date));
  const totalMinutes = shownShifts.reduce((total, shift) => total + shift.paidMinutes, 0);
  // Azubi receive no Zuschlaege; keep their timesheet focused on worked hours.
  const isAzubi = employee.employmentType === "AZUBI";
  const holidayNames = holidayNamesOf(schedule.year, schedule.holidayState);
  const closedByDate = new Map(
    schedule.dateOverrides.filter((o) => o.closed).map((o) => [o.date, o] as const),
  );

  return (
    <div className="print-document-page stundenzettel-page bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Stundenaufzeichnung</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">
          <div>{periodLabel ?? monthLabelDe(schedule.year, schedule.month)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-3">
        <Info label="Firmenname" value={schedule.companyName || "—"} />
        <Info
          label="Beschäftigungsart"
          value={employmentLabelDe(employee, schedule.year, schedule.month)}
        />
        <Info label="Mitarbeiter" value={employee.name} />
        <Info label="Monat" value={MONTH_NAMES_DE[schedule.month - 1]} />
        <Info label="Jahr" value={String(schedule.year)} />
      </div>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-slate-100">
            <Th>Datum</Th>
            <Th>Wochentag</Th>
            <Th>Arbeitsbeginn</Th>
            <Th>Arbeitsende</Th>
            <Th>Pause</Th>
            <Th>Arbeitszeit</Th>
            <Th className="text-left">Bemerkung</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const s = byDate.get(d);
            const wd = WEEKDAY_LABELS_DE[weekdayKeyOf(parseIsoDate(d))];
            const holiday = holidayNames.get(d);
            const closed = closedByDate.get(d);
            const isWeekend = wd === "Samstag" || wd === "Sonntag";
            const isSchoolTermWeekday =
              employee.employmentType === "AZUBI" &&
              !isWeekend &&
              isAzubiSchoolTermDate(employee.azubi, d);
            let bemerkung: string;
            if (s) {
              bemerkung = holiday ? `Feiertag: ${holiday}` : "";
            } else if (closed) {
              bemerkung = closed.note || "Betriebsruhe";
            } else if (holiday) {
              bemerkung = `Frei (Feiertag: ${holiday})`;
            } else if (isSchoolTermWeekday) {
              bemerkung = "Berufsschule";
            } else {
              bemerkung = "Frei";
            }
            return (
              <tr key={d} className={isWeekend || holiday || closed ? "bg-slate-50" : ""}>
                <Td>{format(parseIsoDate(d), "dd.MM.yyyy")}</Td>
                <Td>{wd}</Td>
                {/* Geteilter Dienst: beide Stücke untereinander, so wie es auch
                    im handgeschriebenen Formular steht. */}
                <Td className="text-center">
                  {s
                    ? (s.segments ?? [s]).map((g, i) => (
                        <div key={i}>{minutesToTime(g.startMinutes)}</div>
                      ))
                    : ""}
                </Td>
                <Td className="text-center">
                  {s
                    ? (s.segments ?? [s]).map((g, i) => (
                        <div key={i}>{minutesToTime(g.endMinutes)}</div>
                      ))
                    : ""}
                </Td>
                <Td className="text-center">{s && s.pauseMinutes > 0 ? `${s.pauseMinutes} Min` : ""}</Td>
                <Td className="text-center">
                  {!s
                    ? "0,00"
                    : s.segments && s.segments.length > 1
                      ? s.segments.map((g, i) => (
                          <div key={i}>{minutesToDecimalHours(g.endMinutes - g.startMinutes)}</div>
                        ))
                      : minutesToDecimalHours(s.paidMinutes)}
                </Td>
                <Td className="text-left text-slate-500">{bemerkung}</Td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold bg-slate-100">
            <Td className="text-left" colSpan={5}>
              Gesamtstunden
            </Td>
            <Td className="text-center">{minutesToDecimalHours(totalMinutes)}</Td>
            <Td />
          </tr>
        </tfoot>
      </table>

      {/* Leere Felder – der Chef trägt die Stunden von Hand ein. */}
      <div className="mt-3 grid grid-cols-3 gap-4 text-[12px]">
        <HandField label="Gesamtstunden" />
        {!isAzubi && (
          <>
            <HandField label="Nachtstunden (ab 20 Uhr)" />
            <HandField label="Sonntagsstunden" />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Seite 1 der Stundenzettel-PDF als Vorschau: je Mitarbeiter Gesamt-, Nacht-
 * (ab 20 Uhr, ohne Sonntag) und Sonntagsstunden – gleiche Zahlen wie pdf.ts.
 */
export function StundenUebersichtPage({
  schedule,
  employees,
  dates,
  periodLabel,
}: {
  schedule: Schedule;
  employees: readonly Employee[];
  dates?: string[];
  periodLabel?: string;
}) {
  const days = dates ?? datesOfMonth(schedule.year, schedule.month);
  const rows = employees.map((employee) => ({ employee, stats: hourStatsFor(schedule.shifts, employee.id, days) }));
  const sum = rows.reduce(
    (acc, { stats }) => ({ total: acc.total + stats.total, night: acc.night + stats.night, sunday: acc.sunday + stats.sunday }),
    { total: 0, night: 0, sunday: 0 },
  );
  const num = "px-2 py-1.5 text-right tabular-nums";
  return (
    <div className="bg-white text-slate-900 mx-auto max-w-[210mm] p-6 text-[12px]">
      <div className="flex items-start justify-between border-b-2 border-slate-800 pb-2 mb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Stundenübersicht</h2>
          <p className="text-slate-600">{schedule.companyName || "—"}</p>
          {schedule.address && <p className="text-slate-500 text-[11px]">{schedule.address}</p>}
        </div>
        <div className="text-right text-slate-600">{periodLabel ?? monthLabelDe(schedule.year, schedule.month)}</div>
      </div>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-slate-100 border-b border-slate-600">
            <th className="px-2 py-1.5 text-left font-semibold">Mitarbeiter</th>
            <th className={`${num} font-semibold`}>Gesamtstunden</th>
            <th className={`${num} font-semibold`}>Nachtstunden (ab 20 Uhr)</th>
            <th className={`${num} font-semibold`}>Sonntagsstunden</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ employee, stats }) => (
            <tr key={employee.id} className="border-b border-slate-200">
              <td className="px-2 py-1.5">{employee.name}</td>
              <td className={num}>{minutesToDecimalHours(stats.total)}</td>
              <td className={num}>{minutesToDecimalHours(stats.night)}</td>
              <td className={num}>{minutesToDecimalHours(stats.sunday)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-600 font-semibold">
            <td className="px-2 py-1.5">Summe</td>
            <td className={num}>{minutesToDecimalHours(sum.total)}</td>
            <td className={num}>{minutesToDecimalHours(sum.night)}</td>
            <td className={num}>{minutesToDecimalHours(sum.sunday)}</td>
          </tr>
        </tfoot>
      </table>
      <p className="mt-3 text-[10px] text-slate-500">
        Nachtstunden: bezahlte Arbeitszeit ab 20:00 Uhr (ohne Pause), ohne Sonntage. Sonntagsstunden: gesamte
        bezahlte Arbeitszeit an Sonntagen (nicht doppelt als Nacht gezählt). Angaben in Stunden.
      </p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}:</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Th({ children, className = "" }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border border-slate-300 px-2 py-1 text-center font-semibold ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = "",
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-slate-300 px-2 py-[3px] ${className}`}>
      {children}
    </td>
  );
}

function HandField({ label }: { label: string }) {
  return (
    <div>
      <div className="text-slate-500">{label}</div>
      <div className="mt-6 w-40 border-b border-slate-400" />
    </div>
  );
}
