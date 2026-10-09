import { vietphoOwnerForDate } from "../lib/vietphoOwner";
import { OwnerTimes } from "./OwnerTimes";
import { useEffect, useMemo, useState } from "react";
import { RoleBadge } from "./RoleBadge";
import { SavedSchedulesButton } from "./SavedSchedules";
import { worksDinner, worksLunch } from "../lib/shiftMeals";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import type { Shift } from "../types";
import {
  datesOfMonth,
  parseIsoDate,
  WEEKDAY_SHORT_VI,
  weekdayKeyOf,
} from "../lib/demand";
import { minutesToShortHours } from "../lib/time";
import { holidaysOf } from "../lib/holidays";
import { resolveDay } from "../lib/workHours";
import { thienlongMinStaffWindows } from "../lib/thienlongDemand";
import { signedHours } from "../lib/dateFormat";
import { monthLabel } from "../lib/shiftOps";
import { ShiftCellEditor } from "./ShiftCellEditor";
import { ScheduleDayView } from "./ScheduleDayView";
import { ValidationPanel } from "./ValidationPanel";
import { azubiCapacityReason } from "../lib/validation";
import { azubiMonthCapacityBreakdown } from "../lib/scheduler";
import { ShiftTimes } from "./ShiftTimes";
import { isEmployeeFixedDayOff } from "../lib/fixedDaysOff";
import { unavailableReason } from "../lib/availability";

function isWeekendKey(iso: string): boolean {
  const k = weekdayKeyOf(parseIsoDate(iso));
  return k === "saturday" || k === "sunday";
}

function cellClass(shift: Shift | undefined): string {
  if (!shift) return "shift-free";
  const base = shift.shiftType === "EARLY" ? "shift-early" : "shift-late";
  return `${base} ${!shift.generated ? "shift-custom" : ""}`;
}

