import type { Employee, Shift, ShiftSegment } from "../types";
import type { GenerateInput } from "./scheduler";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "./demand";
import { isEmployeeAvailableOn } from "./availability";
import { isEmployeeFixedDayOff } from "./fixedDaysOff";
import { holidaysOf } from "./holidays";
import { resolveDay } from "./workHours";
import { calculatePaidMinutes, calculatePause } from "./time";

export function vietphoRosterEmployees(employees: Employee[]): Employee[] {
  return employees.map((e) => {
    if (e.workRole !== "SERVICE" || e.employmentType === "AZUBI") return e;
    if (e.workDays !== undefined || e.fixedDaysOff !== undefined) return e;
    const hours = (e.baseTargetMinutes ?? e.targetMinutes) / 60;
    if (hours === 20) return { ...e, workDays: ["sunday"], fixedDaysOff: undefined };
    if (hours === 80) return { ...e, workDays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], fixedDaysOff: undefined };
    return e;
  });
}

/** Explicit scheduling preferences use the general planner, which supports them. */
function usesCustomPlanning(e: Employee): boolean {
  if (e.workRole === "SERVICE" && e.fixedDaysOff?.length) return true;
  if (e.desiredDaysPerWeek || e.spreadEvenly || e.preferredWindows?.length || e.shiftHours) return true;
  if (e.workDays === undefined) return false;
  const hours = (e.baseTargetMinutes ?? e.targetMinutes) / 60;
  const defaults = e.workRole === "SERVICE" && hours === 20 ? ["sunday"]
    : e.workRole === "SERVICE" && hours === 80 ? ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] : null;
  return defaults === null || defaults.length !== e.workDays.length || defaults.some((d) => !e.workDays!.includes(d as typeof e.workDays[number]));
}

