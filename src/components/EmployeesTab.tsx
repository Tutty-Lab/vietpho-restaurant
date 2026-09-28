import { useMemo, useState } from "react";
import { datesOfMonth } from "../lib/demand";
import { isRoleSwitchedInMonth, monthRole } from "../lib/roleCoverage";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import {
  AZUBI_MONTHLY_WARNING_HOURS,
  type AzubiConfig,
  type Employee,
  type EmploymentType,
  type WeekdayName,
  type WorkRole,
} from "../types";
import { splitTargetHours, teilzeitShiftCount } from "../lib/splitTargetHours";
import { describePreferredWindow, preferredWindowsOf } from "../lib/preferredWindows";
import { minutesToTime, timeToMinutes } from "../lib/time";
import {
  activeDaysInMonth,
  employmentPeriodLabel,
  fullMonthTargetMinutes,
  prorateForEmploymentPeriod,
} from "../lib/employmentPeriod";
import {
  azubiConfigOf,
  azubiMonthKey,
  azubiMonthMode,
  azubiSchoolTermRange,
  azubiMonthlyHoursNeedWarning,
  azubiMonthlyHoursForMonth,
  azubiTermMonths,
} from "../lib/azubi";
import {
  hasRequiredFixedDaysOff,
  requiredFixedDaysOff,
  WEEKDAY_ORDER,
} from "../lib/fixedDaysOff";

// text-base (16px) auf dem Handy: iOS zoomt sonst beim Tippen hinein.
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base sm:text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500";

export const WARN_HOURS = 192;

const WEEKDAY_LABELS: Record<WeekdayName, string> = {
  monday: "T2",
  tuesday: "T3",
  wednesday: "T4",
  thursday: "T5",
  friday: "T6",
  saturday: "T7",
  sunday: "CN",
};

const TYPE_SHORT: Record<EmploymentType, string> = {
  VOLLZEIT: "TT",
  TEILZEIT: "BT",
  AZUBI: "Azubi",
};

function splitInfo(targetHours: number, type: EmploymentType): { ok: boolean; text: string } {
  if (targetHours <= 0) return { ok: true, text: "—" };
  if (type === "TEILZEIT") {
    // Bán thời gian: nhiều ca ngắn 2–4h vào giờ cao điểm.
    return { ok: true, text: `~${teilzeitShiftCount(targetHours)} ca ngắn 2–4h` };
  }
  try {
    const parts = splitTargetHours(Math.round(targetHours), type);
    return { ok: true, text: `${parts.length} ca` };
  } catch (e) {
    return { ok: false, text: e instanceof Error ? e.message : "không hợp lệ" };
  }
}

type Draft = {
  name: string;
  employmentType: EmploymentType;
  workRole: WorkRole | "";
  hours: string;
  daysPerWeek: string;
  saved: boolean;
  fixedDaysOff: WeekdayName[];
  azubi: AzubiConfig;
  startDate: string;
  endDate: string;
  canSwitchRole: boolean;
  roleByMonth: Record<string, WorkRole>;
  shiftMin: string;
  shiftMax: string;
  spreadEvenly: boolean;
  windows: { days: WeekdayName[]; start: string; end: string }[];
};

function draftFrom(emp?: Employee): Draft {
  return {
    name: emp?.name ?? "",
    employmentType: emp?.employmentType ?? "VOLLZEIT",
    workRole: emp?.workRole ?? "",
    hours: emp ? String(fullMonthTargetMinutes(emp) / 60) : "176",
    daysPerWeek: emp?.desiredDaysPerWeek ? String(emp.desiredDaysPerWeek) : "",
    saved: emp?.saved === true,
    fixedDaysOff: emp?.fixedDaysOff ?? [],
    // Neue Azubis starten ohne Kỳ học (sonst wäre der Monat „Schule" = 0 h).
    azubi: emp?.azubi ? azubiConfigOf(emp.azubi) : { ...azubiConfigOf(undefined), inSchoolTerm: false },
    startDate: emp?.startDate ?? "",
    endDate: emp?.endDate ?? "",
    canSwitchRole: emp?.canSwitchRole === true,
    roleByMonth: { ...(emp?.roleByMonth ?? {}) },
    shiftMin: emp?.shiftHours ? String(emp.shiftHours.min) : "",
    shiftMax: emp?.shiftHours ? String(emp.shiftHours.max) : "",
    spreadEvenly: emp?.spreadEvenly === true,
    windows: (emp?.preferredWindows ?? []).map((w) => ({
      days: [...w.days],
      start: minutesToTime(w.startMinutes),
      end: minutesToTime(w.endMinutes),
    })),
  };
}

