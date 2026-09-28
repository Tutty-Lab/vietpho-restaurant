// ============================================================================
// Validierung des Dienstplans gegen alle geforderten Regeln.
// ============================================================================

import {
  AZUBI_HOURS_OUT_OF_TERM,
  AZUBI_WEEKLY_TARGET_FLEX_HOURS,
  type Employee,
  type Shift,
  type WorkRole,
} from "../types";
import { calculatePause, minutesToTime } from "./time";
import { maxConsecutiveRun } from "./consecutive";
import { datesOfMonth, parseIsoDate, weekdayKeyOf } from "./demand";
import { holidaysOf, type HolidayState } from "./holidays";
import { resolveDay, type OverrideMap, type WorkHoursConfig } from "./workHours";
import { vietphoPeakIntervals } from "./vietphoDemand";
import { isEmployeeFixedDayOff } from "./fixedDaysOff";
import { unavailableReason } from "./availability";
import { azubiMonthCapacityBreakdown, type AzubiWeekCapacity } from "./scheduler";
import { ROLES, dayRoleIssues, roleCountAt, roleLabel } from "./roleCoverage";

export type ValidationErrorKind = "coverage" | "hours" | "shift" | "rule";

export type ValidationError = {
  employeeId?: string;
  date?: string;
  /** Kurz: was ist falsch. */
  message: string;
  /** Gruppe in der Anzeige (Thiếu người / Giờ định mức / Ca / Luật). */
  kind?: ValidationErrorKind;
  /** "warning" = nur Hinweis (z. B. Soll wegen 40-h-Woche nicht ganz erreichbar). */
  severity?: "warning";
  /** Warum das passiert. */
  reason?: string;
  /** Wie man es anders planen kann. */
  suggestion?: string;
};

export type EmployeeSummary = {
  employee: Employee;
  assignedMinutes: number;
  targetMinutes: number;
  diffMinutes: number; // assigned - target
  maxConsecutiveDays: number;
  shiftCount: number;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
  summaries: EmployeeSummary[];
};

export type ValidationContext = {
  year: number;
  month: number;
  workHours: WorkHoursConfig;
  holidayState: HolidayState;
  storeId?: string;
  overrides?: OverrideMap;
};

const MAX_PAID_MINUTES = 10 * 60; // ArbZG §3: bis 10 h zulässig
const MAX_CONSECUTIVE_DAYS = 6;

