// ============================================================================
// Die Filialen, die dieses Repo bedient. Umschalten passiert im Reiter
// „Cài đặt"; jede Filiale hat ihre eigene Zeile in der gemeinsamen Supabase-
// Tabelle (Schlüssel = id) und ihr eigenes Bundesland für die Feiertage.
// ============================================================================

import type { HolidayState } from "./holidays";

export type StoreConfig = {
  /** Schlüssel der Zeile in store_data – nach dem Anlegen NICHT mehr ändern. */
  id: string;
  name: string;
  address: string;
  /** Bundesland für die gesetzlichen Feiertage. */
  holidayState: HolidayState;
};

export const STORES: StoreConfig[] = [
  {
    id: "vietpho",
    name: "Viet Pho Restaurant",
    address: "Olgastraße 12, 89518 Heidenheim",
    holidayState: "BW",
  },
];

export const DEFAULT_STORE_ID = STORES[0].id;

/** Merkt sich die zuletzt gewählte Filiale auf diesem Gerät. */
const STORE_KEY = "stundenzettel-app:store";

export function loadStoreId(): string {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && STORES.some((s) => s.id === saved)) return saved;
  } catch {
    /* ignorieren */
  }
  return DEFAULT_STORE_ID;
}

export function saveStoreId(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* ignorieren */
  }
}

export function storeById(id: string): StoreConfig {
  return STORES.find((s) => s.id === id) ?? STORES[0];
}
