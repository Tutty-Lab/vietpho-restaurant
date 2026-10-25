import type { Employee, EmploymentType, WeekdayName } from "../types";
import { parseIsoDate, weekdayKeyOf } from "./demand";

export const WEEKDAY_ORDER: readonly WeekdayName[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const WEEKDAYS = new Set<WeekdayName>(WEEKDAY_ORDER);

/** Empty workDays means unrestricted availability, not an explicit conflict. */
export function conflictingWorkDays(employee: Pick<Employee, "workDays" | "fixedDaysOff">): WeekdayName[] {
  if (!employee.workDays?.length) return [];
  return WEEKDAY_ORDER.filter((day) => employee.workDays!.includes(day) && employee.fixedDaysOff?.includes(day));
}

export function requiredFixedDaysOff(employmentType: EmploymentType): number {
  if (employmentType === "VOLLZEIT") return 1;
  if (employmentType === "AZUBI") return 2;
  return 0;
}

function fixedDaysOf(employee: Employee): WeekdayName[] {
  const source = Array.isArray(employee.fixedDaysOff) ? employee.fixedDaysOff : [];
  const valid = [...new Set(source)].filter(
    (weekday): weekday is WeekdayName => WEEKDAYS.has(weekday),
  );

  return valid;
}

export function normalizedFixedDaysOff(employee: Employee): Employee {
  const limit = requiredFixedDaysOff(employee.employmentType);
  if (limit === 0) {
    return employee.fixedDaysOff === undefined
      ? employee
      : { ...employee, fixedDaysOff: fixedDaysOf(employee) };
  }

  const normalized = fixedDaysOf(employee).slice(0, limit);
  const unchanged =
    Array.isArray(employee.fixedDaysOff) &&
    employee.fixedDaysOff.length === normalized.length &&
    employee.fixedDaysOff.every((weekday, index) => weekday === normalized[index]);

  return unchanged ? employee : { ...employee, fixedDaysOff: normalized };
}

export function hasRequiredFixedDaysOff(employee: Employee): boolean {
  const required = requiredFixedDaysOff(employee.employmentType);
  if (required === 0) return true;
  return fixedDaysOf(employee).length === required;
}

export function isEmployeeFixedDayOff(
  employee: Employee,
  isoDate: string,
): boolean {
  const weekday = weekdayKeyOf(parseIsoDate(isoDate)) as WeekdayName;

  return Array.isArray(employee.fixedDaysOff) && employee.fixedDaysOff.includes(weekday);
}
