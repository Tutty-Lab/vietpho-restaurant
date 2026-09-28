# Dienstplan & Stundenzettel (MVP)

Web-App zur **automatischen Erstellung monatlicher Dienstpläne** und **druckbarer
deutscher Stundenzettel** für ein Restaurant / Geschäft in Deutschland.

- Kein Backend, keine Datenbank, keine Anmeldung, kein Solver, kein KI-Modell.
- Deterministischer, heuristischer Greedy-Algorithmus.
- Der Plan trifft **jedes monatliche Soll exakt** und lässt sich anschließend
  manuell bearbeiten.
- Persistenz über **LocalStorage**.

## Tech-Stack

React · TypeScript · Vite · Tailwind CSS · date-fns · Browser-Druck (PDF) ·
LocalStorage · Vitest.

## Installation & Start

```bash
npm install
npm run dev
```

Die App läuft danach unter der von Vite angezeigten URL (Standard
`http://localhost:5173`).

## Weitere Befehle

```bash
npm run test     # Unit-Tests (Vitest)
npm run build    # Produktions-Build (tsc + vite build)
npm run preview  # Produktions-Build lokal ansehen
```

## Bedienung

1. **Einstellungen** – Firmenname, Anschrift, Monat, Jahr; **Arbeitszeit-Fenster
   je Wochentag + Feiertag** (giờ làm; Standard: Mo–Sa 10:30–22:00, So & Feiertag
   11:30–22:00). **Feiertage (NRW)** werden automatisch erkannt und angezeigt.
   Unter **„Ngày đặc biệt"** lassen sich einzelne Tage überschreiben
   (geschlossen oder abweichende Zeiten, z.B. halber Tag).
2. **Mitarbeiter** – Vollzeit/Teilzeit und monatliche Sollstunden pflegen.
3. **Dienstplan** – **„Dienstplan erstellen"** generiert den Monatsplan.
   Zellen sind anklickbar: Zeiten/Pause ändern, als *Frei* markieren,
   Schicht verschieben, hinzufügen, löschen. **„Auf Original zurücksetzen"**
   stellt den zuletzt generierten Plan wieder her. **CSV-Export** verfügbar.
4. **Stundenzettel** – druckbarer A4-Zettel je Mitarbeiter,
   einzeln oder alle (über den Druckdialog als PDF speichern).

## Geschäftsregeln (Kurzfassung)

- Max. **8 bezahlte Stunden** pro Tag, **ein Dienst** pro Mitarbeiter und Tag.
- Höchstens **6 aufeinanderfolgende** Arbeitstage.
- **Pause:** bis einschließlich 6 h = 0 Min, über 6 h = 30 Min, ab 8 h = 60 Min
  (Pause zählt **nicht** zum Soll). Geteilter Dienst: keine Pause, aber
  mind. 1 h zwischen den Stücken.
- Nachfrage-Gewichte pro Wochentag → mehr Stunden Fr/Sa, Sonntag abends.
  **Feiertage zählen wie Sonntag** (Nachfrage + Zeitfenster).
- **Arbeitszeit-Fenster je Tag** (giờ làm): Früh am Fenster-Beginn, Spät am
  Fenster-Ende. Geschlossene Tage bekommen keine Schicht; an verkürzten Tagen
  werden nur passende (kurze) Schichten geplant.
- Schichtlängen: 4, 5, 6, 7, 8 Stunden (Vorlagen für Früh/Spät).

## Projektstruktur

```
src/
  types.ts                 zentrale Typen (intern immer Minuten als Integer)
  lib/
    time.ts                timeToMinutes, minutesToTime, calculatePause, ...
    shifts.ts              Schicht-Vorlagen (Früh/Spät)
    demand.ts              Tagesgewichte, Spätschicht-Quoten, Kalender
    splitTargetHours.ts    Zerlegung des Solls in Schichtlängen (DP)
    consecutive.ts         Ketten aufeinanderfolgender Tage, seeded RNG
    workHours.ts           Arbeitszeit-Fenster je Tag + Ausnahmen (Overrides)
    holidays.ts            NRW-Feiertage (Osterformel/Computus)
    scheduler.ts           Greedy-Scheduler + Reparaturlauf
    validation.ts          Prüfung aller Regeln
    csv.ts                 CSV-Export
    storage.ts             LocalStorage
    sampleData.ts          Testdaten (August 2026, 1022 h) – nur für Tests
    shiftOps.ts            manuelles Bearbeiten von Schichten
    dateFormat.ts          deutsche Monatsnamen / Formatierung
    __tests__/             Unit-Tests
  hooks/useSchedule.ts     zentrales State-Management + Persistenz
  components/              UI (Einstellungen, Mitarbeiter, Dienstplan, Stundenzettel)
```

## Tests

Getestet werden u. a. `timeToMinutes`, `minutesToTime`, `calculatePause`,
`calculatePaidMinutes`, `splitTargetHours`, die Berechnung aufeinanderfolgender
Tage, die Monats-Validierung sowie die **August-2026-Beispieldaten**: der Plan
muss **exakt 1022 bezahlte Stunden** verteilen und **jedes Einzelsoll** treffen.

## Hinweise / Grenzen (MVP)

- Sollstunden aktuell in **ganzen Stunden**.
- Schicht-Vorlagen sind exakt vorgegeben für 10:00–22:00; bei abweichenden
  Öffnungszeiten werden Früh-/Spät-Vorlagen generisch abgeleitet.
- Der Plan ist „operativ plausibel", nicht mathematisch optimal.
