# Arbeitszeit & Trinkgeld

Persönliche Zeiterfassung als Android-App. Läuft offline, alle Daten bleiben
auf dem Gerät (IndexedDB/Dexie). Kein Backend, kein Konto, keine Cloud.

Gebaut mit Capacitor (WebView) — der gesamte Code ist HTML/CSS/JavaScript.

---

## Funktionen

| Tab | Zweck |
|---|---|
| **Eintragen** | Schicht erfassen: Datum, Stunden, Trinkgeld, Notiz |
| **Übersicht** | Soll/Ist gegen den Dienstplan, Kennzahlen, Zeitverlauf, Monatstabelle, Erfolge |
| **Kalender** | Monatsansicht mit Arbeits-, Urlaubs- und geplanten Tagen |
| **Trinkgeld** | Trinkgeld-Auswertung und Schnellerfassung |
| **Datenbank** | Alle Einträge, CSV-Import/-Export, Einstellungen |

**Analyse mit Drill-Down:** Jede Kennzahl ist antippbar und zeigt die
Schichten, aus denen sie entstanden ist — in einem Bottom Sheet.

**Dienstplan-Anbindung:** Liest einen iCal-/ICS-Link (Tanda, Google Kalender,
Outlook) und vergleicht geplant gegen gearbeitet. Der Link ist nur lesbar und
wird lokal gespeichert.

**Erfolge:** Wochenziel-Ring, Streak-Zähler und 18 Achievements.

---

## Aufbau des Projekts

```
arbeitszeit-app-src/
├── src/                          ← hier wird bearbeitet
│   ├── 01-head-meta.html         Kopf: Titel, Ansicht, Meta
│   ├── 02-db-setup.js            Datenbank-Anlage (Dexie/IndexedDB)
│   ├── 03-styles.css             Farben, Abstände, Schriften, Layout
│   ├── 04-layout-body.html       Texte und Struktur der Oberfläche
│   ├── 05-app-logik.js           Funktionslogik (Rechnen, Speichern, Zeichnen)
│   ├── 99-fuss.html              Abschluss der Datei
│   ├── dexie.min.js              Bibliothek (Datenbank)
│   └── qrcode.js                 Bibliothek (QR-Code)
├── tests/                        Node-Tests für Parser und Link-Normalisierung
├── build.sh                      Setzt src/index.html aus den Teilen zusammen
├── build-apk.sh                  Baut die Android-APK
├── vorschau.sh                   App im Browser ansehen (schnellster Weg)
└── capacitor.config.json         App-Kennung und Name
```

`src/index.html`, `www/` und `android/` werden erzeugt und sind nicht im Repo.

---

## Entwickeln

```bash
./build.sh        # setzt die Teile aus src/ zusammen
./vorschau.sh     # startet http://localhost:8090
```

Im Browser sieht die App aus wie auf dem Handy. Das ist der schnelle Weg —
kein Handy, kein APK-Bau nötig.

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

Ergebnis liegt als `../arbeitszeit-app-NEU.apk`.

> Beim Installieren über eine bestehende Version: gleiche Signatur vorausgesetzt,
> wird die App als **Update** installiert und die Daten bleiben erhalten.

---

## Datenschutz

Die App sammelt nichts und sendet nichts. Es gibt keinen Server, keine
Telemetrie und keine Konten.

- Alle Einträge liegen in der lokalen IndexedDB des Geräts
- Der iCal-Link wird lokal gespeichert und nur zum Laden des Kalenders benutzt
- CSV-Export schreibt eine Datei auf das Gerät, sonst passiert nichts

Ein Backup macht man über **Einstellungen → CSV exportieren**.

---

## Lizenz

MIT — siehe [LICENSE](LICENSE).
