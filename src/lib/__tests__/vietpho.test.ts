import { describe, expect, it } from "vitest";
import type { Employee } from "../../types";
import { generateSchedule } from "../scheduler";
import { datesOfMonth } from "../demand";
import { validateSchedule } from "../validation";
import { defaultWorkHoursForStore, workHoursVersionForStore } from "../workHours";
import {
  VIETPHO_REFERENCE_INVOICES,
  VIETPHO_REFERENCE_TAX_INCLUDED,
  vietphoDemandIntervals,
  vietphoDemandWeight,
  vietphoPeakIntervals,
} from "../vietphoDemand";

describe("Vietpho scheduling profile", () => {
  const employees: Employee[] = Array.from({ length: 4 }, (_, index) => ({
    id: `vietpho-${index}`,
    name: `Vietpho ${index}`,
    employmentType: "VOLLZEIT",
    targetMinutes: 174 * 60,
  }));

  it("starts staff at the published opening time instead of 30 minutes early", () => {
    const hours = defaultWorkHoursForStore("vietpho");

    expect(hours.perWeekday.monday).toEqual([
      { startMinutes: 11 * 60, endMinutes: 15 * 60 },
      { startMinutes: 17 * 60, endMinutes: 22 * 60 },
    ]);
    expect(hours.perWeekday.friday[0].startMinutes).toBe(11 * 60);
    expect(hours.perWeekday.saturday[0].startMinutes).toBe(12 * 60);
    expect(workHoursVersionForStore("thienlong")).toBe(3);
    expect(workHoursVersionForStore("vietpho")).toBe(4);
  });

  it("records the Vietpho calibration as 100 invoices including tax", () => {
    expect(VIETPHO_REFERENCE_INVOICES).toBe(100);
    expect(VIETPHO_REFERENCE_TAX_INCLUDED).toBe(true);
  });

  it("keeps two staff at the lunch and dinner peaks without role separation", () => {
    expect(vietphoPeakIntervals()).toEqual([
      { startMinutes: 12 * 60 + 30, endMinutes: 13 * 60, minStaff: 2 },
      { startMinutes: 18 * 60, endMinutes: 20 * 60, minStaff: 2 },
    ]);

    const demand = vietphoDemandIntervals("monday", 12 * 60);
    expect(demand.reduce((sum, item) => sum + item.personMinutes, 0)).toBeCloseTo(12 * 60);
    expect(vietphoDemandWeight("friday")).toBe(1.2);
    expect(vietphoDemandWeight("saturday")).toBe(1.2);
    expect(vietphoDemandWeight("sunday")).toBeGreaterThan(1);
    expect(vietphoDemandWeight("sunday")).toBeLessThan(1.2);
  });

  it("uses shifts about one to two hours shorter than the Thienlong maximum", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours: defaultWorkHoursForStore("vietpho"),
      holidays: new Set<string>(),
      employees,
      seed: "vietpho-shorter-shifts",
    });

    expect(Math.max(...shifts.map((shift) => shift.paidMinutes))).toBeLessThanOrEqual(8 * 60);
    expect(shifts.some((shift) => shift.paidMinutes <= 6 * 60)).toBe(true);
  });

  it("spreads low-hour employees across many short visits", () => {
    const partTimers: Employee[] = Array.from({ length: 3 }, (_, index) => ({
      id: `vietpho-part-${index}`,
      name: `Vietpho Teilzeit ${index}`,
      employmentType: "TEILZEIT",
      targetMinutes: 30 * 60,
    }));
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours: defaultWorkHoursForStore("vietpho"),
      holidays: new Set<string>(),
      employees: partTimers,
      seed: "vietpho-many-short-visits",
    });

    for (const employee of partTimers) {
      const employeeShifts = shifts.filter((shift) => shift.employeeId === employee.id);
      expect(employeeShifts.length).toBeGreaterThanOrEqual(12);
    }
    expect(shifts.some((shift) => shift.paidMinutes <= 2 * 60)).toBe(true);
  });

  it("covers both Vietpho peak windows with staff and the owner every open day", () => {
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours: defaultWorkHoursForStore("vietpho"),
      holidays: new Set<string>(),
      employees,
      seed: "vietpho-peak-coverage",
    });

    for (const date of datesOfMonth(2026, 8)) {
      for (const peak of vietphoPeakIntervals()) {
        const covering = shifts.filter((shift) => {
          if (shift.date !== date) return false;
          return (shift.segments ?? [shift]).some(
            (segment) =>
              segment.startMinutes <= peak.startMinutes && segment.endMinutes >= peak.endMinutes,
          );
        });
        expect(covering.length + 1, `${date} ${peak.startMinutes}-${peak.endMinutes}`).toBeGreaterThanOrEqual(
          peak.minStaff,
        );
      }
    }
  });

  it("covers both peaks for the current four-person Vietpho staffing mix", () => {
    const currentEmployees: Employee[] = [
      {
        id: "emp-1786085122788-730395",
        name: "Thi Hen Doan",
        employmentType: "TEILZEIT",
        targetMinutes: 80 * 60,
      },
      {
        id: "emp-1786085136655-748904",
        name: "Thi Con Nga Doan",
        employmentType: "TEILZEIT",
        targetMinutes: 140 * 60,
      },
      {
        id: "emp-1786085166424-106408",
        name: "Dinh Thuc Hoang",
        employmentType: "VOLLZEIT",
        targetMinutes: 168 * 60,
        fixedDaysOff: ["monday"],
      },
      {
        id: "emp-1786085188261-602265",
        name: "Thuy Loan Pham Thi",
        employmentType: "TEILZEIT",
        targetMinutes: 20 * 60,
      },
    ];
    const workHours = defaultWorkHoursForStore("vietpho");
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours,
      holidays: new Set<string>(),
      employees: currentEmployees,
    });

    expect(
      validateSchedule(currentEmployees, shifts, {
        year: 2026,
        month: 8,
        storeId: "vietpho",
        workHours,
        holidayState: "BW",
      }).errors.filter((error) => error.severity !== "warning"),
    ).toEqual([]);
  });

  it("reports remaining gaps after counting the owner", () => {
    const workHours = defaultWorkHoursForStore("vietpho");
    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours,
      holidays: new Set<string>(),
      employees,
      seed: "vietpho-validation",
    });
    const context = {
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours,
      holidayState: "BW" as const,
    };

    expect(
      validateSchedule(employees, shifts, context).errors.filter((e) => e.severity !== "warning"),
    ).toEqual([]);

    const date = "2026-08-03";
    const invalid = shifts.filter(
      (shift) => shift.date !== date,
    );
    const errors = validateSchedule(employees, invalid, context).errors;

    const hint = errors.find((error) => error.date === date && error.message.includes("Thiếu Bếp"));
    expect(hint?.severity).toBe("warning");
  });
});
