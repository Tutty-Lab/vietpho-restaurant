import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// PWA: Service Worker registrieren (Auto-Update, funktioniert offline).
// Die App vom Home-Bildschirm wird von iOS meist nur „aufgeweckt", nicht neu
// gestartet – dann prüft der Browser nie auf eine neue Version. Deshalb selbst
// prüfen: beim Zurückkehren in die App und alle 30 Minuten. Findet sich eine
// neue Version, lädt autoUpdate die Seite von allein neu.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.setInterval(check, 30 * 60 * 1000);
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
