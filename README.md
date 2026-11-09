# Schichtbuch

Persönliche Arbeitszeit- und Trinkgeld-Erfassung als Android-App.
Offline, ohne Konto, ohne Server — alle Daten bleiben auf dem Gerät.

---

## Warum „Schichtbuch"

Ein Schichtbuch ist das Heft, in dem Schichten, Stunden und Trinkgeld
notiert werden. Genau das macht die App — nur ohne Papier, mit Auswertung
und mit Abgleich gegen den Dienstplan.

**Kurzname:** Schichtbuch · `schichtbuch`

---

## Funktionen

| Bereich | Inhalt |
|---|---|
| **Eintragen** | Schicht erfassen: Datum, Stunden, Trinkgeld, Notiz — mit Live-Anzeige der letzten Schicht |
| **Übersicht** | Soll/Ist gegen den Dienstplan, vier Kennzahlen, Trinkgeld pro Stunde |
| **Kalender** | Monatsansicht mit Arbeits-, Urlaubs- und geplanten Tagen |
| **Verlauf** | Wochen, Monate, Erfolge, Zeitverlauf, alle Einträge |
| **Einstellungen** | Zahnrad im Header: Kalender-Link, CSV-Backup, Wochenziel |

**Dienstplan-Abgleich:** liest einen iCal-/ICS-Link (Tanda, Google Kalender,
Outlook) und vergleicht geplant gegen gearbeitet. Der Link ist nur lesbar
und wird lokal gespeichert.

**Erfolge:** Wochenziel-Ring, Streak-Zähler und 18 Achievements.

**Drill-Down:** jede Kennzahl ist antippbar und zeigt die Schichten, aus
denen sie entstanden ist.

---

## Aufbau des Projekts

```
schichtbuch/
├── src/                          ← hier wird bearbeitet
│   ├── 01-head-meta.html         Kopf: Titel, Ansicht, Meta
│   ├── 02-db-setup.js            Datenbank-Anlage (Dexie/IndexedDB)
│   ├── 03-styles.css             Farben, Abstände, Schriften, Layout
│   ├── 04-layout-body.html       Texte und Struktur der Oberfläche
│   ├── 05-app-logik.js           Funktionslogik (Rechnen, Speichern, Zeichnen)
│   ├── 99-fuss.html              Abschluss der Datei
│   ├── dexie.min.js              Bibliothek (Datenbank)
│   └── qrcode.js                 Bibliothek (QR-Code)
├── icon/                         App-Icon (SVG-Quellen)
├── tests/                        Node-Tests für Parser und Link-Normalisierung
├── build.sh                      Setzt src/index.html aus den Teilen zusammen
├── build-apk.sh                  Baut die Android-APK
├── vorschau.sh                   App im Browser ansehen
└── capacitor.config.json         App-Kennung und Name
```

`src/index.html`, `www/` und `android/` werden erzeugt und sind nicht im Repo.

---

## Entwickeln

```bash
./build.sh        # setzt die Teile aus src/ zusammen
./vorschau.sh     # startet http://localhost:8090
```

### Tests

```bash
node tests/ical-parser-test.js
node tests/ical-link-test.js
node tests/ical-rrule-test.js
```

---

## APK bauen

```bash
./build-apk.sh
```

Voraussetzungen: JDK 21, Android SDK, `npx cap` (Capacitor 7).

Beim allerersten Lauf muss einmalig das Android-Projekt angelegt werden:

```bash
npx cap add android
```

---

## Datenschutz

Die App sammelt nichts und sendet nichts. Kein Server, keine Telemetrie,
keine Konten.

- Alle Einträge liegen in der lokalen IndexedDB des Geräts
- Der iCal-Link wird lokal gespeichert und nur zum Laden des Kalenders benutzt
- CSV-Export schreibt eine Datei auf das Gerät, sonst passiert nichts

Backup über **Einstellungen → CSV exportieren**.

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
