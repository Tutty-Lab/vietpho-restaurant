import type { Employee, Schedule } from "../types";
import { holidaysOf } from "./holidays";
import { resolveDay } from "./workHours";
import { vietphoGroupOf, vietphoOwnerSegments } from "./vietphoDemand";

export function vietphoOwnerForDate(schedule: Schedule, date: string, employees: Employee[]) {
  const day = resolveDay(schedule.workHours, date,
    holidaysOf(schedule.year, schedule.holidayState),
    Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o])));
  if (day.closed) return [];
  return vietphoOwnerSegments(day.blocks, schedule.shifts
    .filter((s) => s.date === date)
    .map((s) => ({
      group: vietphoGroupOf(employees.find((e) => e.id === s.employeeId) ?? {}),
      segments: s.segments ?? [s],
    })));
}
