import { describe, expect, it } from "vitest";
import type { Shift } from "../../types";
import {
  calculateZuschlaege,
  normalizeSurchargeConfig,
  shiftMinutesAfter20,
  zuschlagTotals,
} from "../zuschlaege";

function shift(patch: Partial<Shift>): Shift {
  return {
    id: "shift",
    employeeId: "employee",
    date: "2026-08-02",
    startMinutes: 16 * 60 + 30,
    endMinutes: 22 * 60,
    pauseMinutes: 0,
    paidMinutes: 5.5 * 60,
    shiftType: "LATE",
    generated: true,
    ...patch,
  };
}

describe("Zuschlaege", () => {
  it("counts the exact portion after 20:00 for continuous and split shifts", () => {
    expect(shiftMinutesAfter20(shift({ date: "2026-08-03" }))).toBe(2 * 60);
    expect(
      shiftMinutesAfter20(
        shift({
          paidMinutes: 8 * 60,
          startMinutes: 10 * 60 + 30,
          segments: [
            { startMinutes: 10 * 60 + 30, endMinutes: 15 * 60 },
            { startMinutes: 16 * 60 + 30, endMinutes: 20 * 60 },
          ],
        }),
      ),
    ).toBe(0);
    expect(shiftMinutesAfter20(shift({ date: "2026-08-02" }))).toBe(0);
  });

  it("counts Sunday separately and limits Nacht hours to Monday-Saturday", () => {
    const sunday = shift({ date: "2026-08-02", paidMinutes: 5.5 * 60 });
    const monday = shift({ id: "monday", date: "2026-08-03", paidMinutes: 5.5 * 60 });

    expect(zuschlagTotals([sunday, monday])).toEqual({
      after20Minutes: 2 * 60,
      sundayMinutes: 5.5 * 60,
    });
  });

  it("does not stack the Nacht bonus on top of the Sunday bonus", () => {
    const sunday = shift({
      date: "2026-08-02",
      startMinutes: 18 * 60,
      endMinutes: 22 * 60,
      paidMinutes: 4 * 60,
    });

    expect(
      calculateZuschlaege([sunday], {
        sundayPercent: 50,
        after20Percent: 25,
      }),
    ).toEqual({
      sundayMinutes: 4 * 60,
      after20Minutes: 0,
      sundayPercent: 50,
      after20Percent: 25,
      sundayBonusMinutes: 2 * 60,
      after20BonusMinutes: 0,
      totalBonusMinutes: 2 * 60,
    });
  });

  it("uses zero percent for old or invalid surcharge settings", () => {
    expect(normalizeSurchargeConfig(undefined)).toEqual({
      after20Percent: 0,
      sundayPercent: 0,
    });
    expect(
      normalizeSurchargeConfig({ after20Percent: Number.NaN, sundayPercent: -10 }),
    ).toEqual({
      after20Percent: 0,
      sundayPercent: 0,
    });
  });
});

describe("hourStatsFor (Stundenübersicht)", () => {
  it("counts Nacht from 20:00 Mon–Sat and Sunday only as Sonntag", async () => {
    const { hourStatsFor } = await import("../zuschlaege");
    const shifts = [
      // Mittwoch 17–22: 2 h Nacht
      shift({ id: "a", date: "2026-08-05", startMinutes: 17 * 60, endMinutes: 22 * 60, paidMinutes: 5 * 60 }),
      // Sonntag 16:30–22: alles Sonntag, keine Nacht
      shift({ id: "b", date: "2026-08-02" }),
      // anderer Mitarbeiter zählt nicht
      shift({ id: "c", employeeId: "other", date: "2026-08-05" }),
    ];
    expect(hourStatsFor(shifts, "employee", ["2026-08-02", "2026-08-05"])).toEqual({
      total: 10.5 * 60,
      night: 2 * 60,
      sunday: 5.5 * 60,
    });
    expect(hourStatsFor(shifts, "employee", ["2026-08-05"])).toEqual({ total: 5 * 60, night: 2 * 60, sunday: 0 });
  });
});
