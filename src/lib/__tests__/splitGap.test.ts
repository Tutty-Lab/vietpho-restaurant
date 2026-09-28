import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { withMonthRoles } from "../roleCoverage";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";

// Echte Thienlong-Daten September 2026: dort entstanden „geteilte" Dienste
// ohne echte Pause (11:30–17:00 | 17:00–20:00).
const B = (s: number, e: number) => ({ startMinutes: s, endMinutes: e });
const weekdayMoThu = [B(630, 900), B(990, 1320)];
const workHours = {
  perWeekday: {
    monday: weekdayMoThu, tuesday: weekdayMoThu, wednesday: weekdayMoThu, thursday: weekdayMoThu,
    friday: [B(630, 1320)], saturday: [B(690, 1320)], sunday: [B(690, 1320)],
  },
  holiday: [B(690, 1320)],
};
const azubiTerm = {
  schoolDays: ["monday", "tuesday"], inSchoolTerm: true,
  schoolTermStart: "2026-09-14", schoolTermEnd: "2026-10-31",
  monthlyHoursByMonth: { "2026-09": 80 }, monthlyHoursOutOfTerm: 174,
};
const employees = [
  { id: "loan", name: "Thuy Loan Pham Thi", workRole: "SERVICE", fixedDaysOff: ["sunday"], targetMinutes: 11520, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "son", name: "Hong Son Nguyen", workRole: "KITCHEN", fixedDaysOff: ["tuesday"], canSwitchRole: true, targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "long", name: "Huu Long Bui", workRole: "KITCHEN", fixedDaysOff: ["wednesday"], targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "qui", name: "Qui Phi Nguyen", workRole: "SERVICE", targetMinutes: 6000, employmentType: "TEILZEIT" },
  { id: "jit", name: "Jitsophee Luecha", workRole: "KITCHEN", fixedDaysOff: ["monday"], targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "tuan", name: "Anh Tuan Nguyen", workRole: "KITCHEN", fixedDaysOff: ["thursday"], targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "bianca", name: "Bianca Müller", workRole: "SERVICE", targetMinutes: 1200, employmentType: "TEILZEIT" },
  { id: "patrizia", name: "Patrizia Nicosia", workRole: "SERVICE", targetMinutes: 3600, employmentType: "TEILZEIT" },
  { id: "hang", name: "La Thi Hang", workRole: "SERVICE", fixedDaysOff: ["monday", "wednesday"], targetMinutes: 4800, employmentType: "AZUBI", desiredDaysPerWeek: 5,
    azubi: { ...azubiTerm, workMonthHoursByMonth: { "2026-09": 168 } } },
  { id: "dao", name: "Phung Quang Dao", workRole: "KITCHEN", fixedDaysOff: ["sunday", "tuesday"], targetMinutes: 4800, employmentType: "AZUBI", desiredDaysPerWeek: 5, azubi: azubiTerm },
  { id: "hoan", name: "Huu Hoan Nguyen", workRole: "SERVICE", fixedDaysOff: ["tuesday", "thursday"], targetMinutes: 4800, employmentType: "AZUBI", desiredDaysPerWeek: 5, azubi: azubiTerm },
  { id: "due", name: "Van Due Dang", workRole: "KITCHEN", startDate: "2026-07-01", fixedDaysOff: ["friday", "sunday"], targetMinutes: 10440, employmentType: "AZUBI", desiredDaysPerWeek: 5,
    azubi: { schoolDays: [], inSchoolTerm: false, monthlyHoursOutOfTerm: 174 } },
] as unknown as Employee[];

const tooShortBreaks = (shifts: Shift[]) =>
  shifts
    .filter((s) => s.segments && s.segments.length > 1)
    .filter((s) => s.segments!.some((g, i) => i > 0 && g.startMinutes - s.segments![i - 1].endMinutes < 60))
    .map((s) => `${s.date} ${s.employeeId} ${s.segments!.map((g) => `${g.startMinutes}-${g.endMinutes}`).join("|")}`);

describe("geteilte Dienste haben eine echte Pause", () => {
  for (const seed of [undefined, "a", "b", "c"]) {
    it(`mind. 1 h zwischen den Stücken (seed ${seed ?? "default"})`, () => {
      const shifts = generateSchedule({
        year: 2026, month: 9, storeId: "thienlong", workHours, overrides: {},
        employees: withMonthRoles(employees, 2026, 9), holidayState: "BW", seed,
      } as Parameters<typeof generateSchedule>[0]);
      expect(tooShortBreaks(shifts)).toEqual([]);
    });
  }
});

describe("Prüfung: geteilter Dienst ohne echte Pause", () => {
  it("warnt mit Uhrzeiten und nötiger Pause", () => {
    const shift: Shift = {
      id: "x", employeeId: "loan", date: "2026-09-05", shiftType: "CUSTOM",
      startMinutes: 690, endMinutes: 1200, pauseMinutes: 0, paidMinutes: 510,
      segments: [{ startMinutes: 690, endMinutes: 1020 }, { startMinutes: 1020, endMinutes: 1200 }],
    } as Shift;
    const warn = validateSchedule([employees[0]], [shift]).errors.find((e) => e.message.startsWith("Ca tách đôi"));
    expect(warn?.severity).toBe("warning");
    expect(warn?.message).toContain("11:30–17:00 | 17:00–20:00");
    expect(warn?.message).toContain("nghỉ giữa 0 phút");
    expect(warn?.suggestion).toContain("nghỉ 60 phút");
  });
  it("kein Hinweis bei ≥ 1 h Pause", () => {
    const shift = {
      id: "y", employeeId: "loan", date: "2026-09-07", shiftType: "CUSTOM",
      startMinutes: 630, endMinutes: 1320, pauseMinutes: 0, paidMinutes: 600,
      segments: [{ startMinutes: 630, endMinutes: 900 }, { startMinutes: 990, endMinutes: 1320 }],
    } as Shift;
    expect(validateSchedule([employees[0]], [shift]).errors.some((e) => e.message.startsWith("Ca tách đôi"))).toBe(false);
  });
});
