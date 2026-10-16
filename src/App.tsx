import { useEffect, useState } from "react";
import { useSchedule } from "./hooks/useSchedule";
import { SettingsTab } from "./components/SettingsTab";
import { EmployeesTab } from "./components/EmployeesTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { StundenzettelTab } from "./components/StundenzettelTab";
import { DocsTab } from "./components/DocsTab";
import { Dashboard } from "./components/Dashboard";
import { LockScreen } from "./components/LockScreen";
import { CreateScheduleDialog } from "./components/CreateScheduleDialog";
import { isAuthenticated, logout } from "./lib/auth";

type TabId = "dienstplan" | "mitarbeiter" | "stundenzettel" | "einstellungen";

// Wie die Demo: drei Tabs für den Alltag (MAIN_TABS); Cài đặt und Tài liệu
// stecken im Menü ☰ oben rechts.
const TABS: { id: TabId; label: string }[] = [
  { id: "stundenzettel", label: "Chấm công" },
  { id: "dienstplan", label: "Lịch" },
  { id: "mitarbeiter", label: "Nhân viên" },
  { id: "einstellungen", label: "Cài đặt" },
];
const MAIN_TABS: TabId[] = ["stundenzettel", "dienstplan", "mitarbeiter"];

/** „Bản 26.09.2026 14:05 · 4e14b3f" – Zeit des Deploys in deutscher Ortszeit. */
function buildLabel(): string {
  const time = new Date(__BUILD_TIME__).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Bản ${time.replace(",", "")} · ${__BUILD_SHA__}`;
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => isAuthenticated());

  if (!unlocked) return <LockScreen onUnlock={() => setUnlocked(true)} />;
  return <MainApp onLogout={() => setUnlocked(false)} />;
}

function MainApp({ onLogout }: { onLogout: () => void }) {
  const store = useSchedule();
  const [tab, setTab] = useState<TabId>("stundenzettel");
  const [showDocs, setShowDocs] = useState(false);
  const [askCreate, setAskCreate] = useState(false);
  // Nach dem Monatswechsel erst erzeugen, wenn der Zielmonat geladen ist.
  const [pendingCreate, setPendingCreate] = useState<{ year: number; month: number } | null>(null);

  const { schedule, generate, updateMeta } = store;
  useEffect(() => {
    if (!pendingCreate) return;
    if (schedule.year !== pendingCreate.year || schedule.month !== pendingCreate.month) return;
    setPendingCreate(null);
    generate();
  }, [pendingCreate, schedule.year, schedule.month, generate]);

  const createFor = (year: number, month: number) => {
    setAskCreate(false);
    setShowDocs(false);
    setTab("dienstplan");
    if (year !== schedule.year || month !== schedule.month) updateMeta({ year, month });
    setPendingCreate({ year, month });
  };

  const [menuOpen, setMenuOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshApp = async () => {
    setRefreshing(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      // Höchstens 3 s auf die Update-Prüfung warten (schlechtes Netz).
      await Promise.race([reg?.update(), new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch {
      // egal – trotzdem neu laden
    }
    window.location.reload();
  };
  const openTab = (id: TabId) => {
    setTab(id);
    setShowDocs(false);
  };

  return (
    <div className="min-h-screen">
      {/* iPhone-App vom Home-Bildschirm (black-translucent): Inhalt unter die Statusleiste schieben. */}
      <header className="no-print bg-slate-900 text-white shadow sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-[1500px] px-3 sm:px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base sm:text-lg font-semibold" title={buildLabel()}>
              Lịch làm việc &amp; Bảng chấm công
            </h1>
            {store.remoteStatus === "error" && (
              <p className="text-xs text-rose-300">Lỗi đồng bộ — dữ liệu chỉ lưu trên máy này</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Aus dem Menü geöffnete Seite: steht direkt neben dem Menü, mit ✕ zurück. */}
            {(showDocs || !MAIN_TABS.includes(tab)) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-white py-1.5 pl-3 pr-1 text-sm font-medium text-slate-900">
                {showDocs ? "Tài liệu" : TABS.find((t) => t.id === tab)?.label}
                <button
                  type="button"
                  onClick={() => openTab("stundenzettel")}
                  aria-label="Đóng"
                  className="rounded px-1.5 text-slate-400 hover:text-slate-900"
                >
                  ✕
                </button>
              </span>
            )}
            {/* Tải lại: als App vom Home-Bildschirm gibt es keine Browserleiste zum Neuladen. */}
            <button
              type="button"
              onClick={() => void refreshApp()}
              disabled={refreshing}
              aria-label="Tải lại"
              title="Tải lại"
              className="flex h-9 w-9 items-center justify-center rounded bg-slate-700 text-lg leading-none hover:bg-slate-600 disabled:opacity-60"
            >
              <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
            </button>
            {/* Menu: alles, was nicht täglich gebraucht wird. */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
                className={`rounded px-3 py-2 text-sm font-medium ${menuOpen ? "bg-white text-slate-900" : "bg-slate-700 hover:bg-slate-600"}`}
              >
                ☰ Menu
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-sm text-slate-800 shadow-lg"
                  >
                    {(
                      [
                        ["Cài đặt", () => openTab("einstellungen")],
                        ["Tài liệu", () => setShowDocs(true)],
                        [
                          "Đăng xuất",
                          () => {
                            logout();
                            onLogout();
                          },
                        ],
                      ] as const
                    ).map(([label, action]) => (
                      <button
                        key={label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          action();
                          setMenuOpen(false);
                        }}
                        className="block w-full px-4 py-2 text-left hover:bg-slate-50"
                      >
                        {label}
                      </button>
                    ))}
                    <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">{buildLabel()}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {showDocs ? (
        <main className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 py-4">
          <DocsTab storeId={store.storeId} />
        </main>
      ) : (
        <>
          <div className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 pt-4">
            <Dashboard store={store} />
          </div>

          <nav className="no-print mx-auto max-w-[1500px] px-3 sm:px-4 mt-4">
            <div className="flex items-center gap-2">
              {/* Chấm công · Lịch · Nhân viên als Segment; rechts Tạo lịch (wie die Demo). */}
              <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
                {TABS.filter((t) => MAIN_TABS.includes(t.id)).map((t) => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => openTab(t.id)}
                      aria-current={active ? "page" : undefined}
                      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                        active ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setAskCreate(true)}
                className="ml-auto whitespace-nowrap rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 active:bg-emerald-800"
              >
                Tạo lịch
              </button>
            </div>
          </nav>

          <main className="mx-auto max-w-[1500px] px-3 sm:px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="no-print">
              {tab === "einstellungen" && <SettingsTab store={store} />}
              {tab === "mitarbeiter" && <EmployeesTab store={store} />}
              {tab === "dienstplan" && <ScheduleTab store={store} />}
            </div>
            {/* Chấm công chứa vùng in – luôn render khi tab active */}
            {tab === "stundenzettel" && <StundenzettelTab store={store} />}
          </main>
        </>
      )}

      {askCreate && (
        <CreateScheduleDialog store={store} onClose={() => setAskCreate(false)} onCreate={createFor} />
      )}
    </div>
  );
}
