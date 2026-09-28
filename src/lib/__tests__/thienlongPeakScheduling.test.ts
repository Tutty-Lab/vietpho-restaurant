import { describe, expect, it } from "vitest";
import type { Employee } from "../../types";
import { datesOfMonth } from "../demand";
import { generateSchedule } from "../scheduler";
import { DEFAULT_WORK_HOURS } from "../workHours";

const employee: Employee = {
  id: "peak-kitchen",
  name: "Peak Kitchen",
  employmentType: "VOLLZEIT",
  targetMinutes: 8 * 60,
  workRole: "KITCHEN",
};

describe("Thienlong meal-window placement", () => {
  it("places a long surplus shift across both meal windows when the day is open", () => {
    const dates = datesOfMonth(2026, 8);
    const targetDate = "2026-08-03";
    const overrides = Object.fromEntries(
      dates
        .filter((date) => date !== targetDate)
        .map((date) => [date, { date, closed: true }]),
    );

    const shifts = generateSchedule({
      year: 2026,
      month: 8,
      workHours: DEFAULT_WORK_HOURS,
      overrides,
      holidays: new Set<string>(),
      employees: [employee],
      storeId: "thienlong",
      seed: "meal-window-surplus",
    });

    expect(shifts).toHaveLength(1);
    expect(shifts[0].paidMinutes).toBe(8 * 60);
    const segments = shifts[0].segments ?? [shifts[0]];
    expect(
      segments.some(
        (segment) =>
          segment.startMinutes <= 11 * 60 + 30 &&
          segment.endMinutes >= 14 * 60 + 30,
      ),
    ).toBe(true);
    expect(
      segments.some(
        (segment) =>
          // Montag: Abendspitze 18:00–20:30.
          segment.startMinutes <= 18 * 60 &&
          segment.endMinutes >= 20 * 60 + 30,
      ),
    ).toBe(true);
  });
});
