import { vietphoOwnerForDate } from "../lib/vietphoOwner";
import { OwnerTimes } from "./OwnerTimes";
import { useMemo, useRef, useEffect } from "react";
import { RoleBadge } from "./RoleBadge";
import { mealLabel } from "../lib/shiftMeals";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_LABELS_VI,
  WEEKDAY_SHORT_VI,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToShortHours, minutesToTime } from "../lib/time";
import { isoLabel } from "../lib/shiftOps";
import { holidayNames as holidayNamesOf } from "../lib/holidays";
import { isThienlongMonthRushDate } from "../lib/thienlongDemand";
import { isEmployeeFixedDayOff } from "../lib/fixedDaysOff";
import { isEmployeeAvailableOn } from "../lib/availability";
import { ShiftTimes } from "./ShiftTimes";

/** Chế độ xem theo từng ngày – tối ưu cho điện thoại (không cuộn ngang). */
export function ScheduleDayView({
  store,
  onEdit,
  selectedDate,
  onSelectedDateChange,
}: {
  store: UseScheduleReturn;
  onEdit: (employeeId: string, date: string) => void;
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
}) {
  const { schedule } = store;
  const dates = useMemo(
    () => datesOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  const holidayNames = useMemo(() => holidayNamesOf(schedule.year, schedule.holidayState), [schedule.year]);
  const overridesByDate = useMemo(
    () => new Map(schedule.dateOverrides.map((o) => [o.date, o] as const)),
    [schedule.dateOverrides],
  );

  // Tự cuộn chip ngày đang chọn vào tầm nhìn.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stripRef.current?.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [selectedDate]);

  const shiftsOfDay = useMemo(
    () => schedule.shifts.filter((s) => s.date === selectedDate),
    [schedule.shifts, selectedDate],
  );
  const shiftByEmp = useMemo(
    () => new Map(shiftsOfDay.map((s) => [s.employeeId, s] as const)),
    [shiftsOfDay],
  );

  // Nach Rolle (Bếp vor Bồi) und Beginn sortiert – so lässt sich die Besetzung je Gruppe prüfen.
  const roleOrder = (e: (typeof schedule.employees)[number]) =>
    e.workRole === "KITCHEN" ? 0 : e.workRole === "SERVICE" ? 1 : 2;
  const working = store.monthEmployees
    .filter((e) => shiftByEmp.has(e.id))
    .sort(
      (a, b) =>
        roleOrder(a) - roleOrder(b) ||
        shiftByEmp.get(a.id)!.startMinutes - shiftByEmp.get(b.id)!.startMinutes,
    );
  // Wer an diesem Tag (noch) nicht / nicht mehr beschäftigt ist, erscheint nicht.
  const free = schedule.employees.filter(
    (e) => !shiftByEmp.has(e.id) && isEmployeeAvailableOn(e, selectedDate),
  );

  const owner = store.storeId === "vietpho"
    ? vietphoOwnerForDate(schedule, selectedDate, store.monthEmployees) : [];
  const totalMin = shiftsOfDay.reduce((a, s) => a + s.paidMinutes, 0);
  const kitchenCount = working.filter((e) => e.workRole === "KITCHEN").length;
  const serviceCount = working.filter((e) => e.workRole === "SERVICE").length;

  const ov = overridesByDate.get(selectedDate);
  const holiday = holidayNames.get(selectedDate);
  const weekdayKey = weekdayKeyOf(parseIsoDate(selectedDate));
  const isWeekend = weekdayKey === "saturday" || weekdayKey === "sunday";
  const isThienlong = store.storeId === "thienlong";
  const isRush = isThienlong && isThienlongMonthRushDate(selectedDate);

  function chipClass(iso: string): string {
    const o = overridesByDate.get(iso);
    const isSel = iso === selectedDate;
    if (isSel) return "bg-slate-900 text-white border-slate-900";
    if (o?.closed) return "bg-rose-50 text-rose-700 border-rose-200";
    if (o) return "bg-sky-50 text-sky-700 border-sky-200";
    const k = weekdayKeyOf(parseIsoDate(iso));
    if (k === "saturday" || k === "sunday") return "bg-slate-100 text-slate-700 border-slate-200";
    return "bg-white text-slate-600 border-slate-200";
  }

  return (
    <div>
      {/* Dải chọn ngày */}
      <div ref={stripRef} className="flex gap-1.5 overflow-x-auto pb-2 -mx-3 px-3 sm:mx-0 sm:px-0">
        {dates.map((iso) => {
          const d = parseIsoDate(iso).getDate();
          const wk = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(iso))];
          return (
            <button
              key={iso}
              data-date={iso}
              onClick={() => onSelectedDateChange(iso)}
              className={`shrink-0 w-12 rounded-lg border py-1.5 text-center ${chipClass(iso)}`}
            >
              <div className="text-sm font-semibold leading-tight">{d}</div>
              <div className="text-[10px] leading-tight opacity-80">{wk}</div>
            </button>
          );
        })}
      </div>

      {/* Đầu ngày + badge */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          {WEEKDAY_LABELS_VI[weekdayKey]}, {isoLabel(selectedDate)}
        </h3>
        {ov?.closed && (
          <span className="rounded-full bg-rose-100 text-rose-700 text-xs px-2 py-0.5 font-medium">
            Đóng cửa
          </span>
        )}
        {ov && !ov.closed && (
          <span className="rounded-full bg-sky-100 text-sky-700 text-xs px-2 py-0.5 font-medium">
            Giờ riêng {minutesToTime(ov.window!.startMinutes)}–{minutesToTime(ov.window!.endMinutes)}
          </span>
        )}
        {holiday && (
          <span className="rounded-full bg-amber-100 text-amber-800 text-xs px-2 py-0.5 font-medium">
            Lễ: {holiday}
          </span>
        )}
        {isRush && (
          <span className="rounded-full bg-violet-100 text-violet-700 text-xs px-2 py-0.5 font-medium">
            Hơi đông (đầu/cuối tháng)
          </span>
        )}
        {!ov && !holiday && isWeekend && (
          <span className="rounded-full bg-slate-100 text-slate-600 text-xs px-2 py-0.5">Cuối tuần</span>
        )}
      </div>

      {/* Tóm tắt ngày */}
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <Summary label="Số NV" value={String(working.length)} />
        <Summary label="Tổng giờ" value={minutesToShortHours(totalMin)} />
        <Summary label="Bếp / Bồi" value={`${kitchenCount} / ${serviceCount}`} />
      </div>

      {owner.length > 0 && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div className="font-semibold">Chủ quán · Ưu tiên Bồi</div>
          <OwnerTimes segments={owner} />
        </div>
      )}
      {/* Danh sách người làm */}
      <div className="mt-3 space-y-2">
        {working.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-400">
            {schedule.shifts.length === 0 ? "Chưa tạo lịch." : "Không có nhân viên làm ngày này."}
          </div>
        ) : (
          working.map((emp) => {
            const s = shiftByEmp.get(emp.id) as Shift;
            const isEarly = s.shiftType === "EARLY";
            return (
              <button
                key={emp.id}
                onClick={() => onEdit(emp.id, selectedDate)}
                className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left ${
                  isEarly ? "shift-early" : "shift-late"
                } ${!s.generated ? "shift-custom" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium truncate">{emp.name}</span>
                    <RoleBadge role={emp.workRole} />
                  </div>
                  <div className="text-xs opacity-80">
                    {emp.employmentType === "VOLLZEIT"
                      ? "Toàn thời gian"
                      : emp.employmentType === "AZUBI"
                        ? "Azubi (học nghề)"
                        : "Bán thời gian"} ·{" "}
                    {mealLabel(s)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <ShiftTimes shift={s} />
                  <div className="text-xs opacity-80">
                    {minutesToShortHours(s.paidMinutes)}
                    {s.segments?.length ? " · Ca tách đôi" : ` · Nghỉ ${s.pauseMinutes}`}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Người đang nghỉ – bấm để thêm ca */}
      {free.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-slate-500 mb-1">Đang nghỉ ({free.length}):</div>
          <div className="flex flex-wrap gap-1.5">
            {free.map((emp) => {
              const fixedDayOff = isEmployeeFixedDayOff(emp, selectedDate);
              return (
                <button
                  key={emp.id}
                  disabled={fixedDayOff}
                  title={fixedDayOff ? "Ngày nghỉ cố định" : "Bấm để thêm ca"}
                  onClick={() => onEdit(emp.id, selectedDate)}
                  className={`rounded-full border px-3 py-1 text-sm ${
                    fixedDayOff
                      ? "cursor-not-allowed border-amber-200 bg-amber-50 text-amber-800"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {emp.name}
                  {emp.workRole ? ` · ${emp.workRole === "KITCHEN" ? "Bếp" : "Bồi"}` : ""}
                  {fixedDayOff ? " · nghỉ cố định" : ""}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
      <div className="text-[11px] text-slate-500 leading-tight">{label}</div>
      <div className="text-base font-semibold text-slate-900 leading-tight">{value}</div>
    </div>
  );
}
