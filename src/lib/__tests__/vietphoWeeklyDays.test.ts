import { describe, expect, it } from "vitest";
import { generateSchedule } from "../scheduler";
import { defaultWorkHoursForStore } from "../workHours";
import { datesOfMonth, parseIsoDate } from "../demand";
import { checkScheduleReadiness } from "../readiness";
import type { Employee } from "../../types";

describe("Vietpho weekly workday count", () => {
  const base: Employee = { id: "worker", name: "Worker", employmentType: "VOLLZEIT", workRole: "KITCHEN", targetMinutes: 156 * 60, desiredDaysPerWeek: 6, fixedDaysOff: ["tuesday"], saved: true, workDays: [] };
  const generate = (employee: Employee) => generateSchedule({ employees: [employee], year: 2026, month: 11, storeId: "vietpho", workHours: defaultWorkHoursForStore("vietpho"), holidays: new Set(), seed: "weekly-days" });
  it("works all six remaining weekdays when Tuesday is fixed off", () => {
    const shifts = generate(base);
    const expected = datesOfMonth(2026, 11).filter((date) => parseIsoDate(date).getDay() !== 2);
    expect(shifts.map((s) => s.date).sort()).toEqual(expected);
    expect(shifts.reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(base.targetMinutes);
  });
  it("allows seven selected days with no fixed rest day, while keeping one rest day per full week", () => {
    const employee = { ...base, desiredDaysPerWeek: 7, fixedDaysOff: [] };
    expect(checkScheduleReadiness([employee, { ...employee, id: "other" }], { storeId: "vietpho", requireFixedDaysOff: true }).ready).toBe(true);
    const shifts = generate(employee);
    for (const start of [2, 9, 16, 23]) {
      const count = shifts.filter((s) => { const day = parseIsoDate(s.date).getDate(); return day >= start && day < start + 7; }).length;
      expect(count).toBe(6);
    }
  });
});
