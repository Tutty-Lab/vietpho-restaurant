// ============================================================================
// Zentrales State-Management (ohne externe Bibliothek). Kapselt Schedule,
// LocalStorage-Persistenz und alle Aktionen (Generieren, Bearbeiten, Reset).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Employee, Schedule, Shift, ShiftSegment } from "../types";
import { azubiMonthCapacityMinutes, generateSchedule } from "../lib/scheduler";
import { validateSchedule, type ValidationResult } from "../lib/validation";
import { clearState, loadState, saveState, type PersistedState } from "../lib/storage";
import { isRemoteConfigured, loadRemote, saveRemote, type RemoteStatus } from "../lib/remote";
import { createManualShift, updateShiftPieces } from "../lib/shiftOps";
import {
  defaultWorkHoursForStore,
  normalizeWorkHours,
  workHoursVersionForStore,
  type DateOverride,
  type OverrideMap,
} from "../lib/workHours";
import { loadStoreId, saveStoreId, storeById, type StoreConfig } from "../lib/stores";
import {
  defaultAzubiConfig,
  withAutomaticAzubiTarget,
} from "../lib/azubi";
import { checkScheduleReadiness } from "../lib/readiness";
import {
  DEFAULT_SURCHARGE_CONFIG,
  normalizeSurchargeConfig,
} from "../lib/zuschlaege";
import { isEmployeeFixedDayOff, normalizedFixedDaysOff } from "../lib/fixedDaysOff";
import { withEmploymentPeriodTarget } from "../lib/employmentPeriod";
import { isEmployeeAvailableOn } from "../lib/availability";
import { withMonthRoles } from "../lib/roleCoverage";
import { applyRoleChanges, type RoleChange } from "../lib/suggestions";
import { listSavedMonths, mergeArchives, monthKey, switchMonth } from "../lib/monthArchive";

function emptySchedule(store: StoreConfig): Schedule {
  const now = new Date();
  const hoursVersion = workHoursVersionForStore(store.id);
  return {
    companyName: store.name,
    address: store.address,
    holidayState: store.holidayState,
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    hoursVersion,
    workHours: defaultWorkHoursForStore(store.id),
    surchargeConfig: { ...DEFAULT_SURCHARGE_CONFIG },
    dateOverrides: [],
    employees: [],
    shifts: [],
  };
}

/** Ausnahmen-Array -> nach Datum indizierte Map (für den Scheduler). */
function overridesToMap(list: DateOverride[]): OverrideMap {
  const map: OverrideMap = {};
  for (const ov of list) map[ov.date] = ov;
  return map;
}

function normalizeEmployee(employee: Employee, year: number, month: number): Employee {
  // „Lịch 2 quán" gibt es nicht mehr – Altdaten verlieren das Feld beim Laden.
  const { fixedStoreWeekPattern: _removed, ...rest } = employee as Employee & {
    fixedStoreWeekPattern?: boolean;
  };
  return withEmploymentPeriodTarget(
    withAutomaticAzubiTarget(normalizedFixedDaysOff(rest), year, month),
    year,
    month,
  );
}

/** Migriert einen (evtl. alten) gespeicherten Stand auf das aktuelle Schema. */
function normalizeSchedule(raw: Schedule | undefined, store: StoreConfig): Schedule {
  const base = emptySchedule(store);
  if (!raw) return base;
  const year = raw.year ?? base.year;
  const month = raw.month ?? base.month;
  const hoursVersion = workHoursVersionForStore(store.id);
  return {
    // Name, Adresse und Bundesland kommen IMMER aus stores.ts – so kann ein
    // alter Speicherstand nicht die Daten der falschen Filiale mitschleppen.
    companyName: store.name,
    address: store.address,
    holidayState: store.holidayState,
    hoursVersion,
    year,
    month,
    // Ältere Stände haben noch die alten Öffnungszeiten (Mo–Do ohne
    // Mittagsschließung, Sa ab 11:00). Einmalig auf die aktuelle Vorgabe
    // heben – sonst verdeckt der gespeicherte Stand die neuen Zeiten für immer.
    workHours:
      raw.hoursVersion === hoursVersion
        ? normalizeWorkHours(raw.workHours, defaultWorkHoursForStore(store.id))
        : defaultWorkHoursForStore(store.id),
    surchargeConfig: normalizeSurchargeConfig(raw.surchargeConfig),
    dateOverrides: Array.isArray(raw.dateOverrides) ? raw.dateOverrides : [],
    employees: (raw.employees ?? []).map((employee) =>
      normalizeEmployee(employee, year, month),
    ),
    shifts: raw.shifts ?? [],
    archive: raw.archive && typeof raw.archive === "object" ? raw.archive : {},
  };
}

