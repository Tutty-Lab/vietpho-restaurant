import { describe, expect, it } from "vitest";
import { datesOfMonth } from "../demand";
import { createSampleSchedule } from "../sampleData";
import { defaultWorkHoursForStore } from "../workHours";
import { vietphoOwnerForDate } from "../vietphoOwner";
import { vietphoGapSlots, vietphoOwnerSegments, vietphoPresenceWithOwner } from "../vietphoDemand";

describe("Viet Pho owner", () => {
  const blocks = [{ startMinutes: 660, endMinutes: 900 }, { startMinutes: 1020, endMinutes: 1320 }];

  it("works service throughout opening hours even when nobody else works", () => {
    expect(vietphoOwnerSegments(blocks, [])).toEqual(blocks.map((b) => ({ ...b, role: "SERVICE" })));
    const gaps = vietphoGapSlots(blocks, vietphoPresenceWithOwner(blocks, []));
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.kitchen && !g.service)).toBe(true);
  });

  it("prefers service with a flexible colleague, and covers kitchen only with service staff", () => {
    expect(vietphoOwnerSegments(blocks, [{ group: "FLEX", segments: blocks }]))
      .toEqual(blocks.map((b) => ({ ...b, role: "SERVICE" })));
    const staff = [{ group: "SERVICE" as const, segments: [{ startMinutes: 675, endMinutes: 900 }] }];
    expect(vietphoOwnerSegments(blocks, staff)).toEqual([
      { startMinutes: 660, endMinutes: 675, role: "SERVICE" },
      { startMinutes: 675, endMinutes: 900, role: "KITCHEN" },
      { startMinutes: 1020, endMinutes: 1320, role: "SERVICE" },
    ]);
    const gaps = vietphoGapSlots(blocks, vietphoPresenceWithOwner(blocks, staff));
    expect(gaps.some((g) => g.startMinutes >= 675 && g.endMinutes <= 900)).toBe(false);
  });

  it("includes every day, holidays and overrides, while respecting closures", () => {
    const schedule = createSampleSchedule();
    schedule.workHours = defaultWorkHoursForStore("vietpho");
    schedule.month = 10;
    schedule.dateOverrides = [
      { date: "2026-10-05", closed: true },
      { date: "2026-10-06", closed: false, window: { startMinutes: 720, endMinutes: 840 } },
    ];
    const before = structuredClone(schedule);
    for (const date of datesOfMonth(2026, 10)) {
      expect(vietphoOwnerForDate(schedule, date, []).length > 0).toBe(date !== "2026-10-05");
    }
    expect(vietphoOwnerForDate(schedule, "2026-10-03", [])).toEqual([
      { startMinutes: 720, endMinutes: 1320, role: "SERVICE" },
    ]);
    expect(vietphoOwnerForDate(schedule, "2026-10-06", [])).toEqual([
      { startMinutes: 720, endMinutes: 840, role: "SERVICE" },
    ]);
    expect(schedule).toEqual(before);
  });
});