/** Fixed service visits and alternating kitchen coverage take priority over monthly targets. */
export function applyVietphoRoster(input: GenerateInput, original: Shift[]): Shift[] {
  input = { ...input, employees: vietphoRosterEmployees(input.employees) };
  const dates = datesOfMonth(input.year, input.month);
  const holidays = input.holidays ?? holidaysOf(input.year, input.holidayState ?? "BW");
  const cooks = input.employees.filter((e) => e.workRole === "KITCHEN" && e.targetMinutes > 0);
  const kitchen = cooks.some(usesCustomPlanning) ? [] : cooks;
  const service = input.employees.filter((e) => e.workRole === "SERVICE" && e.employmentType !== "AZUBI" && !usesCustomPlanning(e));
  const regular = service.filter((e) => (e.baseTargetMinutes ?? e.targetMinutes) === 80 * 60);
  const relief = service.filter((e) => (e.baseTargetMinutes ?? e.targetMinutes) === 20 * 60);
  const managed = new Set([...regular, ...relief, ...(kitchen.length === 2 ? kitchen : [])].map((e) => e.id));
  const result = original.filter((s) => !managed.has(s.employeeId));
  const available = (e: Employee, date: string) => isEmployeeAvailableOn(e, date) && !isEmployeeFixedDayOff(e, date);
  const add = (e: Employee, date: string, segments: ShiftSegment[]) => {
    if (!segments.length) return;
    const startMinutes = segments[0].startMinutes;
    const endMinutes = segments[segments.length - 1].endMinutes;
    const split = segments.length > 1;
    const continuousPause = [0, 30, 60].find((pause) =>
      calculatePause(endMinutes - startMinutes - pause) === pause) ?? 60;
    const paidMinutes = split
      ? segments.reduce((sum, s) => sum + s.endMinutes - s.startMinutes, 0)
      : calculatePaidMinutes(startMinutes, endMinutes, continuousPause);
    const pauseMinutes = split ? 0 : endMinutes - startMinutes - paidMinutes;
    result.push({ id: `vietpho-roster-${e.id}-${date}`, employeeId: e.id, date,
      startMinutes, endMinutes, paidMinutes, pauseMinutes,
      ...(split ? { segments } : {}), shiftType: "CUSTOM", generated: true });
  };
  const paired: { date: string; blocks: ShiftSegment[] }[] = [];
  const sundays = dates.filter((date) => parseIsoDate(date).getDay() === 0).length;
  // Bồi 80h works every Mon–Sat; each day's two pieces (from 12:00 and 18:00)
  // shrink so the month lands on the target (≈ 12:00–13:30 + 18:00–19:30).
  const openDays = (e: Employee) => dates.filter((date) => {
    const day = resolveDay(input.workHours, date, holidays, input.overrides ?? {});
    return !day.closed && day.blocks.length > 0 && parseIsoDate(date).getDay() !== 0 && available(e, date);
  }).length;
  const regularLeft = new Map(regular.map((e) => [e.id, { minutes: e.targetMinutes, days: openDays(e) }]));
  for (const date of dates) {
    const day = resolveDay(input.workHours, date, holidays, input.overrides ?? {});
    if (day.closed || !day.blocks.length) continue;
    const weekday = weekdayKeyOf(parseIsoDate(date));
    const sunday = weekday === "sunday";
    for (const e of sunday ? relief : regular) {
      if (!available(e, date)) continue;
      const left = regularLeft.get(e.id);
      let lunch = 120;
      let dinner = 120;
      if (sunday && sundays === 4) { lunch = 150; dinner = 150; }
      if (left) {
        const today = Math.min(240, Math.round(left.minutes / Math.max(1, left.days) / 15) * 15);
        lunch = Math.floor(today / 2 / 15) * 15;
        dinner = today - lunch;
      }
      const windows = [{ startMinutes: 720, endMinutes: 720 + lunch }, { startMinutes: 1080, endMinutes: 1080 + dinner }];
      const segments = windows.flatMap((w) => day.blocks.map((b) => ({
        startMinutes: Math.max(w.startMinutes, b.startMinutes), endMinutes: Math.min(w.endMinutes, b.endMinutes),
      })).filter((s) => s.endMinutes > s.startMinutes));
      add(e, date, segments);
      if (left) {
        left.minutes -= segments.reduce((sum, g) => sum + g.endMinutes - g.startMinutes, 0);
        left.days -= 1;
      }
    }
    if (kitchen.length !== 2) continue;
    // Only the configured availability determines a cook's rest days.
    const active = kitchen.filter((e) => available(e, date));
    if (!active.length) continue;
    if (active.length === 1) { add(active[0], date, day.blocks.map((b) => ({ ...b }))); continue; }
    paired.push({ date, blocks: day.blocks });
  }
  // Two-cook days: split each day by the hours each cook still needs, not 50/50.
  if (kitchen.length === 2) {
    const paidOf = (e: Employee) => result.filter((s) => s.employeeId === e.id).reduce((sum, s) => sum + s.paidMinutes, 0);
    let need = kitchen[0].targetMinutes - paidOf(kitchen[0]);
    let left = paired.reduce((sum, d) => sum + d.blocks.reduce((t, b) => t + b.endMinutes - b.startMinutes, 0), 0);
    for (const { date, blocks } of paired) {
      const total = blocks.reduce((sum, b) => sum + b.endMinutes - b.startMinutes, 0);
      const share = left > 0 ? Math.round(Math.max(0, need) * total / left / 15) * 15 : total / 2;
      const target = Math.min(total, Math.max(60, Math.min(total - 60, share)));
      const week = Math.floor((parseIsoDate(date).getDate() - 1) / 7);
      const early = kitchen[week % 2];
      const late = kitchen[(week + 1) % 2];
      const cutAt = (first: number) => {
        let remaining = early === kitchen[0] ? first : total - first;
        const earlySegments: ShiftSegment[] = [];
        const lateSegments: ShiftSegment[] = [];
        for (const b of blocks) {
          const cut = Math.min(b.endMinutes, b.startMinutes + remaining);
          if (cut > b.startMinutes) earlySegments.push({ startMinutes: b.startMinutes, endMinutes: cut });
          if (cut < b.endMinutes) lateSegments.push({ startMinutes: cut, endMinutes: b.endMinutes });
          remaining -= cut - b.startMinutes;
        }
        return [earlySegments, lateSegments];
      };
      // No piece under 1 h, and no continuous 6–6.5 h or 8.5–9 h stint (no valid
      // break length exists for those); nudge the cut until both hold.
      const breakable = (segments: ShiftSegment[]) => {
        if (segments.some((g) => g.endMinutes - g.startMinutes < 60)) return false;
        if (segments.length !== 1) return true;
        const presence = segments[0].endMinutes - segments[0].startMinutes;
        return !((presence > 360 && presence <= 390) || (presence >= 510 && presence < 540));
      };
      const [earlySegments, lateSegments] = [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90, -90]
        .map((delta) => cutAt(Math.min(total, Math.max(0, target + delta))))
        .find((parts) => parts.every(breakable)) ?? cutAt(target);
      const before = paidOf(kitchen[0]);
      add(early, date, earlySegments);
      add(late, date, lateSegments);
      need -= paidOf(kitchen[0]) - before;
      left -= total;
    }
  }
  // Kitchen hours still owed become overlap with the other cook: first the
  // Fri/Sat dinner (18–20), then any dinner, then the lunch peak (12–14), then
  // the remaining open hours. Long days (9–10 h) are fine; never above target.
  if (kitchen.length === 2) {
    const used = (e: Employee) => result.filter((s) => s.employeeId === e.id).reduce((sum, s) => sum + s.paidMinutes, 0);
    const piecesOf = (shift: Shift): ShiftSegment[] =>
      (shift.segments ?? [{ startMinutes: shift.startMinutes, endMinutes: shift.endMinutes }]).map((g) => ({ ...g }));
    const breakable = (segments: ShiftSegment[]) => {
      if (segments.length !== 1) return true;
      const presence = segments[0].endMinutes - segments[0].startMinutes;
      return !((presence > 360 && presence <= 390) || (presence >= 510 && presence < 540));
    };
    /** Cook's pieces stretched over `w` inside its block (contiguous, no new gaps). */
    const stretch = (pieces: ShiftSegment[], w: ShiftSegment, blocks: ShiftSegment[]) => {
      const block = blocks.find((b) => b.startMinutes <= w.startMinutes && w.endMinutes <= b.endMinutes);
      if (!block) return null;
      const inBlock = pieces.find((g) => g.startMinutes < block.endMinutes && g.endMinutes > block.startMinutes);
      const next = pieces.filter((g) => g !== inBlock).map((g) => ({ ...g }));
      next.push(inBlock
        ? { startMinutes: Math.min(inBlock.startMinutes, w.startMinutes), endMinutes: Math.max(inBlock.endMinutes, w.endMinutes) }
        : { ...w });
      return next.sort((a, b) => a.startMinutes - b.startMinutes);
    };
    const isWeekendEve = (date: string) => [5, 6].includes(parseIsoDate(date).getDay());
    const waves: { days: (date: string) => boolean; window: ShiftSegment }[] = [
      { days: isWeekendEve, window: { startMinutes: 1080, endMinutes: 1200 } },
      { days: (d) => !isWeekendEve(d), window: { startMinutes: 1080, endMinutes: 1200 } },
      { days: () => true, window: { startMinutes: 720, endMinutes: 840 } },
      { days: () => true, window: { startMinutes: 1020, endMinutes: 1080 } },
      { days: () => true, window: { startMinutes: 840, endMinutes: 900 } },
      { days: () => true, window: { startMinutes: 1200, endMinutes: 1320 } },
      { days: () => true, window: { startMinutes: 660, endMinutes: 720 } },
    ];
    for (const e of kitchen) {
      for (const wave of waves) {
        for (const date of dates) {
          if (used(e) >= e.targetMinutes) break;
          if (!wave.days(date)) continue;
          const day = resolveDay(input.workHours, date, holidays, input.overrides ?? {});
          const onDay = result.filter((s) => s.date === date && kitchen.some((k) => k.id === s.employeeId));
          const shift = onDay.find((s) => s.employeeId === e.id);
          if (!shift || onDay.length !== 2) continue;
          const room = e.targetMinutes - used(e);
          // Try the whole window, then smaller pieces of it next to the shift.
          const tries = [];
          for (let cut = 0; cut <= wave.window.endMinutes - wave.window.startMinutes - 15; cut += 15) {
            tries.push({ startMinutes: wave.window.startMinutes, endMinutes: wave.window.endMinutes - cut });
            if (cut > 0) tries.push({ startMinutes: wave.window.startMinutes + cut, endMinutes: wave.window.endMinutes });
          }
          for (const w of tries) {
            const next = stretch(piecesOf(shift), w, day.blocks);
            if (!next || !breakable(next) || next.some((g) => g.endMinutes - g.startMinutes < 60)) continue;
            const index = result.indexOf(shift);
            add(e, date, next);
            const candidate = result.pop()!;
            const gain = candidate.paidMinutes - shift.paidMinutes;
            if (gain > 0 && gain <= room && candidate.paidMinutes <= 600) {
              result[index] = candidate;
              break;
            }
          }
        }
      }
    }
    // Rounding can leave a cook a little above target: trim 15 min off an edge
    // the other cook also covers, so the kitchen never goes empty.
    for (const e of kitchen) {
      for (const date of dates) {
        if (used(e) <= e.targetMinutes) break;
        const shift = result.find((s) => s.date === date && s.employeeId === e.id);
        const other = result.find((s) => s.date === date && kitchen.some((k) => k.id === s.employeeId && k.id !== e.id));
        if (!shift || !other) continue;
        const covered = (t: number) => piecesOf(other).some((g) => g.startMinutes <= t && g.endMinutes >= t + 15);
        const pieces = piecesOf(shift);
        for (const [i, side] of pieces.flatMap((_, i) => [[i, "start"], [i, "end"]] as const)) {
          const next = pieces.map((g) => ({ ...g }));
          const g = next[i];
          if (side === "start" ? !covered(g.startMinutes) : !covered(g.endMinutes - 15)) continue;
          if (side === "start") g.startMinutes += 15; else g.endMinutes -= 15;
          if (!breakable(next) || next.some((p) => p.endMinutes - p.startMinutes < 60)) continue;
          const index = result.indexOf(shift);
          add(e, date, next);
          const candidate = result.pop()!;
          if (candidate.paidMinutes < shift.paidMinutes && used(e) - shift.paidMinutes + candidate.paidMinutes >= e.targetMinutes) {
            result[index] = candidate;
            break;
          }
        }
      }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || a.employeeId.localeCompare(b.employeeId));
}
