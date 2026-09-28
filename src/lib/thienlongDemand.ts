import type { Shift, WorkRole } from "../types";
import type { WeekdayKey } from "./demand";

export type RoleDemandInterval = {
  startMinutes: number;
  endMinutes: number;
  /** Dynamisch aus dem Tages-Soll berechnete Personenminuten. */
  personMinutes: number;
};

export type RoleDemandShareInterval = {
  startMinutes: number;
  endMinutes: number;
  /** Anteil dieses Rollen-/Zeitblocks am gesamten Tages-Soll (0..1). */
  share: number;
};

export type ThienlongStaffingProfile = {
  /** Soft lower bound used to spread visits across the day. */
  minStaff: number;
  /** Hard upper bound for people assigned to one date. */
  maxStaff: number;
  /** Preferred paid-hour band for a quiet day. */
  minHours: number;
  maxHours: number;
};

type ReferenceInterval = {
  startMinutes: number;
  endMinutes: number;
  /** Nur die Ist-Stunden der Beispielwoche, niemals ein fixes Soll. */
  personHours: number;
};

type ReferenceProfile = Record<WorkRole, readonly ReferenceInterval[]>;

export const THIENLONG_REFERENCE_INVOICES = 150;

// Abendspitze laut Chef (Sept 2026): nicht schon ab 17:00. Mo–Do kommen die
// Gäste 18:00–20:30, Fr/Sa/So (und Feiertage) später – 18:00–21:00.
const LUNCH_PEAK = { startMinutes: 12 * 60, endMinutes: 14 * 60 } as const;
const EVENING_PEAK_WEEKDAY = { startMinutes: 18 * 60, endMinutes: 20 * 60 + 30 } as const;
const EVENING_PEAK_WEEKEND = { startMinutes: 18 * 60, endMinutes: 21 * 60 } as const;

function isLateEveningDay(weekday: WeekdayKey, isHoliday: boolean): boolean {
  return isHoliday || weekday === "friday" || weekday === "saturday" || weekday === "sunday";
}

function mealPeaksOf(weekday: WeekdayKey, isHoliday: boolean) {
  return [
    LUNCH_PEAK,
    isLateEveningDay(weekday, isHoliday) ? EVENING_PEAK_WEEKEND : EVENING_PEAK_WEEKDAY,
  ] as const;
}

// Anteil der Tagesstunden je Spitze (weiche Platzierungspriorität). Der Abend
// (Index 1) wiegt bewusst SCHWERER als der Mittag (Index 0) – das Abendgeschäft
// ist stärker, also sollen dort mehr Bếp/Bồi liegen als mittags.
const MEAL_PEAK_SHARES = [0.22, 0.42] as const; // [Mittag, Abend]

const referenceInterval = (
  startMinutes: number,
  endMinutes: number,
  personHours: number,
): ReferenceInterval => ({
  startMinutes,
  endMinutes,
  personHours,
});

// Die Zahlen sind reine RELATIVE Gewichte (dimensionslos, werden zu Anteilen
// normiert). Sie bestimmen nur die FORM des Tages – wie viele echte Leute
// daraus werden, ergibt sich aus dem tatsächlichen Team und seinen Stunden.
//
// Stoßzeiten laut Chef (Sept 2026): Mittag 11:00–14:00, Abend Mo–Do
// 18:00–20:30, Fr/Sa/So 18:00–21:00. Tagessummen je Rolle bleiben gleich.
// 17:00–18:00 ist nur Anlauf (dünn), nicht mehr Teil der Spitze.
//
// Mo–Do: Blocks 10:30–15:00 + 16:30–22:00. Öffnung/Schluss dünn.
const WEEKDAY: ReferenceProfile = {
  KITCHEN: [
    referenceInterval(10 * 60 + 30, 11 * 60, 0.5), // Öffnung: dünn
    referenceInterval(11 * 60, 14 * 60, 9), // Mittag: Spitze
    referenceInterval(14 * 60, 15 * 60, 1.5),
    referenceInterval(16 * 60 + 30, 18 * 60, 1.5), // Anlauf
    referenceInterval(18 * 60, 20 * 60 + 30, 9), // Abend: Spitze
    referenceInterval(20 * 60 + 30, 22 * 60, 2.5), // Schließung: dünn
  ],
  SERVICE: [
    referenceInterval(10 * 60 + 30, 11 * 60, 0.25),
    referenceInterval(11 * 60, 14 * 60, 5.25),
    referenceInterval(14 * 60, 15 * 60, 0.75),
    referenceInterval(16 * 60 + 30, 18 * 60, 1),
    referenceInterval(18 * 60, 20 * 60 + 30, 5.5),
    referenceInterval(20 * 60 + 30, 22 * 60, 1.25),
  ],
};