function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ScheduleTab({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, readiness } = store;

  // Tháng này đã có lịch thì hỏi trước khi tạo lại – tránh mất lịch đã lưu.
  const dates = useMemo(
    () => datesOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  const [selected, setSelected] = useState<{ employeeId: string; date: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = localIsoDate(new Date());
    return dates.includes(today) ? today : dates[0];
  });
  // Mặc định: điện thoại -> xem theo ngày, màn lớn -> bảng tháng.
  const [view, setView] = useState<"grid" | "day">(() =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "day" : "grid",
  );

  useEffect(() => {
    if (!dates.includes(selectedDate)) {
      const today = localIsoDate(new Date());
      setSelectedDate(dates.includes(today) ? today : dates[0]);
    }
  }, [dates, selectedDate]);

  // Tra nhanh: employeeId#date -> Shift
  const shiftMap = useMemo(() => {
    const m = new Map<string, Shift>();
    for (const s of schedule.shifts) m.set(`${s.employeeId}#${s.date}`, s);
    return m;
  }, [schedule.shifts]);

  const summaryByEmp = useMemo(
    () => new Map(validation.summaries.map((s) => [s.employee.id, s] as const)),
    [validation.summaries],
  );

  const overridesByDate = useMemo(
    () => new Map(schedule.dateOverrides.map((o) => [o.date, o] as const)),
    [schedule.dateOverrides],
  );

  // Tổng theo ngày cho các dòng chân bảng: số người làm buổi trưa (có mặt trước
  // 15:00) và buổi tối (có mặt sau 17:00), tách theo Bếp/Bồi. Ca tách đôi tính
  // cho cả hai buổi.
  const roleOf = useMemo(
    () => new Map(store.monthEmployees.map((e) => [e.id, e.workRole] as const)),
    [store.monthEmployees],
  );
  const dayStats = useMemo(() => {
    type DayStat = {
      count: number;
      total: number;
      kitchenLunch: number;
      serviceLunch: number;
      kitchenDinner: number;
      serviceDinner: number;
    };
    const stats = new Map<string, DayStat>();
    for (const d of dates) {
      stats.set(d, {
        count: 0,
        total: 0,
        kitchenLunch: 0,
        serviceLunch: 0,
        kitchenDinner: 0,
        serviceDinner: 0,
      });
    }
    for (const s of schedule.shifts) {
      const st = stats.get(s.date);
      if (!st) continue;
      st.count += 1;
      st.total += s.paidMinutes;
      const role = roleOf.get(s.employeeId);
      if (worksLunch(s)) {
        if (role === "KITCHEN") st.kitchenLunch += 1;
        else if (role === "SERVICE") st.serviceLunch += 1;
      }
      if (worksDinner(s)) {
        if (role === "KITCHEN") st.kitchenDinner += 1;
        else if (role === "SERVICE") st.serviceDinner += 1;
      }
    }
    return stats;
  }, [dates, schedule.shifts, roleOf]);

  // Thienlong: Bếp/Bồi ít nhất có mặt trong từng khung giờ (lúc vắng nhất của
  // khung), để thấy ngay chỗ chỉ còn 1–2 người. `need` = mức tối thiểu theo luật.
  const isThienlong = store.storeId === "thienlong";
  const coverage = useMemo(() => {
    const result = new Map<string, Map<string, Coverage | null>>();
    if (!isThienlong) return result;
    const holidays = holidaysOf(schedule.year, schedule.holidayState);
    const overrideMap = Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o]));
    for (const d of dates) {
      const perWindow = new Map<string, Coverage | null>();
      result.set(d, perWindow);
      const day = resolveDay(schedule.workHours, d, holidays, overrideMap);
      const dayShifts = schedule.shifts.filter((s) => s.date === d);
      const weekday = weekdayKeyOf(parseIsoDate(d));
      for (const w of COVERAGE_WINDOWS) {
        const from = w.from ?? day.blocks[0]?.startMinutes ?? 0;
        let cell: Coverage | null = null;
        for (const block of day.closed ? [] : day.blocks) {
          for (let t = Math.max(from, block.startMinutes); t + 30 <= Math.min(w.to, block.endMinutes); t += 30) {
            const count = roleShiftsAt(dayShifts, roleOf, w.role, t);
            const need = thienlongMinStaffWindows(weekday, w.role).reduce(
              (max, m) => (t >= m.startMinutes && t + 30 <= m.endMinutes ? Math.max(max, m.minStaff) : max),
              0,
            );
            if (!cell) cell = { min: count, short: false, need: 0 };
            cell.min = Math.min(cell.min, count);
            if (count < need) cell.short = true;
            cell.need = Math.max(cell.need, need);
          }
        }
        perWindow.set(w.key, cell);
      }
    }
    return result;
  }, [isThienlong, dates, schedule, roleOf]);

  const ownerByDate = useMemo(() => new Map(dates.map((date) => [date,
    store.storeId === "vietpho" ? vietphoOwnerForDate(schedule, date, store.monthEmployees) : [],
  ])), [dates, schedule, store.storeId, store.monthEmployees]);

  const hasEmployees = schedule.employees.length > 0;

  return (
    <section>
      {/* Thanh thao tác */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <SavedSchedulesButton store={store} />
        <span className="ml-auto text-sm text-slate-500">{monthLabel(schedule.year, schedule.month)}</span>
      </div>


      {/* Azubi không thể đủ giờ trong tháng này – sửa nhanh bằng giờ riêng cho tháng */}
      {store.azubiCapacityIssues.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-sm px-3 py-2 space-y-2">
          {store.azubiCapacityIssues.map(({ employee, maxMinutes }) => (
            <div key={employee.id}>
              <div>
                <b>{employee.name}</b>: tháng {schedule.month}/{schedule.year} chỉ xếp được tối đa{" "}
                <b>{maxMinutes / 60}h</b> / {employee.targetMinutes / 60}h. Lịch vẫn tạo được – app xếp{" "}
                {maxMinutes / 60}h và để cảnh báo, không cần sửa.
              </div>
              <div className="mt-0.5 text-xs text-amber-800">
                <span className="font-medium">Vì sao: </span>
                {azubiCapacityReason(
                  azubiMonthCapacityBreakdown(employee, {
                    year: schedule.year,
                    month: schedule.month,
                    workHours: schedule.workHours,
                    overrides: Object.fromEntries(schedule.dateOverrides.map((o) => [o.date, o])),
                    holidayState: schedule.holidayState,
                  }),
                  employee.targetMinutes,
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!readiness.ready && (
        <div className="mb-3 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          {readiness.issues.join(" ")}
        </div>
      )}

      {/* Chuyển chế độ xem */}
      {hasEmployees && (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 mb-3">
          <button
            onClick={() => setView("day")}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "day" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Theo ngày
          </button>
          <button
            onClick={() => setView("grid")}
            className={`px-3 py-1.5 text-sm rounded-md ${
              view === "grid" ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            Bảng tháng
          </button>
        </div>
      )}

      {/* Lỗi: nhóm theo loại, có lý do + gợi ý; „Tìm cách xếp khác" thử đổi vị trí cả tháng. */}
      <ValidationPanel store={store} />

      {store.storeId === "vietpho" && (
        <p className="mb-3 text-sm text-emerald-800">
          Chủ quán làm mọi ngày mở cửa, ưu tiên Bồi; phụ Bếp khi thiếu bếp và đã có người làm Bồi.
          Các tổng nhân viên và giờ bên dưới chưa bao gồm chủ quán.
        </p>
      )}
      {/* Chú thích (chỉ ở bảng tháng) */}
      {view === "grid" && (
        <div className="flex flex-wrap gap-3 mb-2 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-early" /> Ca sáng
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-late" /> Ca tối
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-free" /> Nghỉ
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded border shift-custom bg-white" /> Đã sửa tay
          </span>
        </div>
      )}

      {!hasEmployees && store.storeId !== "vietpho" ? (
        <div className="rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
          Vui lòng thêm nhân viên trước.
        </div>
      ) : view === "day" ? (
        <ScheduleDayView
          store={store}
          selectedDate={selectedDate}
          onSelectedDateChange={setSelectedDate}
          onEdit={(employeeId, date) => setSelected({ employeeId, date })}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white -mx-3 sm:mx-0">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 bg-slate-100 border-b border-r border-slate-200 px-2 py-2 text-left min-w-[130px]">
                  Nhân viên
                </th>
                <th className="bg-slate-100 border-b border-slate-200 px-2 py-2 text-left">Loại</th>
                <th className="bg-slate-100 border-b border-slate-200 px-2 py-2 text-right">Định mức</th>
                {dates.map((d) => {
                  const day = parseIsoDate(d).getDate();
                  const wk = WEEKDAY_SHORT_VI[weekdayKeyOf(parseIsoDate(d))];
                  const ov = overridesByDate.get(d);
                  const headerBg = ov?.closed
                    ? "bg-rose-100"
                    : ov
                      ? "bg-sky-100"
                      : isWeekendKey(d)
                        ? "bg-slate-200"
                        : "bg-slate-100";
                  return (
                    <th
                      key={d}
                      title={
                        ov?.closed
                          ? `Đóng cửa${ov.note ? " · " + ov.note : ""}`
                          : ov
                            ? `Giờ riêng${ov.note ? " · " + ov.note : ""}`
                            : undefined
                      }
                      className={`border-b border-l border-slate-200 px-1 py-1 text-center min-w-[88px] ${headerBg}`}
                    >
                      <div className="font-semibold">{day}</div>
                      <div className="text-[10px] text-slate-500">{wk}</div>
                      {ov?.closed && <div className="text-[9px] text-rose-600 font-medium">Đóng cửa</div>}
                      {ov && !ov.closed && <div className="text-[9px] text-sky-700 font-medium">Giờ riêng</div>}
                    </th>
                  );
                })}
                <th className="bg-slate-100 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[64px]">
                  Đã xếp
                </th>
                <th className="bg-slate-100 border-b border-l border-slate-200 px-2 py-2 text-right min-w-[70px]">
                  Chênh lệch
                </th>
              </tr>
            </thead>
            <tbody>
              {schedule.employees.map((emp) => {
                const sum = summaryByEmp.get(emp.id);
                const diff = sum?.diffMinutes ?? -emp.targetMinutes;
                return (
                  <tr key={emp.id} className="hover:bg-slate-50/50">
                    <td className="sticky left-0 z-10 bg-white border-b border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
                      <span className="flex items-center gap-1.5">
                        {emp.name}
                        <RoleBadge role={roleOf.get(emp.id)} />
                        {roleOf.get(emp.id) !== emp.workRole && (
                          <span className="text-[10px] text-violet-600" title="Vị trí riêng tháng này">
                            tháng này
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1 text-slate-500">
                      {emp.employmentType === "VOLLZEIT"
                        ? "TT"
                        : emp.employmentType === "AZUBI"
                          ? "AZ"
                          : "BT"}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1 text-right text-slate-500">
                      {emp.targetMinutes / 60}h
                    </td>
                    {dates.map((d) => {
                      const shift = shiftMap.get(`${emp.id}#${d}`);
                      const fixedDayOff = isEmployeeFixedDayOff(emp, d);
                      const inactive = unavailableReason(emp, d);
                      return (
                        <td
                          key={d}
                          onClick={() => setSelected({ employeeId: emp.id, date: d })}
                          className={`border-b border-l border-slate-200 px-1 py-1 text-center cursor-pointer align-middle ${cellClass(
                            shift,
                          )} ${fixedDayOff && !shift ? "bg-amber-50 text-amber-800" : ""} ${
                            inactive && !shift ? "bg-slate-100 text-slate-400" : ""
                          }`}
                          title={inactive ?? (fixedDayOff ? "Ngày nghỉ cố định" : "Bấm để sửa")}
                        >
                          {shift ? (
                            <div className="leading-tight">
                              <ShiftTimes shift={shift} />
                              <div className="text-[10px] opacity-80">
                                {minutesToShortHours(shift.paidMinutes)}
                                {shift.segments?.length ? " · Ca tách đôi" : ` · Nghỉ ${shift.pauseMinutes}`}
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px]">
                              {inactive ?? (fixedDayOff ? "Nghỉ cố định" : "Nghỉ")}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="border-b border-l border-slate-200 px-2 py-1 text-right font-medium">
                      {((sum?.assignedMinutes ?? 0) / 60).toLocaleString("de-DE", {
                        maximumFractionDigits: 2,
                      })}
                      h
                    </td>
                    <td
                      className={`border-b border-l border-slate-200 px-2 py-1 text-right font-medium ${
                        diff === 0 ? "text-emerald-600" : "text-rose-600"
                      }`}
                    >
                      {signedHours(diff)}
                    </td>
                  </tr>
                );
              })}
              {store.storeId === "vietpho" && (
                <tr className="bg-emerald-50 text-emerald-900">
                  <td className="sticky left-0 z-10 bg-emerald-50 border-b border-r border-slate-200 px-2 py-2 font-medium">Chủ quán</td>
                  <td colSpan={2} className="px-2 py-1 text-center">Ưu tiên Bồi</td>
                  {dates.map((date) => (
                    <td key={date} className="border-l border-slate-200 px-1 py-2 text-center">
                      {ownerByDate.get(date)!.length > 0
                        ? <OwnerTimes segments={ownerByDate.get(date)!} /> : "Đóng cửa"}
                    </td>
                  ))}
                  <td colSpan={2} className="border-l border-slate-200 px-2 text-center">Mỗi ngày mở cửa</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <SummaryRow label="Số nhân viên" dates={dates} value={(d) => String(dayStats.get(d)!.count)} />
              <SummaryRow
                label="Tổng giờ"
                dates={dates}
                value={(d) => minutesToShortHours(dayStats.get(d)!.total)}
              />
              <SummaryRow label="Bếp trưa" dates={dates} value={(d) => String(dayStats.get(d)!.kitchenLunch)} />
              <SummaryRow label="Bồi trưa" dates={dates} value={(d) => String(dayStats.get(d)!.serviceLunch)} />
              <SummaryRow label="Bếp tối" dates={dates} value={(d) => String(dayStats.get(d)!.kitchenDinner)} />
              <SummaryRow label="Bồi tối" dates={dates} value={(d) => String(dayStats.get(d)!.serviceDinner)} />
              {isThienlong &&
                COVERAGE_WINDOWS.map((w) => (
                  <CoverageRow
                    key={w.key}
                    label={w.label}
                    dates={dates}
                    cell={(d) => coverage.get(d)?.get(w.key) ?? null}
                  />
                ))}
            </tfoot>
          </table>
        </div>
      )}

      {selected && (
        <ShiftCellEditor
          store={store}
          employeeId={selected.employeeId}
          date={selected.date}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}

function SummaryRow({
  label,
  dates,
  value,
}: {
  label: string;
  dates: string[];
  value: (d: string) => string;
}) {
  return (
    <tr className="bg-slate-50 text-slate-600">
      <td className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
        {label}
      </td>
      <td className="border-t border-slate-200" />
      <td className="border-t border-slate-200" />
      {dates.map((d) => (
        <td key={d} className="border-t border-l border-slate-200 px-1 py-1 text-center">
          {value(d)}
        </td>
      ))}
      <td className="border-t border-l border-slate-200" />
      <td className="border-t border-l border-slate-200" />
    </tr>
  );
}

type Coverage = { min: number; short: boolean; need: number };

// Khung giờ cho các dòng „ít nhất" ở chân bảng (from undefined = giờ mở cửa).
const COVERAGE_WINDOWS: {
  key: string;
  label: string;
  role: "KITCHEN" | "SERVICE";
  from?: number;
  to: number;
}[] = (
  [
    ["open", "mở cửa–12h", undefined, 12 * 60],
    ["noon", "12–14h", 12 * 60, 14 * 60],
    ["afternoon", "14–17h", 14 * 60, 17 * 60],
    ["evening", "17–20h", 17 * 60, 20 * 60],
    ["late", "20–22h", 20 * 60, 22 * 60],
  ] as const
).flatMap(([key, range, from, to]) =>
  (["KITCHEN", "SERVICE"] as const).map((role) => ({
    key: `${role}-${key}`,
    label: `${role === "KITCHEN" ? "Bếp" : "Bồi"} ${range}`,
    role,
    from,
    to,
  })),
);

function roleShiftsAt(
  shifts: Shift[],
  roleOf: Map<string, string | undefined>,
  role: "KITCHEN" | "SERVICE",
  t: number,
): number {
  return shifts.filter(
    (s) =>
      roleOf.get(s.employeeId) === role &&
      (s.segments ?? [s]).some((g) => g.startMinutes <= t && g.endMinutes >= t + 30),
  ).length;
}

/** Dòng „ít nhất x người" trong khung giờ: 1 = đỏ, 2 = vàng, thiếu luật = viền đỏ. */
function CoverageRow({
  label,
  dates,
  cell,
}: {
  label: string;
  dates: string[];
  cell: (d: string) => Coverage | null;
}) {
  return (
    <tr className="bg-slate-50 text-slate-600">
      <td className="sticky left-0 z-10 bg-slate-50 border-t border-r border-slate-200 px-2 py-1 font-medium whitespace-nowrap">
        {label} <span className="text-[11px] font-normal text-slate-400">ít nhất</span>
      </td>
      <td className="border-t border-slate-200" />
      <td className="border-t border-slate-200" />
      {dates.map((d) => {
        const c = cell(d);
        const tone = !c
          ? "text-slate-300"
          : c.min <= 1
            ? "bg-rose-50 text-rose-700 font-semibold"
            : c.min === 2
              ? "bg-amber-50 text-amber-800"
              : "";
        return (
          <td
            key={d}
            className={`border-t border-l border-slate-200 px-1 py-1 text-center ${tone} ${
              c?.short ? "outline outline-2 -outline-offset-2 outline-rose-500" : ""
            }`}
            title={c?.short ? `Thiếu: cần ít nhất ${c.need}` : undefined}
          >
            {c ? c.min : "–"}
            {c?.short && <span className="block text-[10px] leading-none">cần {c.need}</span>}
          </td>
        );
      })}
      <td className="border-t border-l border-slate-200" />
      <td className="border-t border-l border-slate-200" />
    </tr>
  );
}
