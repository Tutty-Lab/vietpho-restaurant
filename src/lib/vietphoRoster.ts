import type { Employee, Shift, ShiftSegment } from "../types";
import type { GenerateInput } from "./scheduler";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "./demand";
import { isEmployeeAvailableOn } from "./availability";
import { isEmployeeFixedDayOff } from "./fixedDaysOff";
import { holidaysOf } from "./holidays";
import { resolveDay } from "./workHours";
import { calculatePaidMinutes, calculatePause } from "./time";

export function vietphoRosterEmployees(employees: Employee[]): Employee[] {
  return employees.map((e) => {
    if (e.workRole !== "SERVICE" || e.employmentType === "AZUBI") return e;
    const hours = (e.baseTargetMinutes ?? e.targetMinutes) / 60;
    if (hours === 20) return { ...e, workDays: ["sunday"], fixedDaysOff: undefined };
    if (hours === 80) return { ...e, workDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], fixedDaysOff: undefined };
    return e;
  });
}

/** Fixed service visits and alternating kitchen coverage take priority over monthly targets. */
export function applyVietphoRoster(input: GenerateInput, original: Shift[]): Shift[] {
  input = { ...input, employees: vietphoRosterEmployees(input.employees) };
  const dates = datesOfMonth(input.year, input.month);
  const holidays = input.holidays ?? holidaysOf(input.year, input.holidayState ?? "BW");
  const kitchen = input.employees.filter((e) => e.workRole === "KITCHEN" && e.targetMinutes > 0);
  const service = input.employees.filter((e) => e.workRole === "SERVICE" && e.employmentType !== "AZUBI");
  const regular = service.filter((e) => (e.baseTargetMinutes ?? e.targetMinutes) === 80 * 60);
  const relief = service.filter((e) => (e.baseTargetMinutes ?? e.targetMinutes) === 20 * 60);
  const managed = new Set([...regular, ...relief, ...(kitchen.length === 2 ? kitchen : [])].map((e) => e.id));
  const result = original.filter((s) => !managed.has(s.employeeId));
  const available = (e: Employee, date: string) => isEmployeeAvailableOn(e, date) && !isEmployeeFixedDayOff(e, date);
  const add = (e: Employee, date: string, segments: ShiftSegment[]) => {
    if (!segments.length) return;
    const startMinutes = segments[0].startMinutes;
    const endMinutes = segments[segments.length - 1].endMinutes;
    const split = segments.length > 1;
    const continuousPause = [0, 30, 60].find((pause) =>
      calculatePause(endMinutes - startMinutes - pause) === pause) ?? 60;
    const paidMinutes = split
      ? segments.reduce((sum, s) => sum + s.endMinutes - s.startMinutes, 0)
      : calculatePaidMinutes(startMinutes, endMinutes, continuousPause);
    const pauseMinutes = split ? 0 : endMinutes - startMinutes - paidMinutes;
    result.push({ id: `vietpho-roster-${e.id}-${date}`, employeeId: e.id, date,
      startMinutes, endMinutes, paidMinutes, pauseMinutes,
      ...(split ? { segments } : {}), shiftType: "CUSTOM", generated: true });
  };
  const sundays = dates.filter((date) => parseIsoDate(date).getDay() === 0).length;
  for (const date of dates) {
    const day = resolveDay(input.workHours, date, holidays, input.overrides ?? {});
    if (day.closed || !day.blocks.length) continue;
    const weekday = weekdayKeyOf(parseIsoDate(date));
    const sunday = weekday === "sunday";
    for (const e of sunday ? relief : regular) {
      if (!available(e, date)) continue;
      const extra = sunday && sundays === 4 ? 30 : 0;
      const windows = [{ startMinutes: 720, endMinutes: 840 + extra }, { startMinutes: 1080, endMinutes: 1200 + extra }];
      add(e, date, windows.flatMap((w) => day.blocks.map((b) => ({
        startMinutes: Math.max(w.startMinutes, b.startMinutes), endMinutes: Math.min(w.endMinutes, b.endMinutes),
      })).filter((s) => s.endMinutes > s.startMinutes)));
    }
    if (kitchen.length !== 2) continue;
    // Preserve configured rest days; otherwise stagger one weekly rest day per cook.
    const active = kitchen.filter((e, i) => available(e, date) &&
      (e.fixedDaysOff?.length || parseIsoDate(date).getDay() !== i + 1));
    if (!active.length) continue;
    if (active.length === 1) { add(active[0], date, day.blocks.map((b) => ({ ...b }))); continue; }
    const week = Math.floor((parseIsoDate(date).getDate() - 1) / 7);
    const early = active[week % 2];
    const late = active[(week + 1) % 2];
    const total = day.blocks.reduce((sum, b) => sum + b.endMinutes - b.startMinutes, 0);
    let remaining = Math.ceil(total / 2 / 15) * 15;
    const earlySegments: ShiftSegment[] = [];
    const lateSegments: ShiftSegment[] = [];
    for (const b of day.blocks) {
      const cut = Math.min(b.endMinutes, b.startMinutes + remaining);
      if (cut > b.startMinutes) earlySegments.push({ startMinutes: b.startMinutes, endMinutes: cut });
      if (cut < b.endMinutes) lateSegments.push({ startMinutes: cut, endMinutes: b.endMinutes });
      remaining -= cut - b.startMinutes;
    }
    add(early, date, earlySegments);
    add(late, date, lateSegments);
  }
  // Spend remaining kitchen hours only on the optional Friday/Saturday dinner overlap.
  if (kitchen.length === 2) for (const date of dates) {
    if (![5, 6].includes(parseIsoDate(date).getDay())) continue;
    const day = resolveDay(input.workHours, date, holidays, input.overrides ?? {});
    if (!day.blocks.some((b) => b.startMinutes <= 1080 && b.endMinutes >= 1200)) continue;
    const shifts = result.filter((s) => s.date === date && kitchen.some((e) => e.id === s.employeeId));
    if (shifts.length !== 2) continue;
    for (const shift of shifts) {
      const e = kitchen.find((e) => e.id === shift.employeeId)!;
      const used = result.filter((s) => s.employeeId === e.id).reduce((sum, s) => sum + s.paidMinutes, 0);
      const segments = (shift.segments ?? [{ startMinutes: shift.startMinutes, endMinutes: shift.endMinutes }]).map((s) => ({ ...s }));
      const last = segments[segments.length - 1];
      if (last.endMinutes >= 1200) continue;
      last.endMinutes = 1200;
      const previous = result.indexOf(shift);
      add(e, date, segments);
      const candidate = result.pop()!;
      if (used + candidate.paidMinutes - shift.paidMinutes <= e.targetMinutes && candidate.paidMinutes <= 600) result[previous] = candidate;
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