function weekKeyOf(isoDate: string): string {
  const date = parseIsoDate(isoDate);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function validateSchedule(
  employees: Employee[],
  shifts: Shift[],
  context?: ValidationContext,
): ValidationResult {
  const errors: ValidationError[] = [];
  const shiftsByEmployee = new Map<string, Shift[]>();
  for (const emp of employees) shiftsByEmployee.set(emp.id, []);
  for (const shift of shifts) {
    if (!shiftsByEmployee.has(shift.employeeId)) {
      shiftsByEmployee.set(shift.employeeId, []);
    }
    shiftsByEmployee.get(shift.employeeId)!.push(shift);
  }

  // Regeln je einzelner Schicht.
  for (const shift of shifts) {
    // Geteilter Dienst (zwei Stücke): bezahlte Zeit = Summe der Stücke, und
    // es gibt keine gerechnete Pause – die Ladenschließung ist die Ruhezeit.
    const isSplit = Array.isArray(shift.segments) && shift.segments.length > 1;
    const expectedPaid = isSplit
      ? shift.segments!.reduce((a, s) => a + (s.endMinutes - s.startMinutes), 0)
      : shift.endMinutes - shift.startMinutes - shift.pauseMinutes;
    const expectedPause = isSplit ? 0 : calculatePause(shift.paidMinutes);

    if (shift.endMinutes <= shift.startMinutes) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ ra không sau giờ vào (${shift.date}).`,
        kind: "shift",
        suggestion: "Mở ca này và sửa giờ vào/ra.",
      });
    }
    if (shift.paidMinutes > MAX_PAID_MINUTES) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Quá ${MAX_PAID_MINUTES / 60} giờ công ngày ${shift.date}.`,
        kind: "shift",
        reason: "Luật lao động Đức: tối đa 10 giờ công mỗi ngày.",
        suggestion: "Rút ngắn ca, hoặc chuyển bớt giờ sang ngày khác của người này.",
      });
    }
    if (shift.paidMinutes !== expectedPaid) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Giờ công không khớp giờ vào/ra/nghỉ ngày ${shift.date}.`,
        kind: "shift",
        suggestion: "Mở ca này và bấm Lưu lại để tính lại giờ công.",
      });
    }
    if (shift.pauseMinutes !== expectedPause) {
      errors.push({
        employeeId: shift.employeeId,
        date: shift.date,
        message: `Sai giờ nghỉ ngày ${shift.date}: ${shift.pauseMinutes} thay vì ${expectedPause} phút.`,
        kind: "shift",
        reason: "Ca liền trên 6 giờ công nghỉ 30 phút, từ 8 giờ công trở lên nghỉ 60 phút.",
        suggestion: `Đặt nghỉ = ${expectedPause} phút, hoặc chia thành ca gãy (Ca 1 / Ca 2).`,
      });
    }
    // Ca tách đôi phải có quãng nghỉ thật ở giữa – hai đoạn sát nhau là ca liền
    // và khi đó cần Pause như ca liền.
    if (isSplit) {
      const segs = [...shift.segments!].sort((a, b) => a.startMinutes - b.startMinutes);
      for (let i = 1; i < segs.length; i++) {
        const gap = segs[i].startMinutes - segs[i - 1].endMinutes;
        if (gap >= 60) continue;
        const pause = calculatePause(shift.paidMinutes);
        errors.push({
          employeeId: shift.employeeId,
          date: shift.date,
          message:
            `Ca tách đôi ngày ${shift.date} (${segs.map((g) => `${minutesToTime(g.startMinutes)}–${minutesToTime(g.endMinutes)}`).join(" | ")}) ` +
            `chỉ nghỉ giữa ${gap} phút – thực chất là ca liền ${shift.paidMinutes / 60}h.`,
          kind: "shift",
          severity: "warning",
          reason: "Ca tách đôi không trừ Pause, nên hai đoạn phải cách nhau ít nhất 1 giờ.",
          suggestion:
            pause > 0
              ? `Để cách nhau ≥ 1 giờ, hoặc gộp thành một ca liền với nghỉ ${pause} phút.`
              : "Để cách nhau ≥ 1 giờ, hoặc gộp thành một ca liền.",
        });
        break;
      }
    }
  }

  const summaries: EmployeeSummary[] = [];

  for (const emp of employees) {
    const empShifts = shiftsByEmployee.get(emp.id) ?? [];

    // Höchstens ein Dienst pro Tag.
    const seenDates = new Set<string>();
    for (const shift of empShifts) {
      if (seenDates.has(shift.date)) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `Có nhiều hơn một ca ngày ${shift.date}.`,
          kind: "shift",
          suggestion: "Xoá một ca, hoặc gộp thành ca gãy (Ca 1 / Ca 2).",
        });
      }
      seenDates.add(shift.date);
      const inactive = unavailableReason(emp, shift.date);
      if (inactive) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `${emp.name}: ngày ${shift.date} ${inactive.toLowerCase()} (không được xếp ca).`,
          kind: "shift",
          suggestion: "Xoá ca này hoặc chuyển ca sang người khác (bấm vào ca).",
        });
      }
      if (isEmployeeFixedDayOff(emp, shift.date)) {
        errors.push({
          employeeId: emp.id,
          date: shift.date,
          message: `${emp.name}: ngày ${shift.date} là ngày nghỉ cố định.`,
          kind: "shift",
          suggestion: "Chuyển ca sang người khác, hoặc đổi ngày nghỉ cố định trong tab Nhân viên.",
        });
      }
    }

    const assignedMinutes = empShifts.reduce((sum, s) => sum + s.paidMinutes, 0);
    const maxRun = maxConsecutiveRun(empShifts.map((s) => s.date));

    if (emp.employmentType === "AZUBI") {
      const weeklyCapMinutes = Math.round(
        (AZUBI_HOURS_OUT_OF_TERM + AZUBI_WEEKLY_TARGET_FLEX_HOURS) * 60,
      );
      const minutesByWeek = new Map<string, number>();

      for (const shift of empShifts) {
        const weekKey = weekKeyOf(shift.date);
        minutesByWeek.set(weekKey, (minutesByWeek.get(weekKey) ?? 0) + shift.paidMinutes);
      }
      for (const [weekKey, minutes] of minutesByWeek) {
        if (minutes > weeklyCapMinutes) {
          errors.push({
            employeeId: emp.id,
            message: `${emp.name}: tuần ${weekKey} có ${minutes / 60}h, vượt mức ${weeklyCapMinutes / 60}h.`,
            kind: "hours",
            reason: `Azubi tối đa ${weeklyCapMinutes / 60}h mỗi tuần.`,
            suggestion: "Bớt giờ trong tuần đó, hoặc đặt giờ riêng tháng này thấp hơn (tab Nhân viên).",
          });
        }
      }
    }

    if (assignedMinutes !== emp.targetMinutes) {
      // Azubi: mehr Soll als die 40-h-Woche zulässt → kein Fehler, nur Hinweis.
      const breakdown =
        emp.employmentType === "AZUBI" && context
          ? azubiMonthCapacityBreakdown(emp, {
              year: context.year,
              month: context.month,
              workHours: context.workHours,
              overrides: context.overrides,
              holidayState: context.holidayState,
            })
          : null;
      const capacity = breakdown?.totalMinutes ?? null;
      const capped = capacity !== null && capacity < emp.targetMinutes && assignedMinutes <= emp.targetMinutes;
      errors.push({
        employeeId: emp.id,
        severity: "warning",
        message: capped
          ? `${emp.name}: xếp ${assignedMinutes / 60}h / ${emp.targetMinutes / 60}h – tháng này tối đa ${capacity! / 60}h.`
          : `${emp.name}: chưa đạt giờ định mức: ${assignedMinutes / 60} h thay vì ${emp.targetMinutes / 60} h.`,
        kind: "hours",
        reason: capped
          ? azubiCapacityReason(breakdown!, emp.targetMinutes)
          : assignedMinutes < emp.targetMinutes
            ? `Thiếu ${(emp.targetMinutes - assignedMinutes) / 60}h so với giờ tháng – thường do sửa/xoá ca bằng tay.`
            : `Thừa ${(assignedMinutes - emp.targetMinutes) / 60}h so với giờ tháng – thường do sửa/thêm ca bằng tay.`,
        suggestion: capped
          ? `Không cần làm gì – lịch vẫn dùng được. ${(emp.targetMinutes - assignedMinutes) / 60}h còn lại không xếp được trong tháng này.`
          : assignedMinutes < emp.targetMinutes
            ? "Kéo dài một vài ca của người này, hoặc bấm “+ Tạo lịch làm việc” để tạo lại."
            : "Rút ngắn một vài ca của người này, hoặc tạo lại lịch.",
      });
    }
    if (maxRun > MAX_CONSECUTIVE_DAYS) {
      errors.push({
        employeeId: emp.id,
        message: `${emp.name}: làm quá 6 ngày liên tiếp (${maxRun}).`,
        kind: "rule",
        reason: "Mỗi người cần ít nhất 1 ngày nghỉ sau 6 ngày làm liên tiếp.",
        suggestion: "Cho người này nghỉ 1 ngày trong chuỗi đó và chuyển ca sang người khác.",
      });
    }

    summaries.push({
      employee: emp,
      assignedMinutes,
      targetMinutes: emp.targetMinutes,
      diffMinutes: assignedMinutes - emp.targetMinutes,
      maxConsecutiveDays: maxRun,
      shiftCount: empShifts.length,
    });
  }

  if (context && shifts.length > 0) {
    const holidays = holidaysOf(context.year, context.holidayState);
    for (const date of datesOfMonth(context.year, context.month)) {
      const day = resolveDay(context.workHours, date, holidays, context.overrides);
      if (day.closed) continue;

      if (context.storeId === "vietpho") {
        for (const peak of vietphoPeakIntervals()) {
          const existsInWorkHours = day.blocks.some(
            (block) =>
              block.startMinutes <= peak.startMinutes && block.endMinutes >= peak.endMinutes,
          );
          if (!existsInWorkHours) continue;
          const coveringCount = shifts.filter((shift) => {
            if (shift.date !== date) return false;
            return (shift.segments ?? [shift]).some(
              (segment) =>
                segment.startMinutes <= peak.startMinutes && segment.endMinutes >= peak.endMinutes,
            );
          }).length;
          if (coveringCount < peak.minStaff) {
            errors.push({
              date,
              kind: "coverage",
              suggestion: "Dời một ca vào khung giờ cao điểm này hoặc kéo dài ca.",
              message:
                `Ngày ${date}: cần ít nhất ${peak.minStaff} nhân viên trong giờ cao điểm ` +
                `${minutesToTime(peak.startMinutes)}–${minutesToTime(peak.endMinutes)} ` +
                `(hiện có ${coveringCount}).`,
            });
          }
        }
        continue;
      }

      // Thienlong: Bếp/Bồi-Regeln (Lücke, Fr/Sa/So-Mindestbesetzung, Abend ≥ Mittag)
      // – gleiche Rechnung wie im Planer (roleCoverage.ts), inkl. Rollenwechsel.
      if (context.storeId === "thienlong") {
        roleErrorsForDay(employees, shifts, date, day.blocks).forEach((e) => errors.push(e));
      }

      const openingStart = day.blocks[0].startMinutes;
      const openerCount = shifts.filter((shift) => {
        if (shift.date !== date) return false;
        return (shift.segments?.[0]?.startMinutes ?? shift.startMinutes) === openingStart;
      }).length;
      if (openerCount < 2) {
        errors.push({
          date,
          message: `Ngày ${date}: cần ít nhất 2 nhân viên mở cửa trước 30 phút (hiện có ${openerCount}).`,
          kind: "rule",
          reason: "Quán cần 2 người vào sớm để chuẩn bị trước giờ mở cửa.",
          suggestion: `Cho thêm 1 người bắt đầu lúc ${minutesToTime(openingStart)} (dời giờ vào của một ca sớm hơn).`,
        });
      }
    }
  }

  return { valid: errors.every((e) => e.severity === "warning"), errors, summaries };
}

const employeesByIdOf = (employees: Employee[]) => new Map(employees.map((e) => [e.id, e] as const));
const slotText = (slots: number[]) => {
  const ranges: [number, number][] = [];
  for (const t of slots) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === t) last[1] = t + 30;
    else ranges.push([t, t + 30]);
  }
  return ranges.map(([a, b]) => `${minutesToTime(a)}–${minutesToTime(b)}`).join(", ");
};

/** Rollen-Fehler eines Tages mit Grund und Vorschlag. */
function roleErrorsForDay(
  employees: Employee[],
  shifts: Shift[],
  date: string,
  blocks: { startMinutes: number; endMinutes: number }[],
): ValidationError[] {
  const byId = employeesByIdOf(employees);
  const roleOf = (s: Shift) => byId.get(s.employeeId)?.workRole;
  const dayShifts = shifts.filter((s) => s.date === date);
  const weekday = weekdayKeyOf(parseIsoDate(date));
  const rolesInTeam = ROLES.filter((r) => employees.some((e) => e.workRole === r && e.targetMinutes > 0));
  const issues = dayRoleIssues(dayShifts, roleOf, blocks, weekday, rolesInTeam);

  // Wer kann an dem Tag in dieser Rolle arbeiten (Rolle dieses Monats)?
  const availableFor = (role: WorkRole) =>
    employees.filter(
      (e) =>
        e.workRole === role &&
        e.targetMinutes > 0 &&
        !isEmployeeFixedDayOff(e, date) &&
        unavailableReason(e, date) === null,
    ).length;
  // „Bồi đi làm được hôm nay: Qui, Patrizia. Vắng: Thuy (nghỉ cố định), Hằng (đi học)."
  const whoText = (role: WorkRole): string => {
    const team = employees.filter((e) => e.workRole === role);
    const working = dayShifts.filter((s) => roleOf(s) === role).map((s) => byId.get(s.employeeId)!.name);
    const away = team
      .map((e) => {
        const why = isEmployeeFixedDayOff(e, date)
          ? "nghỉ cố định"
          : unavailableReason(e, date)?.toLowerCase() ?? (e.targetMinutes <= 0 ? "0h tháng này" : null);
        return why ? `${e.name} (${why})` : null;
      })
      .filter(Boolean);
    const free = team
      .filter((e) => !working.includes(e.name) && !away.some((a) => a!.startsWith(e.name)))
      .map((e) => e.name);
    return (
      `${roleLabel(role)} có ca hôm nay: ${working.length > 0 ? working.join(", ") : "không ai"}.` +
      (away.length > 0 ? ` Vắng: ${away.join(", ")}.` : "") +
      (free.length > 0 ? ` Có thể gọi thêm: ${free.join(", ")} (hôm nay không có ca).` : "")
    );
  };
  const suggestionFor = (role: WorkRole, times: number[]): string => {
    const other: WorkRole = role === "KITCHEN" ? "SERVICE" : "KITCHEN";
    const spare =
      times.length > 0 &&
      times.every((t) => roleCountAt(dayShifts, roleOf, other, t) > (other === "KITCHEN" ? 2 : 1));
    return spare
      ? `Lúc đó ${roleLabel(other)} dư người. Bấm “Tìm cách xếp khác” để thử cho một người làm ${roleLabel(role)} cả tháng.`
      : `Kéo dài hoặc dời ca của một ${roleLabel(role)} vào giờ đó (bấm vào ca), hoặc bấm “Tìm cách xếp khác”.`;
  };

  const out: ValidationError[] = [];
  for (const g of issues.gaps) {
    out.push({
      date,
      kind: "coverage",
      message: `Ngày ${date}: không có ${roleLabel(g.role)} lúc ${slotText(g.slots)}.`,
      reason: `Không ai làm ${roleLabel(g.role)} trong các giờ này. ${whoText(g.role)}`,
      suggestion: suggestionFor(g.role, g.slots),
    });
  }
  for (const m of issues.minStaff) {
    const label = roleLabel(m.role);
    const available = availableFor(m.role);
    out.push({
      date,
      kind: "coverage",
      message:
        `Ngày ${date}: cần ít nhất ${m.minStaff} ${label} từ ` +
        `${minutesToTime(m.startMinutes)}–${minutesToTime(m.endMinutes)} (thiếu lúc ${m.short.map(minutesToTime).join(", ")}).`,
      reason:
        (available < m.minStaff
          ? `Hôm nay chỉ có ${available} ${label} đi làm được – không đủ người. `
          : `Có ${available} ${label} đi làm được nhưng giờ làm của họ không trùng đủ khung này. `) +
        whoText(m.role),
      suggestion: suggestionFor(m.role, m.short),
    });
  }
  for (const e of issues.eveningBelowLunch) {
    out.push({
      date,
      kind: "coverage",
      message: `Ngày ${date}: ${roleLabel(e.role)} tối (${e.dinner}) ít hơn trưa (${e.lunch}).`,
      reason: `Buổi tối đông khách hơn, nên mỗi vị trí phải có ít nhất bằng số người buổi trưa. ${whoText(e.role)}`,
      suggestion: `Dời một ca ${roleLabel(e.role)} chỉ làm trưa sang buổi tối, hoặc cho một người làm ca gãy trưa + tối.`,
    });
  }
  return out;
}

const DOW_VI = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
/** „T3 29.09" */
export function shortDayLabel(iso: string): string {
  const d = parseIsoDate(iso);
  return `${DOW_VI[d.getDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}
const hoursText = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`.replace(".", ",");

/**
 * Warum ein Azubi-Soll nicht erreichbar ist – je Woche mit Tagen und Gründen,
 * z. B. „28.–30.09: chỉ T3 29.09 (T2 28.09, T4 30.09 nghỉ cố định) → 10h".
 */
export function azubiCapacityReason(
  breakdown: { weeks: AzubiWeekCapacity[]; totalMinutes: number; weekCapMinutes: number },
  targetMinutes: number,
): string {
  const cap = breakdown.weekCapMinutes;
  const parts = breakdown.weeks.map((w) => {
    const range = w.from === w.to ? shortDayLabel(w.from) : `${w.from.slice(8, 10)}.–${shortDayLabel(w.to).slice(3)}`;
    if (w.workDays.length === 0) return `${range}: không ngày nào làm được → 0h`;
    if (w.minutes >= cap) return `${range}: ${w.workDays.length} ngày làm được → đủ ${hoursText(cap)}`;
    const blocked = w.blocked.length > 0
      ? ` (${w.blocked.map((b) => `${shortDayLabel(b.date)} ${b.reason}`).join(", ")})`
      : "";
    const days = w.workDays.length <= 2
      ? `chỉ ${w.workDays.map(shortDayLabel).join(", ")}`
      : `${w.workDays.length} ngày`;
    return `${range}: ${days}${blocked} → tối đa ${hoursText(w.minutes)}`;
  });
  const shortWeeks = breakdown.weeks.filter((w) => w.minutes < cap).length;
  return (
    `Azubi tối đa ${hoursText(cap)}/tuần và 10h/ngày. ` +
    parts.join(" · ") +
    `. Tổng tối đa ${hoursText(breakdown.totalMinutes)} < ${hoursText(targetMinutes)}. ` +
    (shortWeeks > 0
      ? `Ca dài hơn cũng không bù được: các tuần đủ ngày đã chạm ${hoursText(cap)}, tuần thiếu ngày thì mỗi ngày tối đa 10h.`
      : `Ca dài hơn cũng không bù được vì tuần nào cũng đã chạm ${hoursText(cap)}.`)
  );
}
