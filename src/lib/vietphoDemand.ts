import type { WeekdayKey } from "./demand";

export const VIETPHO_REFERENCE_INVOICES = 100;
export const VIETPHO_REFERENCE_TAX_INCLUDED = true;

export type VietphoDemandInterval = {
  startMinutes: number;
  endMinutes: number;
  personMinutes: number;
};

export type VietphoPeakInterval = {
  startMinutes: number;
  endMinutes: number;
  minStaff: number;
};

type ReferenceInterval = {
  startMinutes: number;
  endMinutes: number;
  staff: number;
};

const interval = (startMinutes: number, endMinutes: number, staff: number): ReferenceInterval => ({
  startMinutes,
  endMinutes,
  staff,
});

const WEEKDAY: readonly ReferenceInterval[] = [
  interval(11 * 60, 12 * 60 + 30, 1),
  interval(12 * 60 + 30, 13 * 60, 2),
  interval(13 * 60, 15 * 60, 1),
  interval(17 * 60, 18 * 60, 1),
  interval(18 * 60, 20 * 60, 2),
  interval(20 * 60, 22 * 60, 1),
];

const CONTINUOUS_DAY: readonly ReferenceInterval[] = [
  interval(11 * 60, 12 * 60 + 30, 1),
  interval(12 * 60 + 30, 13 * 60, 2),
  interval(13 * 60, 18 * 60, 1),
  interval(18 * 60, 20 * 60, 2),
  interval(20 * 60, 22 * 60, 1),
];

const WEEKEND: readonly ReferenceInterval[] = [
  interval(12 * 60, 12 * 60 + 30, 1),
  interval(12 * 60 + 30, 13 * 60, 2),
  interval(13 * 60, 18 * 60, 1),
  interval(18 * 60, 20 * 60, 2),
  interval(20 * 60, 22 * 60, 1),
];

const PEAKS: readonly VietphoPeakInterval[] = [
  { startMinutes: 12 * 60 + 30, endMinutes: 13 * 60, minStaff: 2 },
  { startMinutes: 18 * 60, endMinutes: 20 * 60, minStaff: 2 },
];

function profileOf(weekday: WeekdayKey, isHoliday: boolean): readonly ReferenceInterval[] {
  if (isHoliday || weekday === "saturday" || weekday === "sunday") return WEEKEND;
  if (weekday === "friday") return CONTINUOUS_DAY;
  return WEEKDAY;
}

function referencePersonMinutes(item: ReferenceInterval): number {
  return (item.endMinutes - item.startMinutes) * item.staff;
}

export function vietphoDemandIntervals(
  weekday: WeekdayKey,
  totalTargetMinutes: number,
  isHoliday = false,
): VietphoDemandInterval[] {
  const profile = profileOf(weekday, isHoliday);
  const referenceTotal = profile.reduce(
    (total, item) => total + referencePersonMinutes(item),
    0,
  );
  return profile.map((item) => ({
    startMinutes: item.startMinutes,
    endMinutes: item.endMinutes,
    personMinutes:
      referenceTotal > 0
        ? Math.max(0, totalTargetMinutes) * referencePersonMinutes(item) / referenceTotal
        : 0,
  }));
}

export function vietphoPeakIntervals(): VietphoPeakInterval[] {
  return PEAKS.map((peak) => ({ ...peak }));
}

/** Busy days are only about 20% above the quiet weekday baseline. */
export function vietphoDemandWeight(weekday: WeekdayKey, isHoliday = false): number {
  if (isHoliday || weekday === "friday" || weekday === "saturday") return 1.2;
  if (weekday === "sunday") return 1.05;
  return 1;
}

export function vietphoLateShiftRatio(weekday: WeekdayKey, isHoliday = false): number {
  if (isHoliday || weekday === "friday" || weekday === "saturday") return 0.65;
  if (weekday === "sunday") return 0.63;
  return 0.61;
}

// ---------------------------------------------------------------------------
// Bếp/Bồi (Okt 2026): Viet Pho braucht in JEDER offenen Minute 1 Bếp + 1 Bồi.
// Bồi-only (workRole SERVICE ohne „Làm được cả Bếp và Bồi") deckt nur Bồi.
// Alle anderen sind FLEX: einer davon kocht, ein zweiter FLEX serviert.
// Ein Inhaber arbeitet jeden offenen Tag, bevorzugt im Service.
// ---------------------------------------------------------------------------

export type VietphoGroup = "FLEX" | "SERVICE";

export function vietphoGroupOf(employee: {
  workRole?: "KITCHEN" | "SERVICE";
  canSwitchRole?: boolean;
}): VietphoGroup {
  return employee.workRole === "SERVICE" && !employee.canSwitchRole ? "SERVICE" : "FLEX";
}

export const VIETPHO_SLOT_MINUTES = 15;
/** Ein Bếp kann nur ein FLEX sein – darum zählt eine Bếp-Lücke doppelt. */
export const VIETPHO_KITCHEN_GAP_WEIGHT = 2;

