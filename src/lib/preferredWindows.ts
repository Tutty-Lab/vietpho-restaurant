// ============================================================================
// „Khung giờ ưu tiên": weiche Wunsch-Zeitfenster je Mitarbeiter/in.
// ============================================================================

import type { Employee, PreferredWindow, ShiftSegment, WeekdayName } from "../types";
import { minutesToTime } from "./time";

const DAY_LABELS: Record<WeekdayName, string> = {
  monday: "T2",
  tuesday: "T3",
  wednesday: "T4",
  thursday: "T5",
  friday: "T6",
  saturday: "T7",
  sunday: "CN",
};
const DAY_ORDER: WeekdayName[] = [
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
];

/** Nur gültige Fenster (mind. ein Tag, Ende nach Beginn). */
export function preferredWindowsOf(employee: Employee): PreferredWindow[] {
  return (employee.preferredWindows ?? []).filter(
    (w) => w.days.length > 0 && w.endMinutes > w.startMinutes,
  );
}

export function hasPreferredWindows(employee: Employee): boolean {
  return preferredWindowsOf(employee).length > 0;
}

/** Fenster, die an diesem Wochentag gelten. */
export function preferredWindowsOn(employee: Employee, weekday: WeekdayName): PreferredWindow[] {
  return preferredWindowsOf(employee).filter((w) => w.days.includes(weekday));
}

/** true, wenn die Person Fenster hat, aber keines an diesem Wochentag. */
export function isUnpreferredDay(employee: Employee, weekday: WeekdayName): boolean {
  return hasPreferredWindows(employee) && preferredWindowsOn(employee, weekday).length === 0;
}

/**
 * Arbeitsminuten außerhalb der Wunschfenster dieses Wochentags (0 ohne
 * Fenster). An einem Tag ganz ohne Fenster zählt jede Minute.
 */
export function minutesOutsidePreferred(
  employee: Employee,
  weekday: WeekdayName,
  segments: readonly ShiftSegment[],
): number {
  if (!hasPreferredWindows(employee)) return 0;
  const windows = preferredWindowsOn(employee, weekday);
  let outside = 0;
  for (const g of segments) {
    for (let t = g.startMinutes; t < g.endMinutes; t += 15) {
      const end = Math.min(t + 15, g.endMinutes);
      if (!windows.some((w) => w.startMinutes <= t && end <= w.endMinutes)) outside += end - t;
    }
  }
  return outside;
}

/** Eigene Schichtlänge („Độ dài ca") in Minuten, sonst null. */
export function ownShiftRangeMinutes(employee: Employee): { min: number; max: number } | null {
  const r = employee.shiftHours;
  if (!r || !(r.min > 0) || !(r.max >= r.min)) return null;
  return { min: Math.round(r.min * 60), max: Math.round(r.max * 60) };
}

/** Erlaubte Längen (in 0,5-h-Schritten) innerhalb der eigenen Schichtlänge. */
export function ownShiftHourOptions(employee: Employee): number[] | null {
  const r = ownShiftRangeMinutes(employee);
  if (!r) return null;
  const out: number[] = [];
  for (let m = Math.ceil(r.min / 30) * 30; m <= r.max; m += 30) out.push(m / 60);
  return out.length > 0 ? out : null;
}

/** Kurztext für Liste/Hinweise, z.B. „T2–T6 10:30–15:00". */
export function describePreferredWindow(w: PreferredWindow): string {
  return `${describeDays(w.days)} ${minutesToTime(w.startMinutes)}–${minutesToTime(w.endMinutes)}`;
}

function describeDays(days: readonly WeekdayName[]): string {
  const idx = DAY_ORDER.map((d, i) => (days.includes(d) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 7) return "Cả tuần";
  const runs: string[] = [];
  for (let k = 0; k < idx.length; ) {
    let j = k;
    while (j + 1 < idx.length && idx[j + 1] === idx[j] + 1) j++;
    const from = DAY_LABELS[DAY_ORDER[idx[k]]];
    const to = DAY_LABELS[DAY_ORDER[idx[j]]];
    runs.push(j - k >= 2 ? `${from}–${to}` : j > k ? `${from}, ${to}` : from);
    k = j + 1;
  }
  return runs.join(", ");
}
