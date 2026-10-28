# Arbeitszeit-App — Quellcode zum Selberbearbeiten

Diese Struktur ist aus der APK `arbeitszeit-app-v2.3.apk` (15.10.2026) zurückgewonnen.
Alles, was in der App passiert, steckt in den Dateien unter `src/`.

**Die wichtigste Datei für dich: `src/04-layout-body.html`** — dort stehen alle
Überschriften, Beschriftungen und die Anordnung der Bereiche.

---

## Aufbau des Ordners

```
arbeitszeit-app-src/
├── src/                          ← HIER bearbeitest du
│   ├── 01-head-meta.html         Kopf: Titel, Ansicht, Bildschirm-Einstellungen
│   ├── 02-db-setup.js            Datenbank-Anlage (Dexie/IndexedDB) — selten anfassen
│   ├── 03-styles.css             ALLE Farben, Abstände, Schriften, Layout-Regeln
│   ├── 04-layout-body.html       ALLE Texte und die Struktur der Oberfläche  ← meistgenutzt
│   ├── 05-app-logik.js           Die Funktionslogik (Rechnen, Speichern, Zeichnen)
│   ├── 99-fuss.html              Abschluss der Datei — nicht anfassen
│   ├── dexie.min.js              Bibliothek (Datenbank) — nicht anfassen
│   ├── qrcode.js                 Bibliothek (QR-Code) — nicht anfassen
│   └── index.html                ← WIRD AUTOMATISCH ERZEUGT, nicht direkt bearbeiten
├── www/                          ← WIRD AUTOMATISCH ERZEUGT (Eingabe für den APK-Bau)
├── build.sh                      Setzt src/index.html aus den Teilen zusammen
├── vorschau.sh                   App im Browser ansehen (schnellster Weg zum Testen)
├── build-apk.sh                  Neue APK bauen
├── capacitor.config.json         App-Kennung und Name
├── package.json                  Abhängigkeiten für den APK-Bau
└── README.md                     Diese Datei
```

---

## Der Arbeitsablauf (3 Schritte)

### 1. Ändern
Bearbeite eine der Dateien in `src/` mit einem Texteditor.
Empfehlung: **Visual Studio Code** (kostenlos) — zeigt Zeilennummern und färbt Code ein.

### 2. Ansehen
```bash
./build.sh        # setzt die Teile wieder zusammen
./vorschau.sh     # öffnet http://localhost:8090 im Browser
```
Im Browser siehst du die App so, wie sie auf dem Handy aussieht.
**Das ist der schnelle Weg** — kein Handy nötig, kein APK-Bau.

### 3. Aufs Handy bringen (nur wenn zufrieden)
```bash
./build-apk.sh
```
Ergebnis: `../arbeitszeit-app-NEU.apk`. Diese Datei aufs Handy schicken und antippen.

> **Wichtig:** Die alte App **nicht** deinstallieren. Bei gleicher Signatur
> installiert Android die neue Version als Update — deine Daten bleiben erhalten.

---

## Was ändere ich wo?

### Texte ändern → `src/04-layout-body.html`

Alle sichtbaren Beschriftungen stehen hier. Beispiele:

| Zeile | Was dort steht | Bedeutung |
|---|---|---|
| 30 | `Arbeitszeit &amp; Trinkgeld` | Untertitel ganz oben |
| 63 | `<h2>Schicht erfassen</h2>` | Überschrift des ersten Bereichs |
| 243 | `<h2>Monat auf einen Blick</h2>` | Überschrift Statistik |
| 248 | `<h2>Urlaubstage</h2>` | Überschrift Urlaub |
| 254 | `<h2>Urlaubsübersicht</h2>` | Überschrift Urlaubs-Tabelle |
| 270 | `<h2>Trinkgeld einrichten</h2>` | Überschrift Trinkgeld-Einstellungen |
| 288 | `<h2 id="tipQrHead">Trinkgeld geben</h2>` | Überschrift QR-Code |
| 308 | `<h2>Trinkgeld-Überblick</h2>` | Überschrift Trinkgeld-Statistik |
| 317 | `<h2>CSV Import / Export</h2>` | Überschrift Datenexport |
| 329 | `<h2>Alle Einträge</h2>` | Überschrift Eintragsliste |

