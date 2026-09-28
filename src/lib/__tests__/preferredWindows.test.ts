import { describe, expect, it } from "vitest";
import type { Employee, Shift } from "../../types";
import { withMonthRoles } from "../roleCoverage";
import { generateSchedule } from "../scheduler";
import { describePreferredWindow, minutesOutsidePreferred } from "../preferredWindows";
import { parseIsoDate, weekdayKeyOf } from "../demand";
import { validateSchedule } from "../validation";

// Echtes Thienlong-Team September 2026.
const B = (s: number, e: number) => ({ startMinutes: s, endMinutes: e });
const weekdayMoThu = [B(630, 900), B(990, 1320)];
const workHours = {
  perWeekday: {
    monday: weekdayMoThu, tuesday: weekdayMoThu, wednesday: weekdayMoThu, thursday: weekdayMoThu,
    friday: [B(630, 1320)], saturday: [B(690, 1320)], sunday: [B(690, 1320)],
  },
  holiday: [B(690, 1320)],
};
const azubiTerm = {
  schoolDays: ["monday", "tuesday"], inSchoolTerm: true,
  schoolTermStart: "2026-09-14", schoolTermEnd: "2026-10-31",
  monthlyHoursByMonth: { "2026-09": 80 }, monthlyHoursOutOfTerm: 174,
};
const employees = [
  { id: "loan", name: "Thuy Loan Pham Thi", workRole: "SERVICE", fixedDaysOff: ["sunday"], targetMinutes: 11520, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "son", name: "Hong Son Nguyen", workRole: "KITCHEN", fixedDaysOff: ["tuesday"], canSwitchRole: true, targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "long", name: "Huu Long Bui", workRole: "KITCHEN", fixedDaysOff: ["wednesday"], targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "qui", name: "Qui Phi Nguyen", workRole: "SERVICE", targetMinutes: 6000, employmentType: "TEILZEIT" },
  { id: "jit", name: "Jitsophee Luecha", workRole: "KITCHEN", fixedDaysOff: ["monday"], targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "tuan", name: "Anh Tuan Nguyen", workRole: "KITCHEN", fixedDaysOff: ["thursday"], targetMinutes: 10080, employmentType: "VOLLZEIT", desiredDaysPerWeek: 6 },
  { id: "bianca", name: "Bianca Müller", workRole: "SERVICE", targetMinutes: 1200, employmentType: "TEILZEIT" },
  { id: "patrizia", name: "Patrizia Nicosia", workRole: "SERVICE", targetMinutes: 3600, employmentType: "TEILZEIT" },
  { id: "hang", name: "La Thi Hang", workRole: "SERVICE", fixedDaysOff: ["monday", "wednesday"], targetMinutes: 4800, employmentType: "AZUBI", desiredDaysPerWeek: 5,
    azubi: { ...azubiTerm, workMonthHoursByMonth: { "2026-09": 168 } } },
  { id: "dao", name: "Phung Quang Dao", workRole: "KITCHEN", fixedDaysOff: ["sunday", "tuesday"], targetMinutes: 4800, employmentType: "AZUBI", desiredDaysPerWeek: 5, azubi: azubiTerm },
  { id: "hoan", name: "Huu Hoan Nguyen", workRole: "SERVICE", fixedDaysOff: ["tuesday", "thursday"], targetMinutes: 4800, employmentType: "AZUBI", desiredDaysPerWeek: 5, azubi: azubiTerm },
  { id: "due", name: "Van Due Dang", workRole: "KITCHEN", startDate: "2026-07-01", fixedDaysOff: ["friday", "sunday"], targetMinutes: 10440, employmentType: "AZUBI", desiredDaysPerWeek: 5,
    azubi: { schoolDays: [], inSchoolTerm: false, monthlyHoursOutOfTerm: 174 } },
] as unknown as Employee[];

const ALL = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const withRules = employees.map((e) =>
  e.id === "qui"
    ? { ...e, preferredWindows: [
        { days: [...ALL], startMinutes: 12 * 60, endMinutes: 14 * 60 },
        { days: [...ALL], startMinutes: 18 * 60, endMinutes: 20 * 60 },
      ] }
    : e.id === "bianca"
      ? { ...e, shiftHours: { min: 2, max: 3 },
          preferredWindows: [{ days: [...ALL.slice(0, 5)], startMinutes: 10 * 60 + 30, endMinutes: 15 * 60 }] }
      : e,
) as Employee[];

