import { describe, expect, it } from "vitest";
import { conflictingWorkDays } from "../fixedDaysOff";
import { checkScheduleReadiness } from "../readiness";
import type { Employee } from "../../types";

describe("employee day conflicts", () => {
  it("reports Tuesday off conflicting with Tuesday/Wednesday work", () => {
    expect(conflictingWorkDays({ fixedDaysOff: ["tuesday"], workDays: ["tuesday", "wednesday"] })).toEqual(["tuesday"]);
  });
  it("accepts unrestricted days and non-overlapping selections", () => {
    expect(conflictingWorkDays({ fixedDaysOff: ["tuesday"] })).toEqual([]);
    expect(conflictingWorkDays({ fixedDaysOff: ["tuesday"], workDays: [] })).toEqual([]);
    expect(conflictingWorkDays({ fixedDaysOff: ["tuesday"], workDays: ["wednesday"] })).toEqual([]);
  });
  it("blocks generation for already saved conflicting data until corrected", () => {
    const employee: Employee = { id: "a", name: "Nga", employmentType: "VOLLZEIT", targetMinutes: 8400, saved: true, fixedDaysOff: ["tuesday"], workDays: ["tuesday", "wednesday"] };
    const team: Employee[] = [employee, { ...employee, id: "b", name: "Hoang", workDays: ["friday"] }];
    expect(checkScheduleReadiness(team).ready).toBe(false);
    expect(checkScheduleReadiness(team).issues.join(" ")).toContain("Nga: ngày nghỉ cố định trùng");
    expect(checkScheduleReadiness(team.map((e) => ({ ...e, workDays: ["wednesday"] }))).ready).toBe(true);
  });
});