**Einfach den Text zwischen den spitzen Klammern ersetzen:**
```html
<h2>Schicht erfassen</h2>
        ↓
<h2>Arbeitszeit eintragen</h2>
```

**Achtung:** `<h2>` und `</h2>` müssen stehen bleiben — nur der Text dazwischen ändert sich.

### Die unteren Tabs ändern → `src/04-layout-body.html`, Zeilen 42–56

```html
<button class="tab-btn active" data-target="capture" type="button">
  <span class="tab-icon">✏️</span>
  <span>Erfassen</span>
</button>
```

- `data-target="capture"` **nicht ändern** — das ist die Verbindung zum Bereich
- Das Emoji und der Text (`Erfassen`) sind frei änderbar

### Farben und Abstände ändern → `src/03-styles.css`

Ganz oben, Zeilen 2–20, stehen alle Farben als Variablen:

```css
:root {
  --bg: #f2f2f7;          /* Hintergrund hell */
  --card: rgba(255, 255, 255, 0.82);  /* Karten */
  --text: #111111;        /* Schrift */
  --accent: #007aff;      /* Akzentfarbe (Blau) */
  --accent-2: #34c759;    /* Grün */
  --accent-3: #ff9f0a;    /* Orange */
  --danger: #ff3b30;      /* Rot */
}
```

Eine Farbe ändern = eine Zeile ändern. Der Dark Mode hat einen eigenen
`[data-theme="dark"]`-Block weiter unten — dort die gleichen Variablen.

### Bereich umsortieren → `src/04-layout-body.html`

Jeder tab-Bereich beginnt mit `<section id="..." class="tab-panel">`.
Diese Blöcke kannst du als Ganzes verschieben — die Reihenfolge im HTML
bestimmt die Reihenfolge in der App.

### Logik ändern → `src/05-app-logik.js`

Hier steht, wie gerechnet und gespeichert wird. Nur anfassen, wenn sich
**Verhalten** ändern soll (nicht das Aussehen). Die Datei ist in Abschnitte
gegliedert, die mit `// ═══` und einem Titel beginnen — such mit Strg+F nach
dem Titel des Abschnitts.

---

## Sicherheitsnetz (falls etwas kaputtgeht)

Vor jeder größeren Änderung:

```bash
cd ~/arbeitszeit-app-src
cp -R src src-backup-$(date +%F)
```

Zurückholen:
```bash
cd ~/arbeitszeit-app-src
rm -rf src && cp -R src-backup-2026-10-26 src
```

**Alternativ** (empfohlen): einmal `git init` in diesem Ordner und regelmäßig
`git commit`. Dann ist jede Änderung nachvollziehbar und rückholbar.

---

## Erste Einrichtung (nur einmal nötig)

Java 21, Android SDK und Node sind auf diesem Mac bereits installiert.
Es fehlt nur das Android-Projekt:

```bash
cd ~/arbeitszeit-app-src
npm install
npx cap add android
```

Danach funktioniert `./build-apk.sh` dauerhaft.

---

## Häufige Fehler und was sie bedeuten

| Meldung | Ursache | Lösung |
|---|---|---|
| `!! Java 21 nicht gefunden` | PATH stimmt nicht | Skript setzt PATH selbst — Terminal neu öffnen |
| `!! Das Android-Projekt fehlt noch` | `npx cap add android` nie gelaufen | siehe „Erste Einrichtung" |
| App im Browser leer | Fehler im geänderten HTML | `git diff` ansehen, letzte Änderung zurücknehmen |
| `FEHLT: </html>` in build.sh | eine Teil-Datei wurde geleert | aus Backup zurückholen |
| APK installiert nicht | andere Signatur | alte App **nicht** deinstallieren, sondern Build mit gleichem Debug-Key nutzen |

---

## Was diese Struktur nicht kann

- **`src/index.html` nicht direkt bearbeiten.** Sie wird bei jedem `./build.sh`
  überschrieben. Immer die nummerierten Teil-Dateien ändern.
- **Bibliotheken nicht bearbeiten.** `dexie.min.js` und `qrcode.js` sind
  fertige Fremdbibliotheken, absichtlich offline eingebunden.
- **Keine echte Datenbank im Browser.** Die Vorschau nutzt den Browser-Speicher
  (IndexedDB), getrennt vom Handy. Daten aus der Vorschau landen nicht in der APK.
