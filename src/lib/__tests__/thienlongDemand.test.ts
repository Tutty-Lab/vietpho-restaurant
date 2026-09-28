import { describe, expect, it } from "vitest";
import {
  THIENLONG_REFERENCE_INVOICES,
  clipDemandIntervals,
  demandCoverageGain,
  demandCoverageGap,
  thienlongDemandIntervals,
  thienlongDemandShares,
  thienlongDemandWeight,
  thienlongLateShiftRatio,
  thienlongMealPeakDemand,
  thienlongMealPeakIntervals,
  thienlongRoleShare,
} from "../thienlongDemand";
import type { Shift } from "../../types";

function shift(id: string, startMinutes: number, endMinutes: number): Shift {
  return {
    id,
    employeeId: id,
    date: "2026-08-03",
    startMinutes,
    endMinutes,
    pauseMinutes: 0,
    paidMinutes: endMinutes - startMinutes,
    shiftType: "CUSTOM",
    generated: true,
  };
}

describe("Thienlong role demand profile", () => {
  it("scales the sample ratios to the actual total hours of the selected day", () => {
    const total = (items: ReturnType<typeof thienlongDemandIntervals>) =>
      items.reduce((sum, item) => sum + item.personMinutes, 0);
    const kitchenAt20Hours = total(
      thienlongDemandIntervals("monday", "KITCHEN", 20 * 60),
    );
    const kitchenAt40Hours = total(
      thienlongDemandIntervals("monday", "KITCHEN", 40 * 60),
    );

    expect(kitchenAt40Hours).toBeCloseTo(kitchenAt20Hours * 2);
    expect(kitchenAt20Hours).toBeCloseTo(20 * 60 * (24 / 38));
    const serviceAt20Hours = total(
      thienlongDemandIntervals("monday", "SERVICE", 20 * 60),
    );
    expect(kitchenAt20Hours + serviceAt20Hours).toBeCloseTo(20 * 60);
  });

  it("converts the actual example schedule into ratios instead of fixed hours", () => {
    expect(thienlongRoleShare("monday", "KITCHEN")).toBeCloseTo(24 / 38);
    expect(thienlongRoleShare("monday", "SERVICE")).toBeCloseTo(14 / 38);
    expect(thienlongRoleShare("saturday", "KITCHEN")).toBeCloseTo(26 / 42);
    expect(thienlongRoleShare("sunday", "KITCHEN")).toBeCloseTo(26 / 42);
    expect(
      thienlongRoleShare("monday", "KITCHEN") +
        thienlongRoleShare("monday", "SERVICE"),
    ).toBeCloseTo(1);

    expect(thienlongDemandShares("monday", "KITCHEN")).toEqual([
      { startMinutes: 10 * 60 + 30, endMinutes: 11 * 60, share: 0.5 / 38 },
      { startMinutes: 11 * 60, endMinutes: 14 * 60, share: 9 / 38 },
      { startMinutes: 14 * 60, endMinutes: 15 * 60, share: 1.5 / 38 },
      { startMinutes: 16 * 60 + 30, endMinutes: 18 * 60, share: 1.5 / 38 },
      { startMinutes: 18 * 60, endMinutes: 20 * 60 + 30, share: 9 / 38 },
      { startMinutes: 20 * 60 + 30, endMinutes: 22 * 60, share: 2.5 / 38 },
    ]);
  });

  it("uses 1:1.35:1.1 demand weights for quiet, Friday/Saturday, and Sunday", () => {
    expect(thienlongDemandWeight("friday")).toBeCloseTo(1.35);
    expect(thienlongDemandWeight("saturday")).toBeCloseTo(1.35);
    expect(thienlongDemandWeight("sunday")).toBeCloseTo(1.1);
    expect(thienlongDemandWeight("monday", true)).toBeCloseTo(1.35);
    expect(thienlongLateShiftRatio("friday")).toBe(thienlongLateShiftRatio("saturday"));
    expect(thienlongDemandWeight("monday")).toBe(1);
    expect(thienlongLateShiftRatio("sunday")).toBeGreaterThan(thienlongLateShiftRatio("monday"));
    expect(thienlongLateShiftRatio("sunday")).toBeLessThan(thienlongLateShiftRatio("friday"));
  });

  it("records 150 Rechnungen as the profile calibration reference", () => {
    expect(THIENLONG_REFERENCE_INVOICES).toBe(150);
  });

  it("treats the lunch and dinner windows as soft high-demand periods", () => {
    // Abendspitze nicht ab 17:00: Mo–Do 18:00–20:30, Fr/Sa/So 18:00–21:00.
    for (const day of ["monday", "tuesday", "wednesday", "thursday"] as const) {
      expect(thienlongMealPeakIntervals(day)).toEqual([
        { startMinutes: 12 * 60, endMinutes: 14 * 60 },
        { startMinutes: 18 * 60, endMinutes: 20 * 60 + 30 },
      ]);
    }
    for (const day of ["friday", "saturday", "sunday"] as const) {
      expect(thienlongMealPeakIntervals(day)).toEqual([
        { startMinutes: 12 * 60, endMinutes: 14 * 60 },
        { startMinutes: 18 * 60, endMinutes: 21 * 60 },
      ]);
    }
    expect(thienlongMealPeakIntervals("monday", true)[1].endMinutes).toBe(21 * 60);

    const peakDemand = thienlongMealPeakDemand(
      "monday",
      "KITCHEN",
      60 * 60,
    );
    expect(peakDemand).toHaveLength(2);
    expect(peakDemand[0].personMinutes).toBeGreaterThan(0);
    // Abendspitze (Index 1) wiegt schwerer als die Mittagsspitze (Index 0).
    expect(peakDemand[1].personMinutes).toBeGreaterThan(peakDemand[0].personMinutes);
  });

  it("prefers the shift that fills the currently uncovered role intervals", () => {
    const demand = thienlongDemandIntervals("monday", "SERVICE", 38 * 60);
    const early = shift("early", 10 * 60 + 30, 15 * 60);
    const late = shift("late", 16 * 60 + 30, 22 * 60);

    expect(demandCoverageGain(late, [], demand)).toBeGreaterThan(
      demandCoverageGain(early, [], demand),
    );
    expect(demandCoverageGain(early, [late], demand)).toBeGreaterThan(
      demandCoverageGain(late, [late], demand),
    );
  });

  it("reports the remaining person-minutes after role shifts are assigned", () => {
    const demand = [{ startMinutes: 18 * 60, endMinutes: 20 * 60, personMinutes: 2 * 60 }];

    expect(demandCoverageGap([shift("one", 18 * 60, 19 * 60)], demand)).toBe(60);
  });

  it("clips demand outside the configured work window without changing its density", () => {
    const clipped = clipDemandIntervals(
      thienlongDemandIntervals("saturday", "SERVICE", 42 * 60),
      [{ startMinutes: 11 * 60 + 30, endMinutes: 22 * 60 }],
    );

    // Sa-Bồi-Mittag 11:30–14:00 = 5,5 von 42 Referenzstunden.
    expect(clipped[0]).toEqual({
      startMinutes: 11 * 60 + 30,
      endMinutes: 14 * 60,
      personMinutes: 5.5 * 60,
    });
    expect(clipped.reduce((total, demand) => total + demand.personMinutes, 0)).toBe(16 * 60);
  });
});