function newEmployeeId(): string {
  return `emp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

export function useSchedule() {
  const [storeId, setStoreIdState] = useState<string>(() => loadStoreId());
  const storeConfig = storeById(storeId);

  const [schedule, setSchedule] = useState<Schedule>(() => {
    const persisted = loadState(storeId);
    return normalizeSchedule(persisted?.schedule, storeById(storeId));
  });
  const [originalShifts, setOriginalShifts] = useState<Shift[]>(
    () => loadState(storeId)?.originalShifts ?? [],
  );
  const [genError, setGenError] = useState<string | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>(
    isRemoteConfigured ? "idle" : "off",
  );

  // Nach „Xoá dữ liệu" darf das Zusammenführen die alten Monate nicht zurückholen.
  const skipArchiveMerge = useRef(false);

  // Immer sofort lokal sichern – das ist der Offline-Puffer, je Filiale getrennt.
  // Vorher gespeicherte Monate aus dem LocalStorage übernehmen (anderer Tab),
  // damit ein veralteter Tab nie einen gespeicherten Monat löscht.
  useEffect(() => {
    const merged = mergeArchives(schedule, loadState(storeId)?.schedule);
    if (merged !== schedule) {
      setSchedule(merged); // speichert im nächsten Durchlauf
      return;
    }
    saveState(storeId, { schedule, originalShifts });
  }, [storeId, schedule, originalShifts]);

  // Letzter Stand für Zugriffe außerhalb des Renders (siehe Erst-Upload).
  const latest = useRef<PersistedState>({ schedule, originalShifts });
  useEffect(() => {
    latest.current = { schedule, originalShifts };
  }, [schedule, originalShifts]);

  // Stand der AKTUELLEN Filiale aus der gemeinsamen Datenbank holen – auch
  // nach jedem Umschalten. Vorher darf nicht hochgeladen werden, sonst
  // überschreibt der lokale (evtl. leere) Stand die Daten in der Datenbank.
  const hydrated = useRef(!isRemoteConfigured);
  useEffect(() => {
    if (!isRemoteConfigured) return;
    hydrated.current = false;
    let cancelled = false;
    (async () => {
      try {
        const remote = await loadRemote(storeId);
        if (cancelled) return;
        if (remote?.schedule) {
          setSchedule(normalizeSchedule(remote.schedule, storeById(storeId)));
          setOriginalShifts(remote.originalShifts ?? []);
        } else {
          // Noch keine Zeile für diese Filiale: lokalen Stand hochladen.
          await saveRemote(storeId, latest.current);
        }
        if (!cancelled) setRemoteStatus("idle");
      } catch {
        if (!cancelled) setRemoteStatus("error");
      } finally {
        if (!cancelled) hydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storeId]);

  // Änderungen gebündelt hochladen (nicht bei jedem Tastendruck).
  useEffect(() => {
    if (!isRemoteConfigured || !hydrated.current) return;
    const timer = window.setTimeout(() => {
      setRemoteStatus("saving");
      (async () => {
        // Gespeicherte Monate anderer Geräte behalten (Archiv zusammenführen).
        const skip = skipArchiveMerge.current;
        skipArchiveMerge.current = false;
        const remote = skip ? null : await loadRemote(storeId).catch(() => null);
        const merged = mergeArchives(schedule, remote?.schedule);
        await saveRemote(storeId, { schedule: merged, originalShifts });
        if (merged !== schedule) setSchedule((cur) => mergeArchives(cur, remote?.schedule));
      })()
        .then(() => setRemoteStatus("idle"))
        .catch(() => setRemoteStatus("error"));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [storeId, schedule, originalShifts]);

  /** Filiale wechseln: lokalen Stand der neuen Filiale zeigen, dann laden. */
  const setStoreId = useCallback((next: string) => {
    if (next === storeIdRef.current) return;
    saveStoreId(next);
    const cached = loadState(next);
    setSchedule(normalizeSchedule(cached?.schedule, storeById(next)));
    setOriginalShifts(cached?.originalShifts ?? []);
    setGenError(null);
    setStoreIdState(next);
  }, []);

  // Aktuelle Id ohne Neuanlage des Callbacks lesbar halten.
  const storeIdRef = useRef(storeId);
  useEffect(() => {
    storeIdRef.current = storeId;
  }, [storeId]);

  // In der Schulzeit gilt fuer Azubis 0 h. Ausserhalb kommt das Monatssoll aus
  // der Chef-Eingabe. Bei Modus- oder Konfigurationswechsel wird es nachgezogen.
  useEffect(() => {
    setSchedule((s) => {
      let changed = false;
      const employees = s.employees.map((e) => {
        const next = withEmploymentPeriodTarget(
          withAutomaticAzubiTarget(e, s.year, s.month),
          s.year,
          s.month,
        );
        if (next !== e) changed = true;
        return next;
      });
      return changed ? { ...s, employees } : s;
    });
  }, [schedule.year, schedule.month, schedule.employees]);

  // Rolle dieses Monats (Làm được cả Bếp và Bồi → roleByMonth) für Prüfung/Anzeige.
  const monthEmployees = useMemo(
    () => withMonthRoles(schedule.employees, schedule.year, schedule.month),
    [schedule.employees, schedule.year, schedule.month],
  );
  const validation: ValidationResult = useMemo(
    () => validateSchedule(monthEmployees, schedule.shifts, {
      year: schedule.year,
      month: schedule.month,
      workHours: schedule.workHours,
      holidayState: schedule.holidayState,
      storeId,
      overrides: overridesToMap(schedule.dateOverrides),
    }),
    [schedule, storeId, monthEmployees],
  );
  const readiness = useMemo(
    () =>
      checkScheduleReadiness(schedule.employees, {
        requireWorkRole: storeId === "thienlong" || storeId === "vietpho",
        requireFixedDaysOff: storeId === "thienlong" || storeId === "vietpho",
        storeId,
        year: schedule.year,
        month: schedule.month,
      }),
    [schedule.employees, storeId, schedule.year, schedule.month],
  );

  /**
   * Azubis, deren Monatssoll in diesem Monat wegen der Wochendecke gar nicht
   * erreichbar ist (z.B. Sept 2026: max. 168 h statt 174 h).
   */
  const azubiCapacityIssues = useMemo(() => {
    if (storeId !== "thienlong") return [];
    return schedule.employees
      .filter((e) => e.employmentType === "AZUBI" && e.targetMinutes > 0)
      .map((e) => ({
        employee: e,
        maxMinutes: azubiMonthCapacityMinutes(e, {
          year: schedule.year,
          month: schedule.month,
          workHours: schedule.workHours,
          overrides: overridesToMap(schedule.dateOverrides),
          holidayState: schedule.holidayState,
        }),
      }))
      .filter((x) => x.maxMinutes < x.employee.targetMinutes);
  }, [schedule.employees, schedule.year, schedule.month, schedule.workHours, schedule.dateOverrides, schedule.holidayState, storeId]);

  /** Giờ riêng cho MỘT tháng đi làm của Azubi (không đổi mức chung). */
  const setAzubiWorkMonthHours = useCallback(
    (employeeId: string, year: number, month: number, hours: number | null) => {
      setSchedule((s) => ({
        ...s,
        employees: s.employees.map((e) => {
          if (e.id !== employeeId || e.employmentType !== "AZUBI") return e;
          const cfg = e.azubi ?? defaultAzubiConfig();
          const key = monthKey(year, month);
          const next = { ...(cfg.workMonthHoursByMonth ?? {}) };
          if (hours === null) delete next[key];
          else next[key] = Math.max(0, hours);
          return normalizeEmployee(
            {
              ...e,
              azubi: {
                ...cfg,
                workMonthHoursByMonth: Object.keys(next).length > 0 ? next : undefined,
              },
            },
            s.year,
            s.month,
          );
        }),
      }));
    },
    [],
  );

  // ----- Firma / Monat / Öffnungszeiten -----
  const updateMeta = useCallback((patch: Partial<Schedule>) => {
    const { schedule: s, originalShifts: original } = latest.current;
    const nextYear = patch.year ?? s.year;
    const nextMonth = patch.month ?? s.month;
    if (nextYear === s.year && nextMonth === s.month) {
      setSchedule((cur) => ({ ...cur, ...patch }));
      return;
    }
    // Monatswechsel: aktuellen Plan ablegen, gespeicherten Plan des Zielmonats laden.
    const next = switchMonth(s, original, nextYear, nextMonth);
    const schedulePatched = { ...next.schedule, ...patch };
    latest.current = { schedule: schedulePatched, originalShifts: next.originalShifts };
    setSchedule(schedulePatched);
    setOriginalShifts(next.originalShifts);
    setGenError(null);
  }, []);

  /** Alle Monate mit gespeichertem Plan (inkl. des aktuell geöffneten). */
  const savedMonths = useMemo(() => listSavedMonths(schedule), [schedule]);

  // ----- Mitarbeiter -----
  const addEmployee = useCallback(
    (data: Omit<Employee, "id">): string => {
      const id = newEmployeeId();
      setSchedule((s) => {
        const azubi =
          data.employmentType === "AZUBI" ? data.azubi ?? defaultAzubiConfig() : undefined;
        const emp: Employee = normalizeEmployee(
          {
            ...data,
            id,
            name: data.name.trim() || "Neuer Mitarbeiter",
            azubi,
            // Vollzeit/Azubi brauchen feste Ruhetage; Teilzeit nicht.
            fixedDaysOff:
              data.employmentType === "TEILZEIT" ? undefined : data.fixedDaysOff ?? [],
          },
          s.year,
          s.month,
        );
        return { ...s, employees: [...s.employees, emp] };
      });
      return id;
    },
    [storeId],
  );

  const updateEmployee = useCallback((id: string, patch: Partial<Employee>) => {
    setSchedule((s) => ({
      ...s,
      employees: s.employees.map((e) =>
        e.id === id
          ? normalizeEmployee({ ...e, ...patch }, s.year, s.month)
          : e,
      ),
    }));
  }, [storeId]);

  const removeEmployee = useCallback((id: string) => {
    setSchedule((s) => ({
      ...s,
      employees: s.employees.filter((e) => e.id !== id),
      shifts: s.shifts.filter((sh) => sh.employeeId !== id),
    }));
  }, []);

  // ----- Generierung -----
  /** Plan erzeugen – optional mit geänderten Mitarbeitern (z. B. Rollenwechsel für den Monat). */
  const generateFor = useCallback(
    (employees: Employee[]) => {
      setGenError(null);
      if (!readiness.ready) {
        setGenError(readiness.issues.join(" "));
        return;
      }
      try {
        const shifts = generateSchedule({
          year: schedule.year,
          month: schedule.month,
          storeId,
          workHours: schedule.workHours,
          overrides: overridesToMap(schedule.dateOverrides),
          // Direkt nach einem Monatswechsel sind die Monats-Solls (Azubi,
          // Ein-/Austritt) evtl. noch nicht nachgezogen – hier sicher berechnen.
          employees: withMonthRoles(
            employees.map((e) => normalizeEmployee(e, schedule.year, schedule.month)),
            schedule.year,
            schedule.month,
          ),
          holidayState: schedule.holidayState,
        });
        setSchedule((s) => ({ ...s, employees, shifts }));
        setOriginalShifts(shifts.map((sh) => ({ ...sh })));
      } catch (err) {
        setGenError(err instanceof Error ? err.message : String(err));
      }
    },
    [
      schedule.year,
      schedule.month,
      storeId,
      schedule.workHours,
      schedule.dateOverrides,
      schedule.holidayState,
      readiness,
    ],
  );
  const generate = useCallback(() => generateFor(schedule.employees), [generateFor, schedule.employees]);

  /** Vorschlag „Tìm cách xếp khác" übernehmen: Rollen für den Monat setzen und neu planen. */
  const applyRoleChangesAndGenerate = useCallback(
    (changes: RoleChange[]) =>
      generateFor(applyRoleChanges(schedule.employees, changes, schedule.year, schedule.month)),
    [generateFor, schedule.employees, schedule.year, schedule.month],
  );

  /** Für „Tìm cách xếp khác": Kontext wie beim Erzeugen. */
  const suggestionContext = useMemo(
    () => ({
      year: schedule.year,
      month: schedule.month,
      storeId,
      workHours: schedule.workHours,
      overrides: overridesToMap(schedule.dateOverrides),
      holidayState: schedule.holidayState,
      employees: schedule.employees.map((e) => normalizeEmployee(e, schedule.year, schedule.month)),
    }),
    [schedule.year, schedule.month, storeId, schedule.workHours, schedule.dateOverrides, schedule.holidayState, schedule.employees],
  );

  const resetToOriginal = useCallback(() => {
    setSchedule((s) => ({ ...s, shifts: originalShifts.map((sh) => ({ ...sh })) }));
  }, [originalShifts]);

  const resetAll = useCallback(() => {
    clearState(storeId);
    skipArchiveMerge.current = true;
    setSchedule(emptySchedule(storeById(storeId)));
    setOriginalShifts([]);
    setGenError(null);
  }, []);

  const saveNow = useCallback(() => {
    saveState(storeId, { schedule, originalShifts });
  }, [schedule, originalShifts]);

  // ----- Ausnahmen je Datum -----
  const upsertOverride = useCallback((override: DateOverride) => {
    setSchedule((s) => {
      const rest = s.dateOverrides.filter((o) => o.date !== override.date);
      const next = [...rest, override].sort((a, b) => a.date.localeCompare(b.date));
      return { ...s, dateOverrides: next };
    });
  }, []);

  const removeOverride = useCallback((date: string) => {
    setSchedule((s) => ({
      ...s,
      dateOverrides: s.dateOverrides.filter((o) => o.date !== date),
    }));
  }, []);

  // ----- Schicht-Bearbeitung -----
  const findShift = useCallback(
    (employeeId: string, date: string): Shift | undefined =>
      schedule.shifts.find((s) => s.employeeId === employeeId && s.date === date),
    [schedule.shifts],
  );

  /** Zeiten einer Schicht ändern: 1 Stück oder ca gãy (2 Stücke). */
  const editShiftPieces = useCallback(
    (shiftId: string, pieces: ShiftSegment[], pauseMinutes: number) => {
      setSchedule((s) => ({
        ...s,
        shifts: s.shifts.map((sh) => (sh.id === shiftId ? updateShiftPieces(sh, pieces, pauseMinutes) : sh)),
      }));
    },
    [],
  );

  const addShift = useCallback(
    (employeeId: string, date: string, pieces: ShiftSegment[], pause: number) => {
      setSchedule((s) => {
        const exists = s.shifts.some((sh) => sh.employeeId === employeeId && sh.date === date);
        if (exists) return s;
        const employee = s.employees.find((candidate) => candidate.id === employeeId);
        if (employee && (isEmployeeFixedDayOff(employee, date) || !isEmployeeAvailableOn(employee, date))) {
          return s;
        }
        return { ...s, shifts: [...s.shifts, createManualShift(employeeId, date, pieces, pause)] };
      });
    },
    [storeId],
  );

  const deleteShift = useCallback((shiftId: string) => {
    setSchedule((s) => ({ ...s, shifts: s.shifts.filter((sh) => sh.id !== shiftId) }));
  }, []);

  /** Markiert einen Tag als "Frei": entfernt eine bestehende Schicht. */
  const setFrei = useCallback((employeeId: string, date: string) => {
    setSchedule((s) => ({
      ...s,
      shifts: s.shifts.filter((sh) => !(sh.employeeId === employeeId && sh.date === date)),
    }));
  }, []);

  /** Verschiebt eine Schicht zu einem anderen Mitarbeiter (gleicher Tag). */
  const moveShiftToEmployee = useCallback((shiftId: string, targetEmployeeId: string) => {
    setSchedule((s) => {
      const shift = s.shifts.find((sh) => sh.id === shiftId);
      if (!shift) return s;
      const conflict = s.shifts.some(
        (sh) => sh.employeeId === targetEmployeeId && sh.date === shift.date,
      );
      if (conflict) return s;
      const targetEmployee = s.employees.find((employee) => employee.id === targetEmployeeId);
      if (
        targetEmployee &&
        (isEmployeeFixedDayOff(targetEmployee, shift.date) || !isEmployeeAvailableOn(targetEmployee, shift.date))
      ) {
        return s;
      }
      return {
        ...s,
        shifts: s.shifts.map((sh) =>
          sh.id === shiftId ? { ...sh, employeeId: targetEmployeeId, generated: false } : sh,
        ),
      };
    });
  }, [storeId]);

  return {
    schedule,
    originalShifts,
    validation,
    readiness,
    genError,
    hasOriginal: originalShifts.length > 0,
    updateMeta,
    savedMonths,
    azubiCapacityIssues,
    setAzubiWorkMonthHours,
    addEmployee,
    updateEmployee,
    removeEmployee,
    generate,
    resetToOriginal,
    resetAll,
    storeId,
    storeConfig,
    setStoreId,
    remoteStatus,
    isRemoteConfigured,
    saveNow,
    upsertOverride,
    removeOverride,
    findShift,
    editShiftPieces,
    addShift,
    monthEmployees,
    applyRoleChangesAndGenerate,
    suggestionContext,
    deleteShift,
    setFrei,
    moveShiftToEmployee,
  };
}

export type UseScheduleReturn = ReturnType<typeof useSchedule>;
