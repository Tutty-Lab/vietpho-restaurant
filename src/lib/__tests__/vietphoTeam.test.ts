import { describe, expect, it } from "vitest";
import type { Employee } from "../../types";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { defaultWorkHoursForStore } from "../workHours";
import { holidaysOf } from "../holidays";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import { vietphoGapSlots, vietphoGroupOf } from "../vietphoDemand";

// Echtes Team Okt 2026: Dinh + Nga Bếp/Bồi, Hen + Loan nur Bồi.
const team: Employee[] = [
  { id: "nga", name: "Thi Con Nga Doan", employmentType: "VOLLZEIT", targetMinutes: 140 * 60, fixedDaysOff: ["monday"], workRole: "KITCHEN", canSwitchRole: true },
  { id: "dinh", name: "Dinh Thuc Hoang", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, fixedDaysOff: ["tuesday"], workRole: "KITCHEN", canSwitchRole: true },
  { id: "hen", name: "Thi Hen Doan", employmentType: "TEILZEIT", targetMinutes: 80 * 60, workRole: "SERVICE" },
  { id: "loan", name: "Thuy Loan Pham Thi", employmentType: "TEILZEIT", targetMinutes: 20 * 60, workRole: "SERVICE", workDays: ["monday"] },
];

describe("Viet Pho: 1 Bếp + 1 Bồi, Chủ làm fills the rest", () => {
  const year = 2026;
  const month = 10;
  const workHours = defaultWorkHoursForStore("vietpho");
  const holidays = holidaysOf(year, "BW");
  const shifts = generateSchedule({ year, month, storeId: "vietpho", workHours, holidays, employees: team, seed: "vp-team" });

  it("meets every monthly target exactly", () => {
    for (const e of team) {
      const sum = shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
      expect(sum, e.name).toBe(e.targetMinutes);
    }
  });

  it("schedules Thuy Loan only on Mondays", () => {
    const days = shifts.filter((s) => s.employeeId === "loan").map((s) => weekdayKeyOf(parseIsoDate(s.date)));
    expect(days.length).toBeGreaterThan(0);
    expect(new Set(days)).toEqual(new Set(["monday"]));
  });

  it("keeps the kitchen staffed by Dinh/Nga almost all the time", () => {
    let open = 0;
    let kitchenGap = 0;
    for (const date of new Set(shifts.map((s) => s.date))) {
      const blocks = workHours.perWeekday[weekdayKeyOf(parseIsoDate(date))];
      const day = holidays.has(date) ? workHours.holiday : blocks;
      open += day.reduce((a, b) => a + b.endMinutes - b.startMinutes, 0);
      const presence = shifts
        .filter((s) => s.date === date)
        .map((s) => ({ group: vietphoGroupOf(team.find((e) => e.id === s.employeeId)!), segments: s.segments ?? [s] }));
      kitchenGap += vietphoGapSlots(day, presence)
        .filter((g) => g.kitchen)
        .reduce((a, g) => a + g.endMinutes - g.startMinutes, 0);
    }
    // Dinh + Nga = 308 h ≈ alle Öffnungsstunden; Bếp-Lücken bleiben klein.
    expect(kitchenGap / open).toBeLessThan(0.15);
  });

  it("reports gaps as 'Chủ làm' hints, never as errors", () => {
    const result = validateSchedule(team, shifts, { year, month, workHours, holidayState: "BW", storeId: "vietpho" });
    const coverage = result.errors.filter((e) => e.kind === "coverage");
    expect(coverage.every((e) => e.severity === "warning" && e.message.includes("Chủ làm"))).toBe(true);
    console.log(coverage.length, coverage.slice(0, 6).map((e) => e.message));
    console.log(result.errors.filter((e) => e.kind !== "coverage").map((e) => e.message));
  });
});