export type VietphoPresence = {
  group: VietphoGroup;
  segments: readonly { startMinutes: number; endMinutes: number }[];
};

export type VietphoGapSlot = {
  startMinutes: number;
  endMinutes: number;
  kitchen: boolean;
  service: boolean;
};

export type VietphoOwnerSegment = {
  startMinutes: number;
  endMinutes: number;
  role: "KITCHEN" | "SERVICE";
};

/** One owner throughout opening hours; kitchen only when service is already covered. */
export function vietphoOwnerSegments(
  blocks: readonly { startMinutes: number; endMinutes: number }[],
  presence: readonly VietphoPresence[],
): VietphoOwnerSegment[] {
  const result: VietphoOwnerSegment[] = [];
  for (const block of blocks) {
    const boundaries = [...new Set([
      block.startMinutes, block.endMinutes,
      ...presence.flatMap((p) => p.segments.flatMap((s) => [s.startMinutes, s.endMinutes]))
        .filter((t) => t > block.startMinutes && t < block.endMinutes),
    ])].sort((a, b) => a - b);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const startMinutes = boundaries[i];
      const endMinutes = boundaries[i + 1];
      const active = presence.filter((p) => p.segments.some(
        (s) => s.startMinutes <= startMinutes && s.endMinutes >= endMinutes,
      ));
      const role = !active.some((p) => p.group === "FLEX") && active.some((p) => p.group === "SERVICE")
        ? "KITCHEN" : "SERVICE";
      const last = result[result.length - 1];
      if (last && last.endMinutes === startMinutes && last.role === role) last.endMinutes = endMinutes;
      else result.push({ startMinutes, endMinutes, role });
    }
  }
  return result;
}

export function vietphoPresenceWithOwner(
  blocks: readonly { startMinutes: number; endMinutes: number }[],
  presence: readonly VietphoPresence[],
): VietphoPresence[] {
  const owner = vietphoOwnerSegments(blocks, presence);
  return [...presence, ...(["KITCHEN", "SERVICE"] as const).map((role) => ({
    group: role === "KITCHEN" ? "FLEX" as const : "SERVICE" as const,
    segments: owner.filter((s) => s.role === role),
  }))];
}

/** Offene Zeitstücke (15 min), in denen Bếp und/oder Bồi fehlt. */
export function vietphoGapSlots(
  blocks: readonly { startMinutes: number; endMinutes: number }[],
  presence: readonly VietphoPresence[],
): VietphoGapSlot[] {
  const gaps: VietphoGapSlot[] = [];
  for (const block of blocks) {
    for (let t = block.startMinutes; t < block.endMinutes; t += VIETPHO_SLOT_MINUTES) {
      const end = Math.min(t + VIETPHO_SLOT_MINUTES, block.endMinutes);
      let flex = 0;
      let service = 0;
      for (const p of presence) {
        if (!p.segments.some((s) => s.startMinutes <= t && s.endMinutes >= end)) continue;
        if (p.group === "FLEX") flex++;
        else service++;
      }
      const kitchenMissing = flex < 1;
      const serviceMissing = service < 1 && flex < 2;
      if (kitchenMissing || serviceMissing) {
        gaps.push({ startMinutes: t, endMinutes: end, kitchen: kitchenMissing, service: serviceMissing });
      }
    }
  }
  return gaps;
}

/** Gewichtete fehlende Minuten (Bếp ×2, Bồi ×1). */
export function vietphoGapScore(gaps: readonly VietphoGapSlot[]): number {
  return gaps.reduce(
    (sum, g) =>
      sum +
      (g.endMinutes - g.startMinutes) *
        ((g.kitchen ? VIETPHO_KITCHEN_GAP_WEIGHT : 0) + (g.service ? 1 : 0)),
    0,
  );
}

/** Fehlende Minuten, die diese Gruppe überhaupt schließen könnte. */
export function vietphoGapScoreFor(group: VietphoGroup, gaps: readonly VietphoGapSlot[]): number {
  if (group === "FLEX") return vietphoGapScore(gaps);
  return gaps.reduce((sum, g) => sum + (g.service ? g.endMinutes - g.startMinutes : 0), 0);
}

/** Zusammenhängende Lücken je Rolle als Zeitspannen, für Hinweise „Chủ làm". */
export function vietphoGapRanges(
  gaps: readonly VietphoGapSlot[],
  role: "kitchen" | "service",
): { startMinutes: number; endMinutes: number }[] {
  const ranges: { startMinutes: number; endMinutes: number }[] = [];
  for (const g of gaps) {
    if (!g[role]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.endMinutes === g.startMinutes) last.endMinutes = g.endMinutes;
    else ranges.push({ startMinutes: g.startMinutes, endMinutes: g.endMinutes });
  }
  return ranges;
}
