import { describe, expect, it } from "vitest";
import type { Employee } from "../../types";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import { generateSchedule } from "../scheduler";
import { validateSchedule } from "../validation";
import { defaultWorkHoursForStore } from "../workHours";
import { normalizedFixedDaysOff } from "../fixedDaysOff";

describe("fixed weekly days off", () => {
  it("never schedules a Vollzeit employee on the configured weekday", () => {
    const employee: Employee = {
      id: "vollzeit-fixed-off",
      name: "Vollzeit fixed off",
      employmentType: "VOLLZEIT",
      targetMinutes: 192 * 60,
      fixedDaysOff: ["monday"],
    };

    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "thienlong",
      workHours: defaultWorkHoursForStore("thienlong"),
      holidays: new Set<string>(),
      employees: [employee],
      seed: "vollzeit-fixed-off",
    });

    expect(shifts.reduce((total, shift) => total + shift.paidMinutes, 0)).toBe(192 * 60);
    expect(
      shifts.every(
        (shift) => weekdayKeyOf(parseIsoDate(shift.date)) !== "monday",
      ),
    ).toBe(true);
  });

  it("keeps both configured Azubi days free", () => {
    const employee: Employee = {
      id: "azubi-fixed-off",
      name: "Azubi fixed off",
      employmentType: "AZUBI",
      targetMinutes: 120 * 60,
      fixedDaysOff: ["tuesday", "sunday"],
    };

    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "thienlong",
      workHours: defaultWorkHoursForStore("thienlong"),
      holidays: new Set<string>(),
      employees: [employee],
      seed: "azubi-fixed-off",
    });

    expect(shifts.reduce((total, shift) => total + shift.paidMinutes, 0)).toBe(120 * 60);
    expect(
      shifts.every((shift) => {
        const weekday = weekdayKeyOf(parseIsoDate(shift.date));
        return weekday !== "tuesday" && weekday !== "sunday";
      }),
    ).toBe(true);
  });

  it("reports a manually placed shift on a fixed day off", () => {
    const employee: Employee = {
      id: "manual-fixed-off",
      name: "Manual fixed off",
      employmentType: "VOLLZEIT",
      targetMinutes: 8 * 60,
      fixedDaysOff: ["monday"],
    };
    const result = validateSchedule(
      [employee],
      [
        {
          id: "manual-shift",
          employeeId: employee.id,
          date: "2026-08-03",
          startMinutes: 10 * 60 + 30,
          endMinutes: 19 * 60,
          pauseMinutes: 30,
          paidMinutes: 8 * 60,
          shiftType: "CUSTOM",
          generated: false,
        },
      ],
    );

    expect(result.errors.some((error) => error.message.includes("ngày nghỉ cố định"))).toBe(true);
  });

  it("preserves optional Teilzeit days off when normalizing saved data", () => {
    const vollzeit = normalizedFixedDaysOff({
      id: "legacy-vollzeit",
      name: "Legacy Vollzeit",
      employmentType: "VOLLZEIT",
      targetMinutes: 160 * 60,
    });
    const teilzeit = normalizedFixedDaysOff({
      id: "legacy-teilzeit",
      name: "Legacy Teilzeit",
      employmentType: "TEILZEIT",
      targetMinutes: 40 * 60,
      fixedDaysOff: ["monday"],
    });

    expect(vollzeit.fixedDaysOff).toEqual([]);
    expect(teilzeit.fixedDaysOff).toEqual(["monday"]);
  });

  it("never schedules a Vietpho employee on the configured fixed weekday", () => {
    const employee: Employee = {
      id: "vietpho-fixed-off",
      name: "Vietpho fixed off",
      employmentType: "VOLLZEIT",
      targetMinutes: 80 * 60,
      fixedDaysOff: ["monday"],
    };

    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "vietpho",
      workHours: defaultWorkHoursForStore("vietpho"),
      holidays: new Set<string>(),
      employees: [employee],
      seed: "vietpho-fixed-off",
    });

    expect(shifts.reduce((total, shift) => total + shift.paidMinutes, 0)).toBe(80 * 60);
    expect(
      shifts.every(
        (shift) => weekdayKeyOf(parseIsoDate(shift.date)) !== "monday",
      ),
    ).toBe(true);
  });

  it("reports a manually placed Vietpho shift on a fixed day off", () => {
    const employee: Employee = {
      id: "vietpho-manual-fixed-off",
      name: "Vietpho manual fixed off",
      employmentType: "VOLLZEIT",
      targetMinutes: 4 * 60,
      fixedDaysOff: ["monday"],
    };
    const workHours = defaultWorkHoursForStore("vietpho");
    const result = validateSchedule(
      [employee],
      [
        {
          id: "vietpho-manual-shift",
          employeeId: employee.id,
          date: "2026-08-03",
          startMinutes: 11 * 60,
          endMinutes: 15 * 60,
          pauseMinutes: 0,
          paidMinutes: 4 * 60,
          shiftType: "CUSTOM",
          generated: false,
        },
      ],
      {
        year: 2026,
        month: 8,
        storeId: "vietpho",
        workHours,
        holidayState: "BW",
      },
    );

    expect(result.errors.some((error) => error.message.includes("ngày nghỉ cố định"))).toBe(true);
  });

  it("keeps fixed days free while repairing Thienlong staffing", () => {
    const employees: Employee[] = Array.from({ length: 6 }, (_, index) => ({
      id: `staff-${index}`,
      name: `Staff ${index}`,
      employmentType: "VOLLZEIT",
      targetMinutes: 120 * 60,
      workRole: index % 2 === 0 ? "KITCHEN" : "SERVICE",
      fixedDaysOff: index === 0 ? ["monday"] : ["tuesday"],
    }));

    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      storeId: "thienlong",
      workHours: defaultWorkHoursForStore("thienlong"),
      holidays: new Set<string>(),
      employees,
      seed: "repair-fixed-off",
    });
    const firstEmployeeShifts = shifts.filter((shift) => shift.employeeId === "staff-0");

    expect(
      firstEmployeeShifts.every(
        (shift) => weekdayKeyOf(parseIsoDate(shift.date)) !== "monday",
      ),
    ).toBe(true);
  });
});
