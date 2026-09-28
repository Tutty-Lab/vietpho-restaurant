import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { generateSchedule } from "../scheduler";
import { teilzeitShiftCount } from "../splitTargetHours";
import { DEFAULT_WORK_HOURS, resolveDay } from "../workHours";
import { holidaysOf } from "../holidays";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import { isEmployeeFixedDayOff } from "../fixedDaysOff";
import { validateSchedule } from "../validation";
import { isThienlongMonthRushDate, thienlongMealPeakIntervals } from "../thienlongDemand";
import { withAutomaticAzubiTarget } from "../azubi";
import { withEmploymentPeriodTarget } from "../employmentPeriod";
import { applyRoleChanges, findRoleSwitchOptions } from "../suggestions";
import { monthRole } from "../roleCoverage";

// Thienlong-Team wie im Live-Stand (Aug 2026): 4 Köche mit 6 Tagen/Woche,
// 4 Azubis mit 5 Tagen/Woche, 3 Aushilfen, 1 Vollzeit-Service ohne Tage/Woche.
const azubi = (hours: number) => ({ inSchoolTerm: false, schoolDays: [], monthlyHoursOutOfTerm: hours });
const team: Employee[] = [
  { id: "tl", name: "Service VZ", employmentType: "VOLLZEIT", targetMinutes: 192 * 60, workRole: "SERVICE", fixedDaysOff: ["sunday"] },
  { id: "hs", name: "Koch 1", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN", fixedDaysOff: ["tuesday"], desiredDaysPerWeek: 6 },
  { id: "hl", name: "Koch 2", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN", fixedDaysOff: ["wednesday"], desiredDaysPerWeek: 6 },
  { id: "qp", name: "Aushilfe 1", employmentType: "TEILZEIT", targetMinutes: 100 * 60, workRole: "SERVICE" },
  { id: "jl", name: "Koch 3", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN", fixedDaysOff: ["monday"], desiredDaysPerWeek: 6 },
  { id: "at", name: "Koch 4", employmentType: "VOLLZEIT", targetMinutes: 168 * 60, workRole: "KITCHEN", fixedDaysOff: ["thursday"], desiredDaysPerWeek: 6 },
  { id: "bm", name: "Aushilfe 2", employmentType: "TEILZEIT", targetMinutes: 20 * 60, workRole: "SERVICE" },
  { id: "pn", name: "Aushilfe 3", employmentType: "TEILZEIT", targetMinutes: 60 * 60, workRole: "SERVICE" },
  { id: "lh", name: "Azubi 1", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "SERVICE", fixedDaysOff: ["monday", "wednesday"], desiredDaysPerWeek: 5, azubi: azubi(174) },
  { id: "pd", name: "Azubi 2", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "KITCHEN", fixedDaysOff: ["sunday", "tuesday"], desiredDaysPerWeek: 5, azubi: azubi(174) },
  { id: "hh", name: "Azubi 3", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "SERVICE", fixedDaysOff: ["tuesday", "thursday"], desiredDaysPerWeek: 5, azubi: azubi(174) },
  { id: "vd", name: "Azubi 4", employmentType: "AZUBI", targetMinutes: 174 * 60, workRole: "KITCHEN", fixedDaysOff: ["sunday", "friday"], desiredDaysPerWeek: 5, azubi: azubi(174) },
];

const year = 2026;
const month = 8;
const holidays = holidaysOf(year, "BW");
const shifts: Shift[] = generateSchedule({
  year,
  month,
  storeId: "thienlong",
  workHours: DEFAULT_WORK_HOURS,
  employees: team,
  holidayState: "BW",
});
const openDates = [...new Set(shifts.map((s) => s.date))].filter(
  (d) => !resolveDay(DEFAULT_WORK_HOURS, d, holidays, {}).closed,
);
const shiftsOf = (id: string) => shifts.filter((s) => s.employeeId === id);

describe("Thienlong with the real team settings", () => {
  it("hits every monthly target exactly and passes validation", () => {
    for (const e of team) {
      expect(shiftsOf(e.id).reduce((sum, s) => sum + s.paidMinutes, 0), e.name).toBe(e.targetMinutes);
    }
    expect(
      validateSchedule(team, shifts, { year, month, storeId: "thienlong", workHours: DEFAULT_WORK_HOURS, holidayState: "BW" }).errors,
    ).toEqual([]);
  });

  it("keeps the minimum Bếp/Bồi at 14–17 and 20–22 on Fri/Sat/Sun", () => {
    const roleOf = (id: string) => team.find((e) => e.id === id)!.workRole;
    const rule = [
      { from: 14 * 60, to: 17 * 60, kitchen: 3 },
      { from: 20 * 60, to: 22 * 60, kitchen: 2 },
    ];
    for (const date of openDates) {
      const wd = new Date(`${date}T12:00:00`).getDay();
      if (![5, 6, 0].includes(wd)) continue;
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      for (const w of rule) {
        for (let t = w.from; t < w.to; t += 30) {
          if (!day.blocks.some((b) => b.startMinutes <= t && b.endMinutes >= t + 30)) continue;
          const count = (role: string) =>
            shifts.filter(
              (s) =>
                s.date === date &&
                roleOf(s.employeeId) === role &&
                (s.segments ?? [s]).some((g) => g.startMinutes <= t && g.endMinutes >= t + 30),
            ).length;
          expect(count("KITCHEN"), `${date} ${t / 60} Bếp`).toBeGreaterThanOrEqual(w.kitchen);
          expect(count("SERVICE"), `${date} ${t / 60} Bồi`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("gives month-change weekdays (last day, 1st–3rd) a bit more than normal weekdays, less than Saturday", () => {
    const hoursOn = (date: string) =>
      shifts.filter((s) => s.date === date).reduce((sum, s) => sum + s.paidMinutes, 0);
    const avg = (dates: string[]) => dates.reduce((sum, d) => sum + hoursOn(d), 0) / dates.length;
    const weekday = (d: string) => new Date(`${d}T12:00:00`).getDay();
    const rushWeekdays = openDates.filter((d) => isThienlongMonthRushDate(d) && [1, 2, 3, 4].includes(weekday(d)));
    const normalWeekdays = openDates.filter((d) => !isThienlongMonthRushDate(d) && [1, 2, 3, 4].includes(weekday(d)));
    const saturdays = openDates.filter((d) => weekday(d) === 6);
    expect(rushWeekdays.length).toBeGreaterThan(0);
    expect(avg(rushWeekdays)).toBeGreaterThan(avg(normalWeekdays));
    expect(avg(rushWeekdays)).toBeLessThan(avg(saturdays));
  });

  it("works exactly the requested days per week (every non-fixed-off day when that is all there is)", () => {
    for (const e of team.filter((x) => x.desiredDaysPerWeek)) {
      const eligible = openDates.filter((d) => !isEmployeeFixedDayOff(e, d));
      // 6 bzw. 5 Tage/Woche bei 1 bzw. 2 festen Ruhetagen = jeder erlaubte Tag.
      expect(shiftsOf(e.id).length, e.name).toBe(eligible.length);
    }
  });

  it("spreads full-time hours over the days (5–9 h, longer on thinly staffed days) instead of 9–10 h blocks", () => {
    for (const id of ["hs", "hl", "jl", "at"]) {
      for (const s of shiftsOf(id)) {
        expect(s.paidMinutes, `${id} ${s.date}`).toBeGreaterThanOrEqual(5 * 60);
        expect(s.paidMinutes, `${id} ${s.date}`).toBeLessThanOrEqual(9 * 60);
      }
    }
  });

  it("gives part-timers many short 2–4 h visits, one piece each, only at lunch or dinner", () => {
    for (const e of team.filter((x) => x.employmentType === "TEILZEIT")) {
      const mine = shiftsOf(e.id);
      // ≈ Soll / 2,5 h Einsätze (höchstens 6 von 7 Tagen).
      const planned = teilzeitShiftCount(e.targetMinutes / 60, Math.floor((openDates.length * 6) / 7));
      expect(mine.length, e.name).toBeGreaterThanOrEqual(planned - 1);
      expect(mine.length, e.name).toBeLessThanOrEqual(planned + 2);
      for (const s of mine) {
        expect(s.segments, `${e.name} ${s.date} ungeteilt`).toBeUndefined();
        expect(s.paidMinutes, `${e.name} ${s.date}`).toBeGreaterThanOrEqual(2 * 60);
        expect(s.paidMinutes, `${e.name} ${s.date}`).toBeLessThanOrEqual(4 * 60);
      }
      // Nur Mittag ODER Abend – Ausnahme nur, wenn sonst niemand öffnet/schließt.
      const offPeak = mine.filter((s) => {
        const lunch = s.startMinutes >= 10 * 60 + 30 && s.endMinutes <= 15 * 60;
        const dinner = s.startMinutes >= 16 * 60 + 30 && s.endMinutes <= 22 * 60;
        return !lunch && !dinner;
      });
      expect(offPeak.length, e.name).toBeLessThanOrEqual(Math.ceil(mine.length * 0.1));
    }
  });

  it("keeps at least two kitchen and two service people on every open day", () => {
    const roleOf = new Map(team.map((e) => [e.id, e.workRole]));
    for (const date of openDates) {
      for (const role of ["KITCHEN", "SERVICE"] as const) {
        const people = shifts.filter((s) => s.date === date && roleOf.get(s.employeeId) === role).length;
        expect(people, `${role} ${date}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("never leaves a 30-minute slot without kitchen or without service", () => {
    const roleOf = new Map(team.map((e) => [e.id, e.workRole]));
    for (const date of openDates) {
      const day = resolveDay(DEFAULT_WORK_HOURS, date, holidays, {});
      for (const block of day.blocks) {
        for (let t = block.startMinutes; t + 30 <= block.endMinutes; t += 30) {
          for (const role of ["KITCHEN", "SERVICE"] as const) {
            const present = shifts.some(
              (s) =>
                s.date === date &&
                roleOf.get(s.employeeId) === role &&
                (s.segments ?? [s]).some((g) => g.startMinutes <= t && g.endMinutes >= t + 30),
            );
            expect(present, `${role} ${date} ${t / 60}h`).toBe(true);
          }
        }
      }
    }
  });
});

describe("standard shifts anchored on the peaks", () => {
  it("keeps almost every shift piece standard (≥ 3 h covers a meal peak, shorter lies inside)", () => {
    const holidaysSet = holidaysOf(2026, "BW");
    let standard = 0;
    let all = 0;
    for (const s of shifts) {
      const day = resolveDay(DEFAULT_WORK_HOURS, s.date, holidaysSet, {});
      const open = day.blocks[0].startMinutes;
      // Stoßzeiten wie im Planer: Mittag 12–14, Abend Mo–Do 18:00–20:30,
      // Fr/Sa/So und Feiertage 18:00–21:00.
      const peaks = thienlongMealPeakIntervals(weekdayKeyOf(parseIsoDate(s.date)), holidaysSet.has(s.date))
        .map((p) => [Math.max(p.startMinutes, open), p.endMinutes]);
      for (const g of s.segments ?? [s]) {
        all += 1;
        const len = g.endMinutes - g.startMinutes;
        const ok = len >= 180
          ? peaks.some(([a, b]) => g.startMinutes <= a && g.endMinutes >= b)
          : peaks.some(([a, b]) => g.startMinutes >= a && g.endMinutes <= b);
        if (ok) standard += 1;
      }
    }
    expect(standard / all).toBeGreaterThanOrEqual(0.95);
  });

  it("gives the same plan for the same input (deterministic)", () => {
    const again = generateSchedule({
      year,
      month,
      storeId: "thienlong",
      workHours: DEFAULT_WORK_HOURS,
      employees: team,
      holidayState: "BW",
    });
    expect(again).toEqual(shifts);
  });
});

describe("Thienlong when Azubis are away (school) – nobody replaces them", () => {
  const ctx = { year: 2026, month: 9, storeId: "thienlong", workHours: DEFAULT_WORK_HOURS, holidayState: "BW" as const };
  const inSchool = (e: Employee, from: string): Employee =>
    e.employmentType !== "AZUBI"
      ? e
      : withAutomaticAzubiTarget(
          { ...e, azubi: { ...e.azubi!, inSchoolTerm: true, schoolTermStart: from, schoolTermEnd: "2026-12-31" } },
          2026,
          9,
        );

  it("all four Azubis in school the whole month (~1040 h left): targets exact, every rule holds", () => {
    // Wie im Live-Stand (Sept 2026): Service-Vollzeit mit 6 Tagen/Woche.
    const away = team
      .map((e) => (e.id === "tl" ? { ...e, desiredDaysPerWeek: 6 } : e))
      .map((e) => inSchool(e, "2026-09-01"));
    expect(away.filter((e) => e.employmentType === "AZUBI").every((e) => e.targetMinutes === 0)).toBe(true);
    const planned = generateSchedule({ ...ctx, employees: away });
    for (const e of away) {
      expect(planned.filter((s) => s.employeeId === e.id).reduce((sum, s) => sum + s.paidMinutes, 0), e.name)
        .toBe(e.targetMinutes);
    }
    expect(validateSchedule(away, planned, ctx).errors).toEqual([]);
  });

  it("says plainly when a day simply has too few cooks", () => {
    const away = team
      .map((e) => inSchool(e, "2026-09-01"))
      .map((e) => (e.id === "at" || e.id === "hl" ? withEmploymentPeriodTarget({ ...e, endDate: "2026-09-10" }, 2026, 9) : e));
    const planned = generateSchedule({ ...ctx, employees: away });
    const errors = validateSchedule(away, planned, ctx).errors;
    const cooks = errors.find((e) => e.message.includes("cần ít nhất 3 Bếp"));
    expect(cooks?.kind).toBe("coverage");
    expect(cooks?.reason).toContain("không đủ người");
    expect(cooks?.suggestion).toBeTruthy();
  });

  it("finds a whole-month role switch that really lowers the errors (Bồi short → a cook serves)", async () => {
    // Azubis in der Schule, Service-Vollzeit geht am 10.9. – Bồi fehlt, Köche sind da.
    const away = team
      .map((e) => (e.id === "tl" ? { ...e, desiredDaysPerWeek: 6 } : e))
      .map((e) => inSchool(e, "2026-09-01"))
      .map((e) => (e.id === "tl" ? withEmploymentPeriodTarget({ ...e, endDate: "2026-09-10" }, 2026, 9) : e))
      .map((e) => (e.id === "hs" || e.id === "jl" ? { ...e, canSwitchRole: true } : e));
    const result = await findRoleSwitchOptions(away, ctx);
    expect(result.options.length).toBeGreaterThan(0);
    const best = result.options[0];
    expect(best.errors).toBeLessThan(result.baselineErrors);
    expect(best.changes.every((c) => c.from === "KITCHEN" && c.to === "SERVICE")).toBe(true);
    expect(best.changes.every((c) => c.employeeId === "hs" || c.employeeId === "jl")).toBe(true);

    // Übernommen: die Person zählt den ganzen Monat als Bồi, im nächsten wieder als Bếp.
    const applied = applyRoleChanges(away, best.changes, 2026, 9);
    const switched = applied.find((e) => e.id === best.changes[0].employeeId)!;
    expect(monthRole(switched, 2026, 9)).toBe("SERVICE");
    expect(monthRole(switched, 2026, 10)).toBe("KITCHEN");
  }, 120000);
});

describe("Azubi with more hours than the 40-h week allows – warn, never block", () => {
  it("plans the maximum (170 h) and explains week by week why 174 h do not fit", () => {
    const ctx = { year: 2026, month: 9, storeId: "thienlong", workHours: DEFAULT_WORK_HOURS, holidayState: "BW" as const };
    const september = team.map((e) => (e.id === "tl" ? { ...e, desiredDaysPerWeek: 6 } : e));
    const planned = generateSchedule({ ...ctx, employees: september }); // wirft nicht mehr
    const lh = september.find((e) => e.id === "lh")!; // Azubi, nghỉ T2 + T4, 174 h
    expect(planned.filter((s) => s.employeeId === "lh").reduce((sum, s) => sum + s.paidMinutes, 0)).toBe(170 * 60);

    const result = validateSchedule(september, planned, ctx);
    const warning = result.errors.find((e) => e.employeeId === "lh");
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain("tối đa 170h");
    // Konkret: die letzte Woche hat nur Di 29.09, Mo 28. und Mi 30. sind Ruhetage.
    expect(warning?.reason).toContain("chỉ T3 29.09");
    expect(warning?.reason).toContain("T2 28.09 nghỉ cố định");
    expect(warning?.reason).toContain("T4 30.09 nghỉ cố định");
    expect(warning?.reason).toContain("Tổng tối đa 170h < 174h");
    expect(lh.targetMinutes).toBe(174 * 60);
    // Nur Warnungen → der Plan gilt als gültig.
    expect(result.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

