import { useMemo, useState } from "react";
import type { UseScheduleReturn } from "../hooks/useSchedule";
import { StundenUebersichtPage, StundenzettelPage } from "./StundenzettelPage";
import { SavedSchedulesButton } from "./SavedSchedules";
import { exportStundenzettelPdf, safeFileName } from "../lib/pdf";
import { weeksOfMonth } from "../lib/weeks";

export function StundenzettelTab({ store }: { store: UseScheduleReturn }) {
  const { schedule } = store;
  const weeks = useMemo(
    () => weeksOfMonth(schedule.year, schedule.month),
    [schedule.year, schedule.month],
  );
  // who: "all" = ganzer Laden, sonst eine employeeId.
  // what: "stundenzettel" (Monat) | "sz-<weekStart>" (Woche).
  const [who, setWho] = useState<string>("all");
  const [what, setWhat] = useState<string>("stundenzettel");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const chosenEmployees =
    who === "all" ? schedule.employees : schedule.employees.filter((e) => e.id === who);
  const previewEmployee =
    who === "all" ? schedule.employees[0] ?? null : chosenEmployees[0] ?? null;
  const whoTag = who === "all" ? "tat_ca" : safeFileName(previewEmployee?.name ?? who);

  const monthTag = `${schedule.year}-${String(schedule.month).padStart(2, "0")}`;
  // Ohne erzeugten Dienstplan gibt es nichts zu exportieren.
  const hasSchedule = schedule.shifts.length > 0;

  // Wochen-Stundenzettel: nur die Tage dieser Woche, mit Wochentitel oben rechts.
  function szWeekFor(weekStart: string): { dates: string[]; label: string } | null {
    const w = weeks.find((x) => x.weekStart === weekStart);
    if (!w) return null;
    return { dates: w.dates, label: `Woche ${w.label}${schedule.year}` };
  }

  async function handleExport() {
    if (pdfBusy || !hasSchedule) return;
    setPdfBusy(true);
    setProgress(null);
    try {
      if (what.startsWith("sz-")) {
        const weekStart = what.slice(3);
        const sz = szWeekFor(weekStart);
        if (sz) {
          await exportStundenzettelPdf({
            schedule,
            employees: chosenEmployees,
            filename: `Stundenzettel_${whoTag}_${monthTag}_tuan_${weekStart}.pdf`,
            dates: sz.dates,
            periodLabel: sz.label,
            onProgress: (done, total) => setProgress({ done, total }),
          });
        }
      } else {
        await exportStundenzettelPdf({
          schedule,
          employees: chosenEmployees,
          filename: `Stundenzettel_${whoTag}_${monthTag}.pdf`,
          onProgress: (done, total) => setProgress({ done, total }),
        });
      }
    } catch (err) {
      alert(`Không tạo được PDF: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPdfBusy(false);
      setProgress(null);
    }
  }

  if (schedule.employees.length === 0) {
    return (
      <div className="rounded bg-white border border-slate-200 p-6 text-center text-slate-400">
        Vui lòng thêm nhân viên và tạo lịch làm việc trước.
      </div>
    );
  }

  const progressLabel =
    progress && progress.total > 1 ? `Đang tạo PDF… ${progress.done}/${progress.total}` : "Đang tạo PDF…";

  return (
    <>
      {/* Tháng đang xem + mở lại bảng chấm công của tháng đã lưu */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-slate-600">
          Đang xem: <b>Tháng {schedule.month}/{schedule.year}</b>
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SavedSchedulesButton store={store} />
        </div>
      </div>

      {/* ---- Xuất PDF ---- */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 mb-4">
        <div className="text-sm font-medium text-slate-700 mb-2">Xuất bảng chấm công (PDF)</div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Cho ai</span>
            <select
              className="rounded border border-slate-300 px-2 py-2 text-sm min-w-[10rem]"
              value={who}
              onChange={(e) => setWho(e.target.value)}
            >
              <option value="all">Tất cả (cả quán)</option>
              {schedule.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Thời gian</span>
            <select
              className="rounded border border-slate-300 px-2 py-2 text-sm min-w-[14rem]"
              value={what}
              onChange={(e) => setWhat(e.target.value)}
            >
              <option value="stundenzettel">Cả tháng</option>
              {weeks.map((w) => (
                <option key={`sz-${w.weekStart}`} value={`sz-${w.weekStart}`}>
                  Tuần {w.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pdfBusy || !hasSchedule}
              onClick={() => void handleExport()}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 active:bg-slate-800 disabled:opacity-40"
            >
              ⬇ Xuất PDF
            </button>
            {pdfBusy && <span className="text-sm text-slate-500">{progressLabel}</span>}
            {!hasSchedule && !pdfBusy && (
              <span className="text-sm text-amber-600">Chưa có lịch — hãy tạo lịch trước.</span>
            )}
          </div>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          <b>Bảng chấm công (Stundenaufzeichnung)</b> theo mẫu tiếng Đức để nộp — một tờ mỗi người,
          cả tháng hoặc theo tuần. File .pdf tải thẳng về máy (kẻ bảng nét, không có ngày in / đường
          link).
        </p>
      </div>

      {/* Wie Seite 1 der PDF: Übersicht vor dem Einzelblatt. */}
      {chosenEmployees.length > 0 && (
        <>
          <div className="mb-1 text-xs text-slate-500">Trang 1 của file PDF: bảng tổng hợp giờ</div>
          <div className="mb-4 rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
            <StundenUebersichtPage schedule={schedule} employees={chosenEmployees} />
          </div>
        </>
      )}

      {/* Xem trước trên màn hình cho nhân viên đã chọn */}
      {previewEmployee && (
        <>
          <div className="mb-1 text-xs text-slate-500">
            Xem trước bảng chấm công: <b>{previewEmployee.name}</b>
            {who === "all" && " (chọn một người ở ô „Cho ai“ để xem người khác)"}
          </div>
          <div className="rounded-lg border border-slate-300 shadow-sm bg-white overflow-x-auto">
            <StundenzettelPage schedule={schedule} employee={previewEmployee} />
          </div>
        </>
      )}
    </>
  );
}