/** „Độ dài ca" aus dem Formular: beide Werte > 0, sonst nicht gesetzt. */
function shiftHoursFromDraft(d: Draft): Employee["shiftHours"] {
  const min = Number(d.shiftMin);
  const max = Number(d.shiftMax);
  if (!(min > 0) || !(max > 0)) return undefined;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

/** Nur vollständige Khung giờ (mind. ein Tag, Ende nach Beginn). */
function windowsFromDraft(d: Draft): Employee["preferredWindows"] {
  const out = d.windows.flatMap((w) => {
    try {
      const startMinutes = timeToMinutes(w.start);
      const endMinutes = timeToMinutes(w.end);
      if (w.days.length === 0 || endMinutes <= startMinutes) return [];
      return [{ days: WEEKDAY_ORDER.filter((x) => w.days.includes(x)), startMinutes, endMinutes }];
    } catch {
      return [];
    }
  });
  return out.length > 0 ? out : undefined;
}

function draftToEmployee(d: Draft): Omit<Employee, "id"> {
  const isAzubi = d.employmentType === "AZUBI";
  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  return {
    name: d.name.trim() || "Nhân viên mới",
    employmentType: d.employmentType,
    // Bei Azubi wird targetMinutes vom Hook (withAutomaticAzubiTarget) aus der
    // Konfiguration neu berechnet; hier nur ein Platzhalter.
    targetMinutes: isAzubi ? 0 : stunden * 60,
    // Voll-Monatssoll neu eingetragen; die anteilige Kürzung rechnet der Hook.
    baseTargetMinutes: undefined,
    startDate: d.startDate || undefined,
    endDate: d.endDate || undefined,
    azubi: isAzubi ? d.azubi : undefined,
    workRole: d.workRole || undefined,
    saved: d.saved || undefined,
    // Teilzeit hat keine festen Ruhetage; Vollzeit/Azubi schon.
    fixedDaysOff: d.employmentType === "TEILZEIT" ? undefined : d.fixedDaysOff,
    // Gewünschte Arbeitstage/Woche: nur 1..7, sonst nicht gesetzt.
    desiredDaysPerWeek: desiredDaysFromDraft(d),
    canSwitchRole: d.canSwitchRole || undefined,
    // Monats-Rollen nur behalten, wenn umstellbar und abweichend von der Hauptrolle.
    roleByMonth: (() => {
      if (!d.canSwitchRole) return undefined;
      const kept = Object.fromEntries(Object.entries(d.roleByMonth).filter(([, r]) => r !== d.workRole));
      return Object.keys(kept).length > 0 ? kept : undefined;
    })(),
    shiftHours: shiftHoursFromDraft(d),
    spreadEvenly: d.spreadEvenly || undefined,
    preferredWindows: windowsFromDraft(d),
  };
}

/** Liest die gewünschten Arbeitstage/Woche aus dem Formular (1..7 oder undefined). */
function desiredDaysFromDraft(d: Draft): number | undefined {
  const n = Math.round(Number(d.daysPerWeek));
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.min(7, n);
}

/** Tab Nhân viên – Azubi-Einstellungen stecken direkt im Formular der Person. */
export function EmployeesTab({ store }: { store: UseScheduleReturn }) {
  return <EmployeesList store={store} />;
}

function EmployeesList({ store }: { store: UseScheduleReturn }) {
  const { schedule, addEmployee, updateEmployee, removeEmployee } = store;

  const [offen, setOffen] = useState<null | "new" | string>(null);
  const bearbeitet = useMemo(
    () =>
      typeof offen === "string" && offen !== "new"
        ? schedule.employees.find((e) => e.id === offen)
        : undefined,
    [offen, schedule.employees],
  );

  return (
    <section className="rounded-lg bg-white border border-slate-200 p-4 sm:p-5 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-base font-semibold text-slate-900">
          Nhân viên
          {schedule.employees.length > 0 && (
            <span className="ml-2 text-sm font-normal text-slate-400">
              {schedule.employees.length}
            </span>
          )}
        </h2>
        <button
          onClick={() => setOffen("new")}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800"
        >
          + Thêm
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        Bấm vào một người để sửa. Azubi: kỳ học và giờ từng tháng cài ngay trong đó.
      </p>

      {schedule.employees.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          Chưa có nhân viên. Bấm <b>+ Thêm</b> để tạo.
        </div>
      ) : (
        <ul className="space-y-2">
          {schedule.employees.map((emp) => (
            <li key={emp.id}>
              <button
                onClick={() => setOffen(emp.id)}
                className="w-full text-left rounded-lg border border-slate-200 p-3 flex items-center gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
              >
                <EmployeeSummaryRow
                  emp={emp}
                  year={schedule.year}
                  month={schedule.month}
                />
                <span className="text-slate-300 text-lg leading-none">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => setOffen("new")}
        aria-label="Thêm nhân viên"
        className="sm:hidden fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-slate-900 text-white text-2xl shadow-lg active:bg-slate-700 flex items-center justify-center"
      >
        +
      </button>

      {offen !== null && (
        <EmployeeSheet
          key={bearbeitet?.id ?? "new"}
          employee={bearbeitet}
          year={schedule.year}
          month={schedule.month}
          storeId={store.storeId}
          onClose={() => setOffen(null)}
          onSave={(felder) => {
            if (bearbeitet) updateEmployee(bearbeitet.id, felder);
            else addEmployee(felder);
            setOffen(null);
          }}
          onDelete={
            bearbeitet
              ? () => {
                  removeEmployee(bearbeitet.id);
                  setOffen(null);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}

function EmployeeSummaryRow({
  emp,
  year,
  month,
}: {
  emp: Employee;
  year: number;
  month: number;
}) {
  const isAzubi = emp.employmentType === "AZUBI";
  const azubiConfig = isAzubi ? azubiConfigOf(emp.azubi) : null;
  const azubiMonthlyHours = azubiConfig ? azubiMonthlyHoursForMonth(azubiConfig, year, month) : 0;
  const fullMonth = isAzubi ? azubiMonthlyHours * 60 : fullMonthTargetMinutes(emp);
  const stunden = fullMonthTargetMinutes(emp) / 60;
  const info = isAzubi
    ? { ok: true, text: `${azubiMonthlyHours}h · Azubi` }
    : splitInfo(stunden, emp.employmentType);
  const tooMany = !isAzubi && stunden > WARN_HOURS;
  const requiredDaysOff = requiredFixedDaysOff(emp.employmentType);
  const daysOffOk = hasRequiredFixedDaysOff(emp);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-slate-900 truncate">{emp.name}</span>
        <span className="shrink-0 rounded bg-slate-100 text-slate-600 text-[11px] px-1.5 py-0.5">
          {TYPE_SHORT[emp.employmentType]}
        </span>
        {emp.workRole ? (
          <span
            className={`shrink-0 rounded text-[11px] px-1.5 py-0.5 ${
              emp.workRole === "KITCHEN" ? "bg-orange-50 text-orange-700" : "bg-sky-50 text-sky-700"
            }`}
          >
            {emp.workRole === "KITCHEN" ? "Bếp" : "Bồi"}
          </span>
        ) : null}
        {isRoleSwitchedInMonth(emp, year, month) && (
          <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
            → {monthRole(emp, year, month) === "KITCHEN" ? "Bếp" : "Bồi"} tháng này
          </span>
        )}
        {tooMany && <span className="shrink-0 text-amber-600 text-xs">⚠</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500">
        <span>
          {!isAzubi && `${stunden}h · `}
          <span className={info.ok ? "" : "text-rose-600"}>{info.text}</span>
        </span>
        {requiredDaysOff > 0 && (
          <span className={daysOffOk ? "text-slate-400" : "text-amber-700 font-medium"}>
            · nghỉ {(emp.fixedDaysOff ?? []).map((d) => WEEKDAY_LABELS[d]).join(" ") || "—"}
            {!daysOffOk && ` (cần ${requiredDaysOff})`}
          </span>
        )}
        {emp.desiredDaysPerWeek ? (
          <span className="text-slate-400">· {emp.desiredDaysPerWeek} ngày/tuần</span>
        ) : null}
        {emp.shiftHours && (
          <span className="text-teal-700">
            · ca {emp.shiftHours.min}–{emp.shiftHours.max}h
          </span>
        )}
        {emp.spreadEvenly && <span className="text-teal-700">· rải đều</span>}
        {preferredWindowsOf(emp).length > 0 && (
          <span className="text-teal-700">
            · ưu tiên {preferredWindowsOf(emp).map(describePreferredWindow).join(" + ")}
          </span>
        )}
        {(emp.startDate || emp.endDate) && (
          <span className="text-violet-700">
            · {employmentPeriodLabel(emp)}
            {emp.targetMinutes !== fullMonth && ` → tháng này ${emp.targetMinutes / 60}h`}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Formular (Bottom-Sheet, mobil zuerst) --------------------------------

/** Große Tipp-Ziele statt Dropdowns (Hình thức, Vị trí). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-1 rounded-lg bg-slate-100 p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-2 py-2.5 text-sm font-medium transition-colors ${
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-2">
      <span className="text-xs font-medium text-slate-600">{children}</span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </div>
  );
}

/** Zahlenfeld mit Ziffern-Tastatur und Einheit rechts. */
function HoursInput({
  value,
  onChange,
  placeholder,
  unit = "h",
  disabled,
  warn,
  decimal,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  unit?: string;
  disabled?: boolean;
  warn?: boolean;
  decimal?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode={decimal ? "decimal" : "numeric"}
        enterKeyHint="done"
        min={0}
        step={decimal ? 0.5 : 1}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => e.target.select()}
        className={`${inputClass} w-full pr-10 tabular-nums ${warn ? "border-amber-400 text-amber-900" : ""} disabled:bg-slate-50 disabled:text-slate-400`}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
        {unit}
      </span>
    </div>
  );
}

function SheetSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      {children}
    </section>
  );
}

function EmployeeSheet({
  employee,
  year,
  month,
  storeId,
  onClose,
  onSave,
  onDelete,
}: {
  employee?: Employee;
  year: number;
  month: number;
  storeId: string;
  onClose: () => void;
  onSave: (felder: Omit<Employee, "id">) => void;
  onDelete?: () => void;
}) {
  const [d, setD] = useState<Draft>(() => draftFrom(employee));
  const [loeschFrage, setLoeschFrage] = useState(false);
  const [showPeriod, setShowPeriod] = useState(() => !!(employee?.startDate || employee?.endDate));

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((prev) => ({ ...prev, [k]: v }));
  const setAzubi = (patch: Partial<AzubiConfig>) => setD((prev) => ({ ...prev, azubi: { ...prev.azubi, ...patch } }));

  const showWorkRole = storeId === "thienlong";
  const isAzubi = d.employmentType === "AZUBI";
  const stunden = Math.max(0, Math.round(Number(d.hours) || 0));
  const info = splitInfo(stunden, d.employmentType);
  const tooMany = !isAzubi && stunden > WARN_HOURS;

  // ---- Azubi ----
  const monthKey = azubiMonthKey(year, month);
  const azubiMode = azubiMonthMode(d.azubi, year, month);
  const hasTermDates = !!azubiSchoolTermRange(d.azubi);
  const azubiGeneral = d.azubi.monthlyHoursOutOfTerm ?? 0;
  const azubiWarning = azubiMonthlyHoursNeedWarning(d.azubi, year, month);
  const monthDates = datesOfMonth(year, month);
  const termMonths = azubiTermMonths(d.azubi);
  const setMonthMap = (
    field: "monthlyHoursByMonth" | "workMonthHoursByMonth",
    key: string,
    raw: string,
  ) => {
    const next = { ...(d.azubi[field] ?? {}) };
    if (raw === "") delete next[key];
    else if (Number.isFinite(Number(raw))) next[key] = Math.max(0, Number(raw));
    setAzubi({ [field]: Object.keys(next).length > 0 ? next : undefined });
  };

  const requiredDaysOff = requiredFixedDaysOff(d.employmentType);
  const draftEmp: Employee = { id: "draft", ...draftToEmployee(d) };
  const daysOffOk = hasRequiredFixedDaysOff(draftEmp);
  const monthDays = new Date(year, month, 0).getDate();
  const activeDays = activeDaysInMonth(draftEmp, year, month);
  const periodPreview =
    d.endDate && d.startDate && d.endDate < d.startDate
      ? "Ngày nghỉ việc phải sau ngày vào làm."
      : activeDays >= monthDays
        ? `Tháng ${month}/${year}: làm đủ tháng.`
        : activeDays === 0
          ? `Tháng ${month}/${year}: không làm ngày nào → 0h, không xếp lịch.`
          : isAzubi
            ? `Tháng ${month}/${year}: làm ${activeDays}/${monthDays} ngày. Azubi không tự tính giờ – nhập giờ riêng tháng này ở trên.`
            : `Tháng ${month}/${year}: làm ${activeDays}/${monthDays} ngày → khoảng ${
                prorateForEmploymentPeriod(stunden * 60, draftEmp, year, month) / 60
              }h.`;

  const toggleDayOff = (weekday: WeekdayName) => {
    const selected = d.fixedDaysOff.includes(weekday);
    const next = selected
      ? d.fixedDaysOff.filter((day) => day !== weekday)
      : requiredDaysOff === 1
        ? [weekday]
        : [...d.fixedDaysOff, weekday];
    set("fixedDaysOff", next);
  };

  const canSave = !(showWorkRole && !d.workRole) && d.name.trim().length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full sm:max-w-md max-h-[94dvh] flex-col rounded-t-2xl sm:rounded-lg bg-white shadow-xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="font-semibold text-slate-900">{employee ? "Sửa nhân viên" : "Thêm nhân viên"}</h3>
          <button
            onClick={onClose}
            aria-label="Đóng"
            className="-mr-2 h-10 w-10 rounded-full text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-6">
          <SheetSection title="Thông tin">
            <label className="block">
              <FieldLabel>Tên</FieldLabel>
              <input
                autoFocus={!employee}
                autoCapitalize="words"
                autoComplete="off"
                enterKeyHint="next"
                className={`${inputClass} w-full`}
                value={d.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Tên nhân viên"
              />
            </label>
            <div>
              <FieldLabel>Hình thức</FieldLabel>
              <Segmented<EmploymentType>
                value={d.employmentType}
                onChange={(v) => set("employmentType", v)}
                options={[
                  { value: "VOLLZEIT", label: "Toàn TG" },
                  { value: "TEILZEIT", label: "Bán TG" },
                  { value: "AZUBI", label: "Azubi" },
                ]}
              />
            </div>
            {showWorkRole && (
              <div>
                <FieldLabel hint={!d.workRole ? "bắt buộc" : undefined}>Vị trí chính</FieldLabel>
                <Segmented<WorkRole>
                  value={d.workRole}
                  onChange={(v) => set("workRole", v)}
                  options={[
                    { value: "KITCHEN", label: "Bếp" },
                    { value: "SERVICE", label: "Bồi" },
                  ]}
                />
              </div>
            )}
            {showWorkRole && d.workRole && (
              <div className="rounded-lg border border-slate-200">
                <label className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm text-slate-700">
                    Làm được cả Bếp và Bồi
                    <span className="block text-[11px] text-slate-400">
                      Tháng thiếu người có thể cho làm vị trí kia cả tháng
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={d.canSwitchRole}
                    onChange={(e) => set("canSwitchRole", e.target.checked)}
                    className="h-6 w-6 rounded border-slate-300"
                  />
                </label>
                {d.canSwitchRole && (
                  <div className="border-t border-slate-100 px-3 py-2.5">
                    <FieldLabel>Tháng {month}/{year} làm</FieldLabel>
                    <Segmented<WorkRole>
                      value={d.roleByMonth[azubiMonthKey(year, month)] ?? d.workRole}
                      onChange={(v) =>
                        set("roleByMonth", { ...d.roleByMonth, [azubiMonthKey(year, month)]: v })
                      }
                      options={[
                        { value: "KITCHEN", label: d.workRole === "KITCHEN" ? "Bếp (chính)" : "Bếp" },
                        { value: "SERVICE", label: d.workRole === "SERVICE" ? "Bồi (chính)" : "Bồi" },
                      ]}
                    />
                  </div>
                )}
              </div>
            )}
          </SheetSection>

          <SheetSection title="Giờ làm">
            {!isAzubi ? (
              <div>
                <FieldLabel hint={info.text}>Giờ / tháng</FieldLabel>
                <HoursInput value={d.hours} onChange={(v) => set("hours", v)} warn={tooMany} />
                {!info.ok && <p className="mt-1 text-xs text-rose-600">{info.text}</p>}
                {tooMany && <p className="mt-1 text-xs text-amber-700">⚠ trên {WARN_HOURS}h/tháng</p>}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Mức chung / tháng</FieldLabel>
                    <HoursInput
                      decimal
                      value={String(azubiGeneral)}
                      onChange={(v) => setAzubi({ monthlyHoursOutOfTerm: Math.max(0, Number(v) || 0) })}
                    />
                  </div>
                  <div>
                    <FieldLabel hint={azubiMode === "mixed" ? "bắt buộc" : undefined}>
                      Tháng {month}/{year}
                    </FieldLabel>
                    {azubiMode === "school" && hasTermDates ? (
                      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
                        0h · đi học
                      </div>
                    ) : (
                      <HoursInput
                        decimal
                        warn={azubiWarning || (azubiMode === "mixed" && d.azubi.monthlyHoursByMonth?.[monthKey] === undefined)}
                        placeholder={azubiMode === "mixed" ? "Nhập" : String(azubiGeneral)}
                        value={String(
                          (azubiMode === "work"
                            ? d.azubi.workMonthHoursByMonth?.[monthKey]
                            : d.azubi.monthlyHoursByMonth?.[monthKey]) ?? "",
                        )}
                        onChange={(v) =>
                          setMonthMap(azubiMode === "work" ? "workMonthHoursByMonth" : "monthlyHoursByMonth", monthKey, v)
                        }
                      />
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  {azubiMode === "mixed"
                    ? "Tháng này vừa đi học vừa đi làm: chỉ xếp ca ngày không đi học. App không tự tính giờ – hãy nhập."
                    : azubiMode === "school" && hasTermDates
                      ? "Đi học cả tháng – không xếp ca."
                      : `Ô tháng ${month}/${year} để trống = dùng mức chung.`}
                  {azubiWarning && ` ⚠ trên ${AZUBI_MONTHLY_WARNING_HOURS}h/tháng, lịch có thể khó xếp.`}
                </p>
              </>
            )}
            <div>
              <FieldLabel hint="bỏ trống = tự động">Số ngày làm / tuần</FieldLabel>
              <div className="grid grid-cols-8 gap-1">
                {["", "1", "2", "3", "4", "5", "6", "7"].map((n) => (
                  <button
                    key={n || "auto"}
                    type="button"
                    aria-pressed={d.daysPerWeek === n}
                    onClick={() => set("daysPerWeek", n)}
                    className={`rounded-md border py-2.5 text-sm font-medium ${
                      d.daysPerWeek === n
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    {n || "Tự"}
                  </button>
                ))}
              </div>
            </div>
          </SheetSection>

          {requiredDaysOff > 0 && (
            <SheetSection title={`Ngày nghỉ cố định · chọn ${requiredDaysOff}`}>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAY_ORDER.map((weekday) => {
                  const selected = d.fixedDaysOff.includes(weekday);
                  const maxReached =
                    requiredDaysOff > 1 && d.fixedDaysOff.length >= requiredDaysOff && !selected;
                  return (
                    <button
                      key={weekday}
                      type="button"
                      aria-pressed={selected}
                      disabled={maxReached}
                      onClick={() => toggleDayOff(weekday)}
                      className={`rounded-md border py-2.5 text-sm font-medium transition-colors ${
                        selected
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-600"
                      } disabled:opacity-40`}
                    >
                      {WEEKDAY_LABELS[weekday]}
                    </button>
                  );
                })}
              </div>
              {!daysOffOk && (
                <p className="text-xs text-amber-700">
                  Đã chọn {d.fixedDaysOff.length}/{requiredDaysOff} ngày.
                </p>
              )}
            </SheetSection>
          )}

          {isAzubi && (
            <SheetSection title="Kỳ học (đi học không xếp ca)">
              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                <span className="text-sm text-slate-700">Có lịch đi học</span>
                <input
                  type="checkbox"
                  checked={d.azubi.inSchoolTerm && hasTermDates}
                  onChange={(e) =>
                    setAzubi(
                      e.target.checked
                        ? {
                            inSchoolTerm: true,
                            schoolTermStart: d.azubi.schoolTermStart ?? monthDates[0],
                            schoolTermEnd: d.azubi.schoolTermEnd ?? monthDates[monthDates.length - 1],
                          }
                        : { inSchoolTerm: false, schoolTermStart: undefined, schoolTermEnd: undefined },
                    )
                  }
                  className="h-6 w-6 rounded border-slate-300"
                />
              </label>
              {d.azubi.inSchoolTerm && hasTermDates && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <FieldLabel>Từ ngày</FieldLabel>
                      <input
                        type="date"
                        className={`${inputClass} w-full`}
                        value={d.azubi.schoolTermStart ?? ""}
                        max={d.azubi.schoolTermEnd}
                        onChange={(e) => e.target.value && setAzubi({ schoolTermStart: e.target.value })}
                      />
                    </label>
                    <label className="block">
                      <FieldLabel>Đến ngày</FieldLabel>
                      <input
                        type="date"
                        className={`${inputClass} w-full`}
                        value={d.azubi.schoolTermEnd ?? ""}
                        min={d.azubi.schoolTermStart}
                        onChange={(e) => e.target.value && setAzubi({ schoolTermEnd: e.target.value })}
                      />
                    </label>
                  </div>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                    {termMonths.map(({ year: y, month: m }) => {
                      const mode = azubiMonthMode(d.azubi, y, m);
                      const key = azubiMonthKey(y, m);
                      return (
                        <div
                          key={key}
                          className={`flex items-center gap-3 px-3 py-2 ${y === year && m === month ? "bg-slate-50" : ""}`}
                        >
                          <span className="w-20 shrink-0 text-sm font-medium text-slate-700">
                            {m}/{y}
                          </span>
                          {mode === "school" ? (
                            <span className="text-sm text-slate-400">0h · đi học cả tháng</span>
                          ) : (
                            <div className="flex-1">
                              <HoursInput
                                decimal
                                placeholder="Nhập giờ"
                                warn={d.azubi.monthlyHoursByMonth?.[key] === undefined}
                                value={String(d.azubi.monthlyHoursByMonth?.[key] ?? "")}
                                onChange={(v) => setMonthMap("monthlyHoursByMonth", key, v)}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500">Tháng vừa học vừa làm: nhập số giờ làm của tháng đó.</p>
                </>
              )}
            </SheetSection>
          )}

          <SheetSection title="Luật riêng (mềm – xếp theo khi được)">
            <div>
              <FieldLabel hint="bỏ trống = mặc định">Độ dài ca</FieldLabel>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <HoursInput decimal placeholder="từ" value={d.shiftMin} onChange={(v) => set("shiftMin", v)} />
                <span className="text-slate-400">–</span>
                <HoursInput decimal placeholder="đến" value={d.shiftMax} onChange={(v) => set("shiftMax", v)} />
              </div>
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
              <span className="text-sm text-slate-700">
                Rải đều trong tháng
                <span className="block text-xs text-slate-400">
                  Tuần nào cũng có ca; có Độ dài ca thì ưu tiên nhiều ca ngắn.
                </span>
              </span>
              <input
                type="checkbox"
                checked={d.spreadEvenly}
                onChange={(e) => set("spreadEvenly", e.target.checked)}
                className="h-6 w-6 rounded border-slate-300"
              />
            </label>
            <div className="space-y-2">
              <FieldLabel hint="app ưu tiên xếp ngày và giờ vào đây">Khung giờ ưu tiên</FieldLabel>
              {d.windows.map((w, i) => {
                const update = (patch: Partial<Draft["windows"][number]>) =>
                  set("windows", d.windows.map((x, k) => (k === i ? { ...x, ...patch } : x)));
                return (
                  <div key={i} className="space-y-2 rounded-lg border border-slate-200 p-2">
                    <div className="grid grid-cols-7 gap-1">
                      {WEEKDAY_ORDER.map((weekday) => {
                        const on = w.days.includes(weekday);
                        return (
                          <button
                            key={weekday}
                            type="button"
                            aria-pressed={on}
                            onClick={() =>
                              update({ days: on ? w.days.filter((x) => x !== weekday) : [...w.days, weekday] })
                            }
                            className={`rounded-md border py-2 text-sm font-medium ${
                              on ? "border-teal-700 bg-teal-700 text-white" : "border-slate-200 bg-white text-slate-600"
                            }`}
                          >
                            {WEEKDAY_LABELS[weekday]}
                          </button>
                        );
                      })}
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                      <input
                        type="time"
                        step={1800}
                        className={`${inputClass} w-full`}
                        value={w.start}
                        onChange={(e) => update({ start: e.target.value })}
                      />
                      <span className="text-slate-400">–</span>
                      <input
                        type="time"
                        step={1800}
                        className={`${inputClass} w-full`}
                        value={w.end}
                        onChange={(e) => update({ end: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label="Xoá khung giờ"
                        onClick={() => set("windows", d.windows.filter((_, k) => k !== i))}
                        className="rounded-lg px-3 py-2.5 text-sm text-rose-600 hover:bg-rose-50"
                      >
                        ✕
                      </button>
                    </div>
                    {(w.days.length === 0 || w.end <= w.start) && (
                      <p className="text-xs text-amber-700">
                        {w.days.length === 0 ? "Chọn ít nhất một ngày." : "Giờ kết thúc phải sau giờ bắt đầu."}
                      </p>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  set("windows", [...d.windows, { days: [...WEEKDAY_ORDER], start: "12:00", end: "14:00" }])
                }
                className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-left text-sm text-slate-600"
              >
                + Thêm khung giờ <span className="text-slate-400">(ví dụ T2–T6 10:30–15:00)</span>
              </button>
            </div>
          </SheetSection>

          <SheetSection title="Thời gian làm việc">
            {!showPeriod ? (
              <button
                type="button"
                onClick={() => setShowPeriod(true)}
                className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-left text-sm text-slate-600"
              >
                + Ngày vào làm / nghỉ việc <span className="text-slate-400">(nếu không làm cả tháng)</span>
              </button>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <FieldLabel>Ngày vào làm</FieldLabel>
                    <input
                      type="date"
                      className={`${inputClass} w-full`}
                      value={d.startDate}
                      max={d.endDate || undefined}
                      onChange={(e) => set("startDate", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <FieldLabel>Ngày nghỉ việc</FieldLabel>
                    <input
                      type="date"
                      className={`${inputClass} w-full`}
                      value={d.endDate}
                      min={d.startDate || undefined}
                      onChange={(e) => set("endDate", e.target.value)}
                    />
                  </label>
                </div>
                <p className="text-xs text-slate-500">{periodPreview}</p>
              </>
            )}
          </SheetSection>

          <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
            <span className={`text-sm ${d.saved ? "font-medium text-emerald-700" : "text-slate-700"}`}>
              Đã kiểm tra thông tin (Lưu)
            </span>
            <input
              type="checkbox"
              checked={d.saved}
              onChange={(e) => set("saved", e.target.checked)}
              className="h-6 w-6 rounded border-slate-300 text-emerald-600"
            />
          </label>
        </div>

        <div className="border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {loeschFrage ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-slate-600">Xoá nhân viên này?</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setLoeschFrage(false)}
                  className="rounded-lg px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Không
                </button>
                <button
                  onClick={onDelete}
                  className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-700"
                >
                  Xoá
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              {onDelete && (
                <button
                  onClick={() => setLoeschFrage(true)}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50"
                >
                  Xoá
                </button>
              )}
              <button
                onClick={onClose}
                className="ml-auto rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Huỷ
              </button>
              <button
                onClick={() => onSave(draftToEmployee(d))}
                disabled={!canSave}
                className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
              >
                Lưu
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
