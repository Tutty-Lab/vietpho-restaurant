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

describe("Viet Pho: owner works every day, preferring service", () => {
  const year = 2026;
  const month = 10;
  const workHours = defaultWorkHoursForStore("vietpho");
  const holidays = holidaysOf(year, "BW");
  const shifts = generateSchedule({ year, month, storeId: "vietpho", workHours, holidays, employees: team, seed: "vp-team" });

  it("keeps Hen on every Mon–Sat but shortens the pieces to land on 80 h", () => {
    const hen = shifts.filter((s) => s.employeeId === "hen");
    expect(hen.reduce((a, s) => a + s.paidMinutes, 0)).toBe(80 * 60);
    expect(hen.every((s) => weekdayKeyOf(parseIsoDate(s.date)) !== "sunday")).toBe(true);
    expect(hen.every((s) => s.segments?.[0].startMinutes === 12 * 60 && s.segments?.[1].startMinutes === 18 * 60)).toBe(true);
    const result = validateSchedule(team, shifts, { year, month, workHours, holidayState: "BW", storeId: "vietpho" });
    expect(result.errors.some((e) => e.employeeId === "hen" && e.kind === "hours")).toBe(false);
  });

  it("gives both cooks exactly their monthly target", () => {
    const paid = (id: string) => shifts.filter((s) => s.employeeId === id).reduce((a, s) => a + s.paidMinutes, 0);
    expect(paid("nga")).toBe(140 * 60);
    // Fehlende Öffnungsstunden werden als Überlappung (auch 9–10-h-Tage) nachgeholt.
    expect(paid("dinh")).toBe(168 * 60);
  });

  it("treats up to ±5 h off the monthly target as fine", () => {
    const ctx = { year, month, workHours, holidayState: "BW" as const, storeId: "vietpho" };
    const hours = (list: typeof shifts) => validateSchedule(team, list, ctx).errors.filter((e) => e.kind === "hours" && e.employeeId === "nga");
    const nga = shifts.filter((s) => s.employeeId === "nga");
    const shrink = (minutes: number) => shifts.map((s) => (s === nga[0] ? { ...s, paidMinutes: s.paidMinutes - minutes } : s));
    expect(hours(shrink(4 * 60))).toEqual([]);
    expect(hours(shrink(5 * 60))).toEqual([]);
    expect(hours(shrink(5 * 60 + 15))).toHaveLength(1);
  });

  it("preserves Thuy Loan's explicitly selected Mondays", () => {
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

  it("reports remaining gaps after counting the owner", () => {
    const result = validateSchedule(team, shifts, { year, month, workHours, holidayState: "BW", storeId: "vietpho" });
    const coverage = result.errors.filter((e) => e.kind === "coverage");
    expect(coverage.every((e) => e.severity === "warning" && e.message.includes("Thiếu") && e.reason?.includes("Đã tính chủ"))).toBe(true);
  });
});
