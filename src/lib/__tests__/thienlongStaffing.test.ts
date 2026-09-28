import { describe, expect, it } from "vitest";
import type { Employee } from "../../types";
import { weekdayKeyOf, parseIsoDate, datesOfMonth } from "../demand";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { DEFAULT_WORK_HOURS } from "../workHours";
import { isThienlongMonthRushDate, THIENLONG_MONTH_RUSH_WEIGHT } from "../thienlongDemand";

const currentThienlongEmployees: Employee[] = [
  { id: "service-fixed", name: "Service fixed", employmentType: "VOLLZEIT", targetMinutes: 192 * 60, workRole: "SERVICE" },
  { id: "kitchen-1", name: "Kitchen 1", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN" },
  { id: "kitchen-2", name: "Kitchen 2", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN" },
  { id: "service-1", name: "Service 1", employmentType: "TEILZEIT", targetMinutes: 100 * 60, workRole: "SERVICE" },
  { id: "kitchen-3", name: "Kitchen 3", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN" },
  { id: "kitchen-4", name: "Kitchen 4", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN" },
  { id: "service-2", name: "Service 2", employmentType: "TEILZEIT", targetMinutes: 20 * 60, workRole: "SERVICE" },
  { id: "service-3", name: "Service 3", employmentType: "TEILZEIT", targetMinutes: 60 * 60, workRole: "SERVICE" },
  { id: "azubi-1", name: "Azubi 1", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "SERVICE" },
  { id: "azubi-2", name: "Azubi 2", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "KITCHEN" },
  { id: "azubi-3", name: "Azubi 3", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "SERVICE" },
  { id: "azubi-4", name: "Azubi 4", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "KITCHEN" },
];

const currentSettingsWithFixedDays: Employee[] = currentThienlongEmployees.map((employee) => {
  const fixedDaysById: Record<string, Employee["fixedDaysOff"]> = {
    "service-fixed": ["sunday"],
    "kitchen-1": ["tuesday"],
    "kitchen-2": ["wednesday"],
    "kitchen-3": ["tuesday"],
    "kitchen-4": ["tuesday"],
    "azubi-1": ["tuesday", "wednesday"],
    "azubi-2": ["sunday", "tuesday"],
    "azubi-3": ["tuesday", "wednesday"],
    "azubi-4": ["tuesday", "monday"],
  };
  return {
    ...employee,
    fixedDaysOff: fixedDaysById[employee.id],
  };
});

describe("Thienlong staffing bands", () => {
  it("keeps employee targets exact and separates quiet, Friday/Saturday, and Sunday demand", () => {
    const employeeSnapshot = structuredClone(currentThienlongEmployees);
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      holidays: new Set<string>(),
      employees: currentThienlongEmployees,
      storeId: "thienlong",
      seed: "current-thienlong-staffing",
    });
    expect(currentThienlongEmployees).toEqual(employeeSnapshot);

    for (const employee of currentThienlongEmployees) {
      const minutes = shifts
        .filter((shift) => shift.employeeId === employee.id)
        .reduce((sum, shift) => sum + shift.paidMinutes, 0);
      expect(minutes, employee.id).toBe(employee.targetMinutes);
    }

    const stats = new Map<string, { people: Set<string>; minutes: number }>();
    for (const date of datesOfMonth(2026, 8)) stats.set(date, { people: new Set(), minutes: 0 });
    for (const shift of shifts) {
      const item = stats.get(shift.date)!;
      item.people.add(shift.employeeId);
      item.minutes += shift.paidMinutes;
    }

    const quietHours: number[] = [];
    const busyHours: number[] = [];
    const fridaySaturdayHours: number[] = [];
    const sundayHours: number[] = [];
    for (const [date, item] of stats) {
      const weekday = weekdayKeyOf(parseIsoDate(date));
      if (["monday", "tuesday", "wednesday", "thursday"].includes(weekday)) {
        expect(item.people.size, date).toBeGreaterThanOrEqual(6);
        expect(item.people.size, date).toBeLessThanOrEqual(7);
        // The 1.35/1.2 weighting takes priority when the monthly target is
        // too small to keep every quiet day at 55h.
        // Teilzeit/Minijob kommt nur noch 2–4 h zur Stoßzeit, zählt aber als
        // ganzer Kopf in der 6–7-Personen-Grenze – daher etwas Luft nach unten.
        expect(item.minutes / 60, date).toBeGreaterThanOrEqual(46);
        // Monatswechsel-Tage sind bewusst etwas voller (Gewicht 1,15).
        const cap = isThienlongMonthRushDate(date) ? 55 * THIENLONG_MONTH_RUSH_WEIGHT : 60;
        expect(item.minutes / 60, date).toBeLessThanOrEqual(cap);
        quietHours.push(item.minutes / 60);
      } else {
        expect(item.people.size, date).toBeLessThanOrEqual(8);
        const hours = item.minutes / 60;
        busyHours.push(hours);
        if (["friday", "saturday"].includes(weekday)) fridaySaturdayHours.push(hours);
        else sundayHours.push(hours);
      }
    }

    const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const quietAverage = average(quietHours);
    const busyAverage = average(busyHours);
    expect(quietAverage).toBeGreaterThanOrEqual(48);
    expect(quietAverage).toBeLessThanOrEqual(55);
    expect(busyAverage).toBeGreaterThan(quietAverage);

    expect(average(fridaySaturdayHours)).toBeGreaterThan(average(sundayHours));
    expect(average(sundayHours)).toBeGreaterThan(quietAverage);
  });

  it("finishes the current fixed-day targets by extending existing visits", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      holidays: new Set<string>(),
      employees: currentSettingsWithFixedDays,
      storeId: "thienlong",
      seed: "current-fixed-day-targets",
    });

    for (const employee of currentSettingsWithFixedDays) {
      expect(
        shifts
          .filter((shift) => shift.employeeId === employee.id)
          .reduce((sum, shift) => sum + shift.paidMinutes, 0),
        employee.id,
      ).toBe(employee.targetMinutes);
    }
    expect(Math.max(...shifts.map((shift) => shift.paidMinutes))).toBe(10 * 60);
    expect(
      validateSchedule(currentSettingsWithFixedDays, shifts, {
        year: 2026,
        month: 8,
        storeId: "thienlong",
        workHours: DEFAULT_WORK_HOURS,
        holidayState: "BW",
      }).errors,
    ).toEqual([]);
  });

  it.each([1, 12])("keeps the staffing caps in month %s", (month) => {
    const shifts = generateSchedule({
      year: 2026,
      month,
      workHours: DEFAULT_WORK_HOURS,
      holidays: new Set<string>(),
      employees: currentThienlongEmployees,
      storeId: "thienlong",
      seed: `current-thienlong-month-${month}`,
    });

    for (const employee of currentThienlongEmployees) {
      expect(
        shifts
          .filter((shift) => shift.employeeId === employee.id)
          .reduce((sum, shift) => sum + shift.paidMinutes, 0),
        employee.id,
      ).toBe(employee.targetMinutes);
    }

    for (const date of datesOfMonth(2026, month)) {
      const weekday = weekdayKeyOf(parseIsoDate(date));
      const people = new Set(
        shifts.filter((shift) => shift.date === date).map((shift) => shift.employeeId),
      );
      if (["monday", "tuesday", "wednesday", "thursday"].includes(weekday)) {
        expect(people.size, date).toBeGreaterThanOrEqual(6);
        expect(people.size, date).toBeLessThanOrEqual(7);
      } else {
        expect(people.size, date).toBeLessThanOrEqual(8);
      }
    }
  });
});
