import { describe, expect, it } from "vitest";
import { applyVietphoRoster, vietphoRosterEmployees } from "../vietphoRoster";
import { generateSchedule } from "../scheduler";
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
  it("preserves saved day selections, including explicitly unrestricted days, across reload normalization", () => {
    for (const workDays of [[], ["monday"], ["wednesday", "friday"]] as Employee["workDays"][]) {
      const employee = { ...employees[3], workDays, desiredDaysPerWeek: 2, spreadEvenly: true };
      const saved = JSON.parse(JSON.stringify(vietphoRosterEmployees([employee])));
      expect(vietphoRosterEmployees(saved)).toEqual([employee]);
    }
  });
  it("retains general-planner results for custom day count and even distribution", () => {
    const custom = employees.map((e) => ({ ...e, desiredDaysPerWeek: 2, spreadEvenly: true }));
    const original = [{ id: "custom", employeeId: "regular", date: "2026-10-01", startMinutes: 720, endMinutes: 840, paidMinutes: 120, pauseMinutes: 0, shiftType: "CUSTOM" as const, generated: true }];
    expect(applyVietphoRoster({ year: 2026, month: 10, employees: custom, workHours: defaultWorkHoursForStore("vietpho") }, original)).toEqual(original);
  });
  it("generates shifts on the selected weekdays rather than the service defaults", () => {
    const custom: Employee[] = employees.map((e) => e.id === "regular"
      ? { ...e, workDays: ["wednesday", "friday"], desiredDaysPerWeek: 2, spreadEvenly: true }
      : e.id === "relief" ? { ...e, workDays: ["monday"] } : e);
    const shifts = generateSchedule({ storeId: "vietpho", year: 2026, month: 10, employees: custom, workHours: defaultWorkHoursForStore("vietpho"), seed: "custom-days" });
    const regular = shifts.filter((s) => s.employeeId === "regular");
    expect(regular.length).toBeGreaterThan(0);
    expect(regular.every((s) => [3, 5].includes(parseIsoDate(s.date).getDay()))).toBe(true);
    const relief = shifts.filter((s) => s.employeeId === "relief");
    expect(relief.length).toBeGreaterThan(0);
    expect(relief.every((s) => parseIsoDate(s.date).getDay() === 1)).toBe(true);
  });
  for (const [month, sundays, daily] of [[10, 4, 300], [11, 5, 240]]) {
    it(`covers kitchen and Sunday relief in month ${month}`, () => {
      const workHours = defaultWorkHoursForStore("vietpho");
      const input = { year: 2026, month, employees, workHours, holidays: new Set<string>() };
      const shifts = applyVietphoRoster(input, []);
      const relief = shifts.filter((s) => s.employeeId === "relief");
      expect(relief).toHaveLength(sundays);
      expect(relief.every((s) => s.paidMinutes === daily && parseIsoDate(s.date).getDay() === 0)).toBe(true);
      expect(relief.reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(1200);
      const regular = shifts.filter((s) => s.employeeId === "regular");
      expect(regular.every((s) => parseIsoDate(s.date).getDay() !== 0)).toBe(true);
      expect(regular).toHaveLength(datesOfMonth(2026, month).filter((d) => parseIsoDate(d).getDay() !== 0).length);
      expect(regular.reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(80 * 60);
      for (const date of datesOfMonth(2026, month)) {
        const day = resolveDay(workHours, date, input.holidays);
        for (const block of day.blocks) for (let t = block.startMinutes; t < block.endMinutes; t += 15) {
          expect(shifts.some((s) => ["nga", "hoang"].includes(s.employeeId) && s.date === date &&
            (s.segments ?? [s]).some((segment) => segment.startMinutes <= t && segment.endMinutes >= t + 15))).toBe(true);
        }
      }
      const validation = validateSchedule(employees, shifts);
      expect(validation.errors.some((e) => e.employeeId === "regular" && e.kind === "hours")).toBe(false);
      expect(validation.errors.filter((e) => e.kind === "shift" && e.severity !== "warning")).toEqual([]);
    });
  }
});
