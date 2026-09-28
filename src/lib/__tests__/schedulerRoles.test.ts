import { describe, expect, it } from "vitest";
import type { Employee, WorkRole } from "../../types";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "../demand";
import { generateSchedule } from "../scheduler";
import { demandCoverageGap, thienlongDemandIntervals } from "../thienlongDemand";
import { DEFAULT_WORK_HOURS } from "../workHours";

const employees: Employee[] = Array.from({ length: 8 }, (_, index) => ({
  id: `role-${index}`,
  name: `Role ${index}`,
  employmentType:
    index === 3 || index === 7
      ? "AZUBI"
      : index % 2 === 0
        ? "VOLLZEIT"
        : "TEILZEIT",
  targetMinutes: 120 * 60,
  workRole: (index < 5 ? "KITCHEN" : "SERVICE") as WorkRole,
}));

function monthlyRoleGap(shifts: ReturnType<typeof generateSchedule>): number {
  const byId = new Map(employees.map((employee) => [employee.id, employee] as const));

  return datesOfMonth(2026, 8).reduce((monthGap, date) => {
    const weekday = weekdayKeyOf(parseIsoDate(date));
    const dayShifts = shifts.filter((shift) => shift.date === date);
    const dayTotalMinutes = dayShifts.reduce((total, shift) => total + shift.paidMinutes, 0);
    return monthGap + (["KITCHEN", "SERVICE"] as const).reduce((dayGap, role) => {
      const roleShifts = dayShifts.filter(
        (shift) => byId.get(shift.employeeId)?.workRole === role,
      );
      return dayGap + demandCoverageGap(
        roleShifts,
        thienlongDemandIntervals(weekday, role, dayTotalMinutes),
      );
    }, 0);
  }, 0);
}

function averageScheduledHours(
  shifts: ReturnType<typeof generateSchedule>,
  weekdays: readonly ReturnType<typeof weekdayKeyOf>[],
): number {
  const dates = datesOfMonth(2026, 8).filter((date) =>
    weekdays.includes(weekdayKeyOf(parseIsoDate(date))),
  );
  const totalMinutes = shifts
    .filter((shift) => dates.includes(shift.date))
    .reduce((total, shift) => total + shift.paidMinutes, 0);
  return totalMinutes / 60 / dates.length;
}

describe("Thienlong role-aware scheduling", () => {
  it("uses Kitchen and Service roles for regular employees and Azubis", () => {
    const common = {
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      holidays: new Set<string>(),
      employees,
      seed: "role-coverage",
    };

    const generic = generateSchedule(common);
    const thienlong = generateSchedule({ ...common, storeId: "thienlong" });

    expect(monthlyRoleGap(thienlong)).toBeLessThan(monthlyRoleGap(generic));

    const quietDayAverage = averageScheduledHours(thienlong, [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
    ]);
    const sundayAverage = averageScheduledHours(thienlong, ["sunday"]);
    const fridayAverage = averageScheduledHours(thienlong, ["friday"]);
    const saturdayAverage = averageScheduledHours(thienlong, ["saturday"]);

    expect(sundayAverage).toBeGreaterThan(quietDayAverage);
    expect(fridayAverage).toBeGreaterThan(quietDayAverage);
    expect(saturdayAverage).toBeGreaterThan(quietDayAverage);
  });

  it("extends long split shifts through both meal peaks before using quiet edges", () => {
    const activeDate = "2026-08-03";
    const overrides = Object.fromEntries(
      datesOfMonth(2026, 8)
        .filter((date) => date !== activeDate)
        .map((date) => [date, { date, closed: true }]),
    );
    const oneShiftEach = employees.slice(0, 7).map((employee) => ({
      ...employee,
      // Vollzeit: Teilzeit kommt inzwischen nur noch kurz zu EINER Stoßzeit.
      employmentType: "VOLLZEIT" as const,
      targetMinutes: 6 * 60,
    }));

    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      overrides,
      employees: oneShiftEach,
      storeId: "thienlong",
      seed: "meal-peak-extension",
    });

    const peakCentered = shifts.filter((shift) =>
      shift.segments?.some(
        (segment) =>
          segment.startMinutes <= 12 * 60 &&
          segment.endMinutes >= 14 * 60,
      ) && shift.segments?.some(
        (segment) =>
          // Montag: Abendspitze 18:00–20:30.
          segment.startMinutes <= 18 * 60 &&
          segment.endMinutes >= 20 * 60 + 30,
      ),
    );

    expect(peakCentered.length).toBeGreaterThan(0);
  });
});