// Freitag: ein Block 10:30–22:00, Abend am stärksten.
const FRIDAY: ReferenceProfile = {
  KITCHEN: [
    referenceInterval(10 * 60 + 30, 11 * 60, 0.5),
    referenceInterval(11 * 60, 14 * 60, 7),
    referenceInterval(14 * 60, 17 * 60, 2.5),
    referenceInterval(17 * 60, 18 * 60, 1.5),
    referenceInterval(18 * 60, 21 * 60, 10.5), // Spitze
    referenceInterval(21 * 60, 22 * 60, 2),
  ],
  SERVICE: [
    referenceInterval(10 * 60 + 30, 11 * 60, 0.25),
    referenceInterval(11 * 60, 14 * 60, 4),
    referenceInterval(14 * 60, 17 * 60, 1.5),
    referenceInterval(17 * 60, 18 * 60, 1),
    referenceInterval(18 * 60, 21 * 60, 5.75),
    referenceInterval(21 * 60, 22 * 60, 1.5),
  ],
};

// Sa/So: ein Block 11:30–22:00 (Personal ab 11:30) – Mittag daher 11:30–14:00.
const WEEKEND: ReferenceProfile = {
  KITCHEN: [
    referenceInterval(11 * 60 + 30, 14 * 60, 9.5), // Mittag: dicht
    referenceInterval(14 * 60, 17 * 60, 3),
    referenceInterval(17 * 60, 18 * 60, 1.5),
    referenceInterval(18 * 60, 21 * 60, 10.5), // Abend: am dichtesten (> Mittag)
    referenceInterval(21 * 60, 22 * 60, 1.5),
  ],
  SERVICE: [
    referenceInterval(11 * 60 + 30, 14 * 60, 5.5),
    referenceInterval(14 * 60, 17 * 60, 2),
    referenceInterval(17 * 60, 18 * 60, 1),
    referenceInterval(18 * 60, 21 * 60, 6), // Abend: mehr Bồi als mittags
    referenceInterval(21 * 60, 22 * 60, 1.5),
  ],
};

function referenceProfileOf(weekday: WeekdayKey, isHoliday: boolean): ReferenceProfile {
  if (isHoliday || weekday === "saturday" || weekday === "sunday") return WEEKEND;
  if (weekday === "friday") return FRIDAY;
  return WEEKDAY;
}

function referenceTotalHours(profile: ReferenceProfile): number {
  return (["KITCHEN", "SERVICE"] as const).reduce(
    (total, role) =>
      total + profile[role].reduce((roleTotal, item) => roleTotal + item.personHours, 0),
    0,
  );
}

/** Die Beispielwoche wird ausschließlich in dimensionslose Anteile umgerechnet. */
export function thienlongDemandShares(
  weekday: WeekdayKey,
  role: WorkRole,
  isHoliday = false,
): readonly RoleDemandShareInterval[] {
  const profile = referenceProfileOf(weekday, isHoliday);
  const totalHours = referenceTotalHours(profile);
  return profile[role].map((item) => ({
    startMinutes: item.startMinutes,
    endMinutes: item.endMinutes,
    share: totalHours > 0 ? item.personHours / totalHours : 0,
  }));
}

export function thienlongRoleShare(
  weekday: WeekdayKey,
  role: WorkRole,
  isHoliday = false,
): number {
  return thienlongDemandShares(weekday, role, isHoliday).reduce(
    (total, demand) => total + demand.share,
    0,
  );
}

/** Stoßzeiten [Mittag, Abend] eines Tages – der Abend hängt vom Wochentag ab. */
export function thienlongMealPeakIntervals(
  weekday: WeekdayKey,
  isHoliday = false,
): readonly {
  startMinutes: number;
  endMinutes: number;
}[] {
  return mealPeaksOf(weekday, isHoliday).map((peak) => ({ ...peak }));
}

/**
 * Monatswechsel (Wunsch Chef, Sept 2026): der letzte Tag des Monats und der
 * 1.–3. sind etwas voller als ein normaler Wochentag. Nur WEICH – etwas mehr
 * Gewicht, kein Samstag-Niveau und keine Mindestbesetzung.
 */
