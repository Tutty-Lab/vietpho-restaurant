import type { Employee } from "../types";
import { conflictingWorkDays, hasRequiredFixedDaysOff } from "./fixedDaysOff";
import { azubiMonthMode, azubiMonthlyHoursOverride, azubiSchoolTermRange } from "./azubi";

export type ScheduleReadiness = {
  ready: boolean;
  issues: string[];
};

export function checkScheduleReadiness(
  employees: Employee[],
  options: {
    requireWorkRole?: boolean;
    requireFixedDaysOff?: boolean;
    storeId?: string;
    /** Geplanter Monat – für die Prüfung der Azubi-Monatseingabe. */
    year?: number;
    month?: number;
  } = {},
): ScheduleReadiness {
  const issues: string[] = [];
  for (const employee of employees) {
    if (conflictingWorkDays(employee).length) {
      issues.push(`${employee.name}: ngày nghỉ cố định trùng với ngày được làm. Sửa thông tin nhân viên trước khi tạo lịch.`);
    }
  }

  if (employees.length < 2) issues.push("Cần ít nhất 2 nhân viên.");
  if (employees.some((employee) => employee.name.trim().length === 0)) {
    issues.push("Mỗi nhân viên phải có tên.");
  }
  if (employees.some((employee) => employee.saved !== true)) {
    issues.push("Hãy xác nhận lưu thông tin của tất cả nhân viên.");
  }
  // Wer im ganzen Monat nicht beschäftigt ist (Ein-/Austritt), hat 0 h – das ist korrekt.
  const outOfPeriod = (employee: Employee) =>
    employee.baseTargetMinutes !== undefined && employee.targetMinutes === 0;
  if (
    employees.some(
      (employee) =>
        employee.employmentType !== "AZUBI" && employee.targetMinutes <= 0 && !outOfPeriod(employee),
    )
  ) {
    issues.push("Nhân viên thường phải có định mức lớn hơn 0 giờ.");
  }
  if (
    employees.some(
      (employee) =>
        employee.employmentType !== "AZUBI" &&
        employee.targetMinutes > 0 &&
        employee.targetMinutes < 3 * 60,
    )
  ) {
    issues.push("Nhân viên thường phải có định mức ít nhất 3 giờ.");
  }
  if (
    options.requireWorkRole &&
    employees.some((employee) => !employee.workRole)
  ) {
    issues.push("Hãy chọn vị trí Bếp hoặc Bồi cho tất cả nhân viên.");
  }
  if (
    options.requireFixedDaysOff &&
    employees.some(
      (employee) =>
        employee.employmentType === "VOLLZEIT" &&
        !(options.storeId === "vietpho" && employee.desiredDaysPerWeek === 7 && !employee.fixedDaysOff?.length) &&
        !hasRequiredFixedDaysOff(employee),
    )
  ) {
    issues.push("Vollzeit phải chọn đúng 1 ngày nghỉ cố định mỗi tuần.");
  }
  if (
    options.requireFixedDaysOff &&
    employees.some(
      (employee) =>
        employee.employmentType === "AZUBI" &&
        !hasRequiredFixedDaysOff(employee),
    )
  ) {
    issues.push("Azubi phải chọn đúng 2 ngày nghỉ cố định mỗi tuần.");
  }

  // Azubi-Stunden rechnet die App nicht selbst: Monat mit Schulbeginn/-ende
  // braucht eine Eingabe des Chefs (0 ist erlaubt).
  if (options.year !== undefined && options.month !== undefined) {
    const { year, month } = options;
    const missing = employees.filter(
      (employee) =>
        employee.employmentType === "AZUBI" &&
        azubiMonthMode(employee.azubi, year, month) === "mixed" &&
        azubiSchoolTermRange(employee.azubi) !== null &&
        azubiMonthlyHoursOverride(employee.azubi, year, month) === undefined,
    );
    if (missing.length > 0) {
      issues.push(
        `Tháng ${month}/${year} vừa học vừa làm – hãy nhập giờ làm tháng này ở mục Azubi (tab Nhân viên) cho: ${missing
          .map((employee) => employee.name)
          .join(", ")}.`,
      );
    }
  }

  return { ready: issues.length === 0, issues };
}
