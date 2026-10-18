import { describe, expect, it } from "vitest";
import { applyVietphoRoster } from "../vietphoRoster";
import { defaultWorkHoursForStore, resolveDay } from "../workHours";
import { datesOfMonth, parseIsoDate } from "../demand";
import { validateSchedule } from "../validation";
import type { Employee } from "../../types";

const employees: Employee[] = [
  { id: "nga", name: "Nga", employmentType: "VOLLZEIT", workRole: "KITCHEN", targetMinutes: 160 * 60, fixedDaysOff: ["monday"] },
  { id: "hoang", name: "Hoang", employmentType: "VOLLZEIT", workRole: "KITCHEN", targetMinutes: 160 * 60, fixedDaysOff: ["tuesday"] },
  { id: "regular", name: "Service", employmentType: "TEILZEIT", workRole: "SERVICE", targetMinutes: 80 * 60 },
  { id: "relief", name: "Relief", employmentType: "TEILZEIT", workRole: "SERVICE", targetMinutes: 20 * 60 },
];
describe("Vietpho fixed roster", () => {
  for (const [month, sundays, daily] of [[10, 4, 300], [11, 5, 240]]) {
    it(`covers kitchen and Sunday relief in month ${month}`, () => {
      const workHours = defaultWorkHoursForStore("vietpho");
      const input = { year: 2026, month, employees, workHours, holidays: new Set<string>() };
      const shifts = applyVietphoRoster(input, []);
      const relief = shifts.filter((s) => s.employeeId === "relief");
      expect(relief).toHaveLength(sundays);
      expect(relief.every((s) => s.paidMinutes === daily && parseIsoDate(s.date).getDay() === 0)).toBe(true);
      expect(relief.reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(1200);
      expect(shifts.filter((s) => s.employeeId === "regular").every((s) => s.paidMinutes === 240 && parseIsoDate(s.date).getDay() !== 0)).toBe(true);
      for (const date of datesOfMonth(2026, month)) {
        const day = resolveDay(workHours, date, input.holidays);
        for (const block of day.blocks) for (let t = block.startMinutes; t < block.endMinutes; t += 15) {
          expect(shifts.some((s) => ["nga", "hoang"].includes(s.employeeId) && s.date === date &&
            (s.segments ?? [s]).some((segment) => segment.startMinutes <= t && segment.endMinutes >= t + 15))).toBe(true);
        }
      }
      const validation = validateSchedule(employees, shifts);
      expect(validation.errors.some((e) => e.employeeId === "regular" && e.kind === "hours" && e.severity === "warning")).toBe(true);
      expect(validation.errors.filter((e) => e.kind === "shift" && e.severity !== "warning")).toEqual([]);
    });
  }
});