export function isThienlongMonthRushDate(isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  const day = Number(isoDate.slice(8, 10));
  const lastDay = new Date(year, month, 0).getDate();
  return day <= 3 || day === lastDay;
}

export type MinStaffWindow = { startMinutes: number; endMinutes: number; minStaff: number };

/**
 * Harte Mindestbesetzung je Rolle an Fr/Sa/So (Wunsch Chef, Sept 2026):
 * - 14:00–17:00 mindestens 3 Bếp und 1 Bồi,
 * - 20:00–22:00 mindestens 2 Bếp und 1 Bồi.
 */
export function thienlongMinStaffWindows(
  weekday: WeekdayKey,
  role: WorkRole,
): readonly MinStaffWindow[] {
  if (weekday !== "friday" && weekday !== "saturday" && weekday !== "sunday") return [];
  const kitchen = role === "KITCHEN";
  return [
    { startMinutes: 14 * 60, endMinutes: 17 * 60, minStaff: kitchen ? 3 : 1 },
    { startMinutes: 20 * 60, endMinutes: 22 * 60, minStaff: kitchen ? 2 : 1 },
  ];
}

/** Extra soft demand used to keep longer shifts around lunch and dinner. */
export function thienlongMealPeakDemand(
  weekday: WeekdayKey,
  role: WorkRole,
  totalTargetMinutes: number,
  isHoliday = false,
): readonly RoleDemandInterval[] {
  const roleMinutes =
    Math.max(0, totalTargetMinutes) * thienlongRoleShare(weekday, role, isHoliday);
  return mealPeaksOf(weekday, isHoliday).map((peak, i) => ({
    ...peak,
    personMinutes: roleMinutes * MEAL_PEAK_SHARES[i],
  }));
}

/** Skaliert die aus der Beispielwoche abgeleiteten Anteile auf das Tages-Soll. */
export function thienlongDemandIntervals(
  weekday: WeekdayKey,
  role: WorkRole,
  totalTargetMinutes: number,
  isHoliday = false,
): readonly RoleDemandInterval[] {
  return thienlongDemandShares(weekday, role, isHoliday).map((item) => ({
    startMinutes: item.startMinutes,
    endMinutes: item.endMinutes,
    personMinutes: Math.max(0, totalTargetMinutes) * item.share,
  }));
}

/** Mo-Do are the base; Friday/Saturday are busiest, Sunday is moderately busier. */
export function thienlongDemandWeight(weekday: WeekdayKey, isHoliday = false): number {
  if (isHoliday) return 1.35;
  if (weekday === "friday" || weekday === "saturday") return 1.35;
  // Chủ nhật ~55 h statt ~59 h (Wunsch Chef, Sept 2026).
  if (weekday === "sunday") return 1.1;
  return 1;
}

/** Gewicht der Monatswechsel-Tage: über Mo–Do (1,0), unter Fr/Sa (1,35). */
export const THIENLONG_MONTH_RUSH_WEIGHT = 1.15;

/** Tagesgewicht für ein konkretes Datum (Wochentag, Feiertag, Monatswechsel). */
export function thienlongDateWeight(isoDate: string, isHoliday = false): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  const weekday = WEEKDAY_KEYS_BY_JS_DAY[new Date(y, m - 1, d).getDay()];
  const base = thienlongDemandWeight(weekday, isHoliday);
  return isThienlongMonthRushDate(isoDate) ? Math.max(base, THIENLONG_MONTH_RUSH_WEIGHT) : base;
}

const WEEKDAY_KEYS_BY_JS_DAY: readonly WeekdayKey[] = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

/**
 * Personal-Bandbreite je Tag: nur noch relative KÖPFE-Grenzen zum Verteilen der
 * Besuche (Wochenende darf mehr Leute haben als ein ruhiger Wochentag). Es gibt
 * KEINE fest verdrahtete Stundenzahl mehr (früher 55–60 h Mo–Do) – die Stunden
 * ergeben sich rein proportional aus den Nachfrage-Gewichten und dem Team.
 */
