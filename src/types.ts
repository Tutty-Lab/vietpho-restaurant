// ============================================================================
// Zentrale Datentypen. Intern wird IMMER in Minuten (Integer) gerechnet,
// niemals mit Fließkomma-Stunden.
// ============================================================================

import type { DateOverride, WorkHoursConfig } from "./lib/workHours";
import type { HolidayState } from "./lib/holidays";

export type EmploymentType = "VOLLZEIT" | "TEILZEIT" | "AZUBI";

/** Fester Einsatzbereich einer Thienlong-Mitarbeiterin bzw. eines Mitarbeiters. */
export type WorkRole = "KITCHEN" | "SERVICE";

/** Prozentsaetze fuer die zusaetzliche Verguetung bestimmter Arbeitszeiten. */
export type SurchargeConfig = {
  after20Percent: number;
  sundayPercent: number;
};

/** Wochentag-Schlüssel (Duplikat von lib/demand, um Zyklen zu vermeiden). */
export type WeekdayName =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** Einstellungen fuer Auszubildende innerhalb und ausserhalb der Schulzeit. */
export type AzubiConfig = {
  /** true = fuer diesen Azubi ist eine Berufsschulzeit hinterlegt. */
  inSchoolTerm: boolean;
  /** Inklusiver Beginn der Berufsschulzeit (ISO yyyy-MM-dd). */
  schoolTermStart?: string;
  /** Inklusives Ende der Berufsschulzeit (ISO yyyy-MM-dd). */
  schoolTermEnd?: string;
  /** @deprecated Altdaten; Schultage beeinflussen die Planung nicht mehr. */
  schoolDays: WeekdayName[];
  /** Vom Chef gesetztes Monatssoll ausserhalb der Schulzeit. */
  monthlyHoursOutOfTerm?: number;
  /** Exaktes Monatssoll fuer gemischte Schul-/Arbeitsmonate, Schluessel yyyy-MM. */
  monthlyHoursByMonth?: Record<string, number>;
  /**
   * Abweichendes Monatssoll für einzelne ARBEITSmonate (yyyy-MM), z.B. wenn
   * die Wochendecke im Monat nur 168 h zulässt. Getrennt von
   * monthlyHoursByMonth, damit alte Schulmonats-Werte nie in Arbeitsmonate rutschen.
   */
  workMonthHoursByMonth?: Record<string, number>;
  /** @deprecated Altdaten; werden beim Laden migriert. */
  weeklyHoursInTerm?: number;
  /** @deprecated Altdaten; werden beim Laden auf Monatsstunden umgerechnet. */
  weeklyHoursOutOfTerm?: number;
};

/** In der Schulzeit wird der Azubi nicht zur Arbeit eingeteilt. */
export const AZUBI_HOURS_IN_TERM = 0;
/** Woechentliche Obergrenze fuer Azubis ausserhalb der Schulzeit (Chef, Sept 2026: 40 h). */
export const AZUBI_HOURS_OUT_OF_TERM = 40;
/** Keine Reserve mehr: 40 h/Woche ist die harte Grenze. */
export const AZUBI_WEEKLY_TARGET_FLEX_HOURS = 0;
/** Ab diesem Monatssoll wird gewarnt, die Eingabe bleibt aber wirksam. */
export const AZUBI_MONTHLY_WARNING_HOURS = 174;

export type ShiftType = "EARLY" | "LATE" | "CUSTOM";

/**
 * „Khung giờ ưu tiên": Wunsch-Zeitfenster einer Person an bestimmten
 * Wochentagen (z.B. T2–T6 10:30–15:00). WEICHE Regel – der Planer legt Tage
 * und Stücke möglichst dort hin, bricht dafür aber keine harte Regel.
 */
export type PreferredWindow = {
  days: WeekdayName[];
  startMinutes: number;
  endMinutes: number;
};

