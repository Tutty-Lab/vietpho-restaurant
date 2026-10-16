import type { UseScheduleReturn } from "../hooks/useSchedule";
import { minutesToDecimalHours } from "../lib/time";

export function Dashboard({ store }: { store: UseScheduleReturn }) {
  const { schedule, validation, readiness } = store;
  const vz = schedule.employees.filter((e) => e.employmentType === "VOLLZEIT").length;
  const tz = schedule.employees.filter((e) => e.employmentType === "TEILZEIT").length;
  const az = schedule.employees.filter((e) => e.employmentType === "AZUBI").length;
  const targetMin = schedule.employees.reduce((s, e) => s + e.targetMinutes, 0);
  const plannedMin = schedule.shifts.reduce((s, x) => s + x.paidMinutes, 0);
  const notGenerated = schedule.shifts.length === 0;

  const warnings = validation.errors.filter((e) => e.severity === "warning").length;
  const realErrors = validation.errors.length - warnings;
  const statusValue = notGenerated
    ? readiness.ready
      ? "Sẵn sàng"
      : "Chưa sẵn sàng"
    : validation.valid
      ? warnings > 0
        ? `Hợp lệ · ${warnings} cảnh báo`
        : "Hợp lệ"
      : `${realErrors} lỗi${warnings > 0 ? ` · ${warnings} cảnh báo` : ""}`;
  const statusAccent = notGenerated
    ? readiness.ready
      ? "text-emerald-600"
      : "text-amber-600"
    : validation.valid
      ? "text-emerald-600"
      : "text-rose-600";

  const pct = targetMin > 0 ? Math.min(100, Math.round((plannedMin / targetMin) * 100)) : 0;
  const statusPill =
    statusAccent === "text-emerald-600"
      ? "bg-emerald-50 text-emerald-700"
      : statusAccent === "text-rose-600"
        ? "bg-rose-50 text-rose-700"
        : "bg-amber-50 text-amber-700";

  return (
    <div>
      {/* Eine Karte statt der Zahlenkacheln (wie die Demo): Stunden als Balken. */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-slate-500">
            Giờ đã xếp · {schedule.employees.length} người ({vz} TT · {tz} BT · {az} Azubi)
          </span>
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill}`}>{statusValue}</span>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold text-slate-900">{minutesToDecimalHours(plannedMin)}</span>
          <span className="text-sm text-slate-500">/ {minutesToDecimalHours(targetMin)} h định mức</span>
          <span className="ml-auto text-sm font-semibold text-slate-500">{pct}%</span>
        </div>
        <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="bg-slate-700" style={{ width: `${pct}%` }} />
          {plannedMin > 0 && pct < 100 && <div className="bg-amber-300" style={{ width: `${100 - pct}%` }} />}
        </div>
      </div>
      {notGenerated && readiness.ready && (
        <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-3 py-2">
          Cấu hình đã đầy đủ — bấm Tạo lịch.
        </div>
      )}
      {notGenerated && !readiness.ready && (
        <div className="mt-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
          <div className="font-medium">Cần hoàn tất cấu hình trước khi tạo lịch:</div>
          <ul className="mt-1 list-disc pl-5">
            {readiness.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
