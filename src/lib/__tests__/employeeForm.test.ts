import { describe, expect, it } from "vitest";
import { draftFrom, draftToEmployee } from "../../components/EmployeesTab";
import { normalizedFixedDaysOff } from "../fixedDaysOff";
import { vietphoRosterEmployees } from "../vietphoRoster";
import { generateSchedule } from "../scheduler";
import { defaultWorkHoursForStore } from "../workHours";
import { parseIsoDate } from "../demand";
import type { Employee } from "../../types";

describe("employee editor save/reopen/reload", () => {
  for (const employmentType of ["VOLLZEIT", "TEILZEIT", "AZUBI"] as const) {
    it(`keeps configured fields for ${employmentType}`, () => {
      const employee: Employee = { id: "edited", name: "Edited", employmentType, targetMinutes: 1200, workRole: "SERVICE" };
      const draft = draftFrom(employee);
      draft.fixedDaysOff = employmentType === "AZUBI" ? ["thursday", "friday"] : ["thursday"];
      draft.workDays = ["monday", "tuesday", "wednesday"];
      draft.daysPerWeek = "3";
      draft.spreadEvenly = true;
      draft.shiftMin = "2";
      draft.shiftMax = "4";
      draft.windows = [{ days: ["monday"], start: "12:00", end: "14:00" }];
      const saved = { id: employee.id, ...draftToEmployee(draft) };
      const reloaded = vietphoRosterEmployees([normalizedFixedDaysOff(JSON.parse(JSON.stringify(saved)))])[0];
      const reopened = draftFrom(reloaded);
      expect(reopened.fixedDaysOff).toEqual(draft.fixedDaysOff);
      expect(reopened.workDays).toEqual(draft.workDays);
      expect(reopened.daysPerWeek).toBe("3");
      expect(reopened.spreadEvenly).toBe(true);
      expect(reopened.shiftMin).toBe("2");
      expect(reopened.shiftMax).toBe("4");
      expect(reopened.windows).toEqual(draft.windows);
    });
  }
  it("honors a changed service rest day after form save and schedule generation", () => {
    const employee: Employee = { id: "service", name: "Service", employmentType: "TEILZEIT", targetMinutes: 1200, workRole: "SERVICE" };
    const draft = draftFrom(employee);
    draft.fixedDaysOff = ["sunday"];
    const edited = normalizedFixedDaysOff({ id: employee.id, ...draftToEmployee(draft) });
    const shifts = generateSchedule({ storeId: "vietpho", year: 2026, month: 11, workHours: defaultWorkHoursForStore("vietpho"), employees: [edited] });
    expect(shifts.length).toBeGreaterThan(0);
    expect(shifts.every((s) => parseIsoDate(s.date).getDay() !== 0)).toBe(true);
  });
  it("honors changed kitchen rest days after saving the popup", () => {
    const cooks: Employee[] = ["nga", "hoang"].map((id) => ({ id, name: id, employmentType: "VOLLZEIT", targetMinutes: 8400, workRole: "KITCHEN", fixedDaysOff: ["monday"] }));
    const edited = cooks.map((e, i) => {
      const draft = draftFrom(e);
      draft.fixedDaysOff = [i === 0 ? "thursday" : "friday"];
      return normalizedFixedDaysOff({ id: e.id, ...draftToEmployee(draft) });
    });
    const shifts = generateSchedule({ storeId: "vietpho", year: 2026, month: 11, workHours: defaultWorkHoursForStore("vietpho"), employees: edited });
    for (const [id, day] of [["nga", 4], ["hoang", 5]] as const) {
      const mine = shifts.filter((s) => s.employeeId === id);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((s) => parseIsoDate(s.date).getDay() !== day)).toBe(true);
    }
  });
});
