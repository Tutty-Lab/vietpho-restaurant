/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Ohne @types/node: nur die Umgebungsvariablen, die Vercel beim Build setzt.
declare const process: { env: Record<string, string | undefined> };

// Version im Kopf der App: Build-Zeitpunkt + Commit (Vercel setzt die SHA).
const BUILD_TIME = new Date().toISOString();
const BUILD_SHA = (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7);

export default defineConfig({
  // Die Vercel-Integration von Supabase legt die öffentlichen Schlüssel unter
  // NEXT_PUBLIC_* an (Next.js-Konvention). Dieses Projekt läuft auf Vite, das
  // sonst nur VITE_* an den Browser durchreicht – daher beide Präfixe erlauben.
  // Achtung: NEXT_PUBLIC_*/VITE_* landen im öffentlichen Bundle. Niemals
  // Service-Role-Key oder Postgres-Passwort so benennen.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  define: {
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __BUILD_SHA__: JSON.stringify(BUILD_SHA),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Lịch làm việc & Bảng chấm công",
        short_name: "Lịch làm việc",
        description:
          "Tạo lịch làm việc hàng tháng và in bảng chấm công (Stundenzettel) cho cửa hàng ở Đức.",
        lang: "vi",
        dir: "ltr",
        theme_color: "#0f172a",
        background_color: "#f1f5f9",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // index.html NICHT vorab cachen und nicht als navigateFallback ausliefern:
        // sonst startet die App vom Home-Bildschirm (iPhone) immer mit der ALTEN
        // Seite aus dem Cache, und ein Deploy kam erst nach Löschen/Neu-Anheften an.
        // Stattdessen holt jede Navigation die Seite zuerst vom Netz (NetworkFirst),
        // offline gilt die zuletzt geladene Kopie.
        globPatterns: ["**/*.{js,css,svg,woff2}"],
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === "navigate",
            handler: "NetworkFirst",
            options: { cacheName: "pages", networkTimeoutSeconds: 4 },
          },
        ],
        // Neue Version SOFORT übernehmen statt erst, wenn alle Tabs zu sind.
        // Sonst servierte der Service-Worker nach einem Deploy weiter die ALTE
        // App aus dem Cache – Korrekturen (PDF-Tabelle, Druck-Fußzeile …) kamen
        // beim Nutzer erst Tage später an. Mit skipWaiting/clientsClaim aktiviert
        // sich die neue Version beim nächsten Laden und lädt einmal frisch nach.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