export function thienlongStaffingProfile(
  weekday: WeekdayKey,
  isHoliday = false,
): ThienlongStaffingProfile {
  const band = { minHours: 0, maxHours: Number.POSITIVE_INFINITY };
  if (isHoliday || weekday === "friday" || weekday === "saturday") {
    return { minStaff: 7, maxStaff: 8, ...band };
  }
  if (weekday === "sunday") {
    // Sonntag ist ein starker Tag (Gewicht 1,1). Mit einem Kopf-Untergrenze von
    // 7 (wie Fr/Sa) zieht die Planung genug Leute auf den Sonntag, damit er
    // wirklich MEHR Stunden bekommt als ein Wochentag – nicht gleich viel.
    return { minStaff: 7, maxStaff: 8, ...band };
  }
  return { minStaff: 6, maxStaff: 7, ...band };
}

export function thienlongLateShiftRatio(weekday: WeekdayKey, isHoliday = false): number {
  if (isHoliday || weekday === "friday" || weekday === "saturday") return 0.78;
  if (weekday === "sunday") return 0.6;
  return 23 / 41.5;
}

function overlapMinutes(
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): number {
  return Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
}

/** Beschränkt ein Nachfrageprofil auf die tatsächlich planbaren Tagesblöcke. */
export function clipDemandIntervals(
  demandIntervals: readonly RoleDemandInterval[],
  blocks: readonly { startMinutes: number; endMinutes: number }[],
): RoleDemandInterval[] {
  return demandIntervals.flatMap((demand) => {
    const duration = demand.endMinutes - demand.startMinutes;
    if (duration <= 0) return [];
    return blocks.flatMap((block) => {
      const startMinutes = Math.max(demand.startMinutes, block.startMinutes);
      const endMinutes = Math.min(demand.endMinutes, block.endMinutes);
      if (endMinutes <= startMinutes) return [];
      return [{
        startMinutes,
        endMinutes,
        personMinutes: demand.personMinutes * ((endMinutes - startMinutes) / duration),
      }];
    });
  });
}

function shiftOverlapWithInterval(shift: Shift, demand: RoleDemandInterval): number {
  const segments = shift.segments ?? [
    { startMinutes: shift.startMinutes, endMinutes: shift.endMinutes },
  ];
  const presenceMinutes = segments.reduce(
    (total, segment) => total + segment.endMinutes - segment.startMinutes,
    0,
  );
  if (presenceMinutes <= 0) return 0;

  const presenceOverlap = segments.reduce(
    (total, segment) =>
      total +
      overlapMinutes(
        segment.startMinutes,
        segment.endMinutes,
        demand.startMinutes,
        demand.endMinutes,
      ),
    0,
  );

  // Durchgehende lange Dienste enthalten eine nicht lokalisierte Pause. Sie
  // wird proportional abgezogen, damit eine 8h-Schicht nicht 9h Bedarf deckt.
  return presenceOverlap * Math.min(1, shift.paidMinutes / presenceMinutes);
}

/** Zusätzliche ungedeckte Personenminuten, die eine Kandidatenschicht füllt. */
export function demandCoverageGain(
  candidate: Shift,
  existingRoleShifts: readonly Shift[],
  demandIntervals: readonly RoleDemandInterval[],
): number {
  return demandIntervals.reduce((total, demand) => {
    const covered = existingRoleShifts.reduce(
      (sum, shift) => sum + shiftOverlapWithInterval(shift, demand),
      0,
    );
    const uncovered = Math.max(0, demand.personMinutes - covered);
    return total + Math.min(uncovered, shiftOverlapWithInterval(candidate, demand));
  }, 0);
}

/** Tatsächlich gedeckte Personenminuten, gedeckelt auf den Sollwert je Intervall. */
export function demandCoveredMinutes(
  roleShifts: readonly Shift[],
  demandIntervals: readonly RoleDemandInterval[],
): number {
  return demandIntervals.reduce((total, demand) => {
    const covered = roleShifts.reduce(
      (sum, shift) => sum + shiftOverlapWithInterval(shift, demand),
      0,
    );
    return total + Math.min(demand.personMinutes, covered);
  }, 0);
}

/** Noch ungedeckte Personenminuten eines Rollenprofils. */
export function demandCoverageGap(
  roleShifts: readonly Shift[],
  demandIntervals: readonly RoleDemandInterval[],
): number {
  return demandIntervals.reduce((total, demand) => {
    const covered = roleShifts.reduce(
      (sum, shift) => sum + shiftOverlapWithInterval(shift, demand),
      0,
    );
    return total + Math.max(0, demand.personMinutes - covered);
  }, 0);
}
