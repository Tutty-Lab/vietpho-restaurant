// Ob ein Mitarbeiter an einem Tag überhaupt eingeplant werden darf – unabhängig
// von festen Ruhetagen: Ein-/Austritt und (Azubi) Berufsschulzeit.

import type { Employee } from "../types";
import { isAzubiBlockedSchoolDate } from "./azubi";
import { inactiveReason } from "./employmentPeriod";
import { parseIsoDate, weekdayKeyOf } from "./demand";

/** Grund, warum an diesem Tag keine Schicht möglich ist (oder null). */
export function unavailableReason(employee: Employee, isoDate: string): string | null {
  const inactive = inactiveReason(employee, isoDate);
  if (inactive) return inactive;
  // In der Schulzeit arbeitet ein Azubi nie (Wunsch Chef, Sept 2026).
  if (employee.employmentType === "AZUBI" && isAzubiBlockedSchoolDate(employee.azubi, isoDate)) {
    return "Đi học";
  }
  if (employee.workDays && employee.workDays.length > 0) {
    const weekday = weekdayKeyOf(parseIsoDate(isoDate)) as (typeof employee.workDays)[number];
    if (!employee.workDays.includes(weekday)) return "Không làm ngày này";
  }
  return null;
}

export function isEmployeeAvailableOn(employee: Employee, isoDate: string): boolean {
  return unavailableReason(employee, isoDate) === null;
}