export type Employee = {
  id: string;
  name: string;
  employmentType: EmploymentType;
  /**
   * Wirksames Monatssoll in Minuten (Integer). 176 h => 10560. Bei Ein-/Austritt
   * im Monat anteilig gekürzt (siehe employmentPeriod.ts).
   */
  targetMinutes: number;
  /** Eingetragenes Voll-Monatssoll, nur gesetzt, solange targetMinutes gekürzt ist. */
  baseTargetMinutes?: number;
  /** Ngày vào làm (yyyy-MM-dd, inklusiv). Davor wird nicht eingeplant. */
  startDate?: string;
  /** Ngày nghỉ việc = letzter Arbeitstag (yyyy-MM-dd, inklusiv). Danach nicht mehr. */
  endDate?: string;
  /** Nur bei employmentType === "AZUBI" gesetzt. */
  azubi?: AzubiConfig;
  /** Bếp (KITCHEN) oder Bồi (SERVICE), wenn die Person fest zugeordnet ist. */
  workRole?: WorkRole;
  /**
   * „Làm được cả Bếp và Bồi": die Person kann für einen ganzen Monat in die
   * andere Rolle wechseln (z. B. Azubi-Bồi in der Schule → ein Koch macht den
   * Monat Service). Nur dann ist roleByMonth wirksam.
   */
  canSwitchRole?: boolean;
  /** Rolle für einzelne Monate (Schlüssel yyyy-MM), sonst workRole. */
  roleByMonth?: Record<string, WorkRole>;
  /**
   * „Chỉ làm các ngày": HARTE Regel – nur an diesen Wochentagen einplanen
   * (z. B. jemand, der nur an seinem freien Tag bei der anderen Filiale kommt).
   * Leer/fehlend = alle Tage.
   */
  workDays?: WeekdayName[];
  /** Feste Ruhetage der jeweiligen Filiale; dort darf keine Schicht liegen. */
  fixedDaysOff?: WeekdayName[];
  /**
   * Gewünschte Arbeitstage pro Woche (1..7). Ist der Wert gesetzt, verteilt der
   * Planer die Monatsstunden möglichst genau auf so viele Tage je Woche. Passt
   * das Soll nicht sauber auf N Tage, darf um einen Tag abgewichen werden
   * (±1), damit die Schichtlängen sinnvoll bleiben. Fehlt der Wert, entscheidet
   * wie bisher die Nachfrage über die Tageszahl.
   */
  desiredDaysPerWeek?: number;
  /**
   * Khung giờ ưu tiên (weich). Ist mindestens ein Fenster gesetzt, bevorzugt
   * der Planer die dort genannten Wochentage und legt die Arbeitszeit in die
   * Fenster; Minuten außerhalb kosten einen Aufschlag.
   */
  preferredWindows?: PreferredWindow[];
  /**
   * „Độ dài ca": eigene Schichtlänge in Stunden (z.B. 2–3 h). Ohne Angabe gilt
   * die Standardlänge der Anstellungsart.
   */
  shiftHours?: { min: number; max: number };
  /**
   * „Rải đều trong tháng" (weich): Einsätze möglichst gleichmäßig auf die
   * Wochen verteilen statt sie dort zu bündeln, wo die Rolle gerade knapp ist.
   * Mit „Độ dài ca" werden dafür lieber mehr, dafür kürzere Einsätze geplant.
   */
  spreadEvenly?: boolean;
  /**
   * Häkchen „Lưu" in der Mitarbeiterliste: vom Nutzer gesetzte Bestätigung,
   * dass die Daten dieser Person geprüft und übernommen sind. Rein als Merker
   * gedacht – auf die Planung hat das Feld keinen Einfluss.
   */
  saved?: boolean;
};

/** Ein zusammenhängendes Stück Arbeitszeit. */
export type ShiftSegment = { startMinutes: number; endMinutes: number };

export type Shift = {
  id: string;
  employeeId: string;
  /** ISO-Datum "yyyy-MM-dd". */
  date: string;
  /** Beginn des ERSTEN Stücks. */
  startMinutes: number;
  /** Ende des LETZTEN Stücks. */
  endMinutes: number;
  pauseMinutes: number;
  /**
   * Geteilter Dienst: zwei Stücke, dazwischen ist der Laden zu (Mo–Do
   * 15:00–16:30). Fehlt das Feld, ist es ein durchgehender Dienst.
   * Bei geteiltem Dienst gibt es KEINE gerechnete Pause – die Lücke ist
   * die Ruhezeit.
   */
  segments?: ShiftSegment[];
  /** Bezahlte Arbeitszeit in Minuten = Summe der Stücke. */
  paidMinutes: number;
  shiftType: ShiftType;
  /** true = automatisch generiert, false = manuell hinzugefügt/geändert. */
  generated: boolean;
};

export type Schedule = {
  companyName: string;
  /**
   * Version der zuletzt übernommenen Öffnungszeiten-Vorgabe.
   * Ist sie älter als WORK_HOURS_VERSION, werden die Zeiten einmalig neu
   * aus DEFAULT_WORK_HOURS gesetzt.
   */
  hoursVersion?: number;
  /** Bundesland der Filiale – bestimmt die gesetzlichen Feiertage. */
  holidayState: HolidayState;
  /** Anschrift des Betriebs (erscheint auf dem Stundenzettel). */
  address: string;
  year: number;
  /** 1-basiert: 1 = Januar ... 12 = Dezember. */
  month: number;
  /** Arbeitszeit-Fenster (giờ làm) je Wochentag + Feiertag. */
  workHours: WorkHoursConfig;
  /** Zuschlaege fuer den aktiven Store; optional, damit alte Speicherstaende lesbar bleiben. */
  surchargeConfig?: SurchargeConfig;
  /** Ausnahmen für einzelne Daten (geschlossen / abweichende Zeiten). */
  dateOverrides: DateOverride[];
  employees: Employee[];
  shifts: Shift[];
  /**
   * Gespeicherte Pläne ANDERER Monate, Schlüssel "yyyy-MM". Beim Monatswechsel
   * wird der aktuelle Plan hier abgelegt und der des Zielmonats (falls
   * vorhanden) wieder geladen – so geht kein erzeugter Monat verloren.
   */
  archive?: Record<string, MonthArchive>;
};

/** Ein gespeicherter Monatsplan. */
export type MonthArchive = {
  shifts: Shift[];
  /** Ursprünglich generierter Plan (für „Zurücksetzen"). */
  originalShifts: Shift[];
  /** ISO-Zeitpunkt der Ablage. */
  savedAt: string;
};

/** Ein einzelnes zu verplanendes Schicht-Token (Ergebnis von splitTargetHours). */
export type ShiftToken = {
  employeeId: string;
  paidMinutes: number;
};