const plan = (list: Employee[]) => {
  const emps = withMonthRoles(list, 2026, 9);
  const shifts = generateSchedule({
    year: 2026, month: 9, storeId: "thienlong", workHours, overrides: {}, employees: emps, holidayState: "BW",
  } as Parameters<typeof generateSchedule>[0]);
  const v = validateSchedule(emps, shifts, {
    year: 2026, month: 9, workHours, holidayState: "BW", storeId: "thienlong", overrides: {},
  } as never);
  return { emps, shifts, v };
};
/** Anteil der Arbeitsminuten innerhalb der Wunschfenster. */
const insideShare = (e: Employee, shifts: Shift[]) => {
  let all = 0;
  let outside = 0;
  for (const s of shifts.filter((x) => x.employeeId === e.id)) {
    const segs = s.segments ?? [s];
    all += segs.reduce((a, g) => a + g.endMinutes - g.startMinutes, 0);
    outside += minutesOutsidePreferred(e, weekdayKeyOf(parseIsoDate(s.date)), segs);
  }
  return all > 0 ? 1 - outside / all : 0;
};

describe("Luật riêng: Khung giờ ưu tiên + Độ dài ca (weich)", () => {
  const without = plan(employees);
  const withR = plan(withRules);
  const byId = (id: string) => withRules.find((e) => e.id === id)!;

  it("bricht keine harte Regel und hält jedes Monatssoll", () => {
    expect(withR.v.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    for (const e of withR.emps) {
      const paid = withR.shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + s.paidMinutes, 0);
      if (e.employmentType !== "AZUBI") expect(paid, e.name).toBe(e.targetMinutes);
    }
    expect(withR.v.errors.length).toBe(without.v.errors.length);
  });

  it("Bianca: nur kurze Einsätze 2–3 h", () => {
    const mine = withR.shifts.filter((s) => s.employeeId === "bianca");
    expect(mine.length).toBeGreaterThan(0);
    for (const s of mine) {
      expect(s.paidMinutes, s.date).toBeGreaterThanOrEqual(120);
      expect(s.paidMinutes, s.date).toBeLessThanOrEqual(180);
    }
  });

  it("legt mehr Arbeitszeit in die Wunschfenster als ohne Einstellung", () => {
    for (const id of ["qui", "bianca"]) {
      expect(insideShare(byId(id), withR.shifts), id).toBeGreaterThan(insideShare(byId(id), without.shifts) + 0.1);
    }
    // Bianca überwiegend T2–T6 mittags.
    expect(insideShare(byId("bianca"), withR.shifts)).toBeGreaterThanOrEqual(0.5);
  });
});

describe("Luật riêng: Rải đều trong tháng (weich)", () => {
  const spread = withRules.map((e) => (e.id === "bianca" ? { ...e, spreadEvenly: true } : e));
  const r = plan(spread);
  const mine = r.shifts.filter((s) => s.employeeId === "bianca");
  const perWeek = (list: Shift[]) => {
    const m = new Map<number, number>();
    for (const s of list) {
      const w = Math.floor((Number(s.date.slice(8)) - 1 + 1) / 7); // Mo-basierte Wochen im Sept 2026
      m.set(w, (m.get(w) ?? 0) + 1);
    }
    return [0, 1, 2, 3, 4].map((w) => m.get(w) ?? 0);
  };

  it("bricht keine harte Regel, Monatssoll exakt, Einsätze 2–3 h", () => {
    expect(r.v.errors.filter((e) => e.severity !== "warning")).toEqual([]);
    expect(mine.reduce((a, s) => a + s.paidMinutes, 0)).toBe(20 * 60);
    for (const s of mine) expect(s.paidMinutes).toBeLessThanOrEqual(180);
  });

  it("jede Woche des Monats hat Einsätze, keine Woche mehr als 3", () => {
    const counts = perWeek(mine);
    expect(counts.every((c) => c >= 1), counts.join(",")).toBe(true);
    expect(Math.max(...counts), counts.join(",")).toBeLessThanOrEqual(3);
  });

  it("bleibt auf den Wunschtagen T2–T6", () => {
    for (const s of mine) expect(["monday", "tuesday", "wednesday", "thursday", "friday"]).toContain(weekdayKeyOf(parseIsoDate(s.date)));
  });
});

describe("preferredWindows helpers", () => {
  const e = withRules.find((x) => x.id === "bianca")!;
  it("zählt Minuten außerhalb; Tage ohne Fenster zählen ganz", () => {
    expect(minutesOutsidePreferred(e, "monday", [{ startMinutes: 630, endMinutes: 810 }])).toBe(0);
    expect(minutesOutsidePreferred(e, "monday", [{ startMinutes: 840, endMinutes: 960 }])).toBe(60);
    expect(minutesOutsidePreferred(e, "sunday", [{ startMinutes: 630, endMinutes: 810 }])).toBe(180);
    expect(minutesOutsidePreferred(employees[0], "sunday", [{ startMinutes: 630, endMinutes: 810 }])).toBe(0);
  });
  it("beschreibt Fenster kurz", () => {
    expect(describePreferredWindow(e.preferredWindows![0])).toBe("T2–T6 10:30–15:00");
    expect(describePreferredWindow({ days: [...ALL], startMinutes: 720, endMinutes: 840 })).toBe("Cả tuần 12:00–14:00");
  });
});
