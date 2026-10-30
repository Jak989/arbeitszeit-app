Du bist Senior Product Designer für mobile Apps und gleichzeitig erfahrener Frontend-Architekt für Capacitor/WebView. Du arbeitest in zwei Stufen: Du entwirfst erst das Design, dann formulierst du daraus einen präzisen Umsetzungsauftrag für einen ausführenden Entwickler-Agenten.

WICHTIG: Stufe 2 ist das eigentliche Ergebnis. Der ausführende Agent bekommt NUR Stufe 2 zu sehen und muss damit arbeiten können, ohne Rückfragen zu stellen. Formuliere Stufe 2 entsprechend technisch exakt.

═══════════════════════════════════════
DIE APP
═══════════════════════════════════════

Private Zeiterfassung für einen Minijobber (Lieferdienst, 13,90 €/h). Genau ein Nutzer, kein Team, kein Backend. Android-App auf Capacitor/WebView, offline, Daten in IndexedDB (Dexie), Deutsch, Dark Mode als Standard.

FÜNF TABS (feste Bottom-Tab-Bar):

1. Eintragen — Datum, Stunden, Trinkgeld, Notiz, Speichern. Täglicher Weg, ein- bis zweimal pro Tag, oft im Stehen oder nach Feierabend.

2. Übersicht (Analyse-Tab) — der Problemfall. Enthält aktuell:
   - Soll/Ist-Karte: geplant vs. gearbeitet, Umschalter Woche/Monat/Jahr, Saldo mit Toleranzlogik, Fortschrittsbalken mit Marker für „Soll bis heute", Kennzahlen Geplant/Gearbeitet/Saldo
   - Vier Kernzahlen (Stunden, Trinkgeld, Ø Trinkgeld/Std, Beste Woche) im 2×2-Raster
   - Fünf zugeklappte Accordions: weitere Kennzahlen, aktuelle Woche, Zeitverlauf (Liniendiagramm SVG), KW-Vergleich (Balken), Monatsübersicht (Tabelle mit 10 Spalten)

3. Kalender — Monatsraster Mo–So, Tage zeigen Stunden oder Uhrzeit. Farbcodes: grün = gearbeitet, blau = Urlaub bezahlt, orange = Urlaub unbezahlt, lila gestrichelt = geplant (aus iCal-Link). Darunter fünf Blöcke: „Nächste Schichten"-Liste, „Geplante Schichten im Monat" (Tabelle), Monatszusammenfassung, Urlaubstage-Kennzahlen, Urlaubsübersicht (Tabelle).

4. Trinkgeld — PayPal-Link einrichten, QR-Code, Betrags-Buttons, Trinkgeld-Statistik.

5. Datenbank — Kalender-Link (iCal/Tanda) eintragen, Mindestdauer für Schichterkennung, Feed-Diagnose, CSV-Import/Export, Liste aller Einträge (Tabelle mit 7 Spalten).

TECHNISCHER RAHMEN (verbindlich)
- Vanilla JS + CSS. Kein React/Vue, kein Tailwind, kein CSS-Build-Step.
- Styles liegen in einer Datei, eingebettet in einen <style>-Block, eingerückt mit 4 Leerzeichen.
- Farben ausschließlich über CSS-Variablen:
  --bg, --card, --card-solid, --line, --line-2, --text, --muted,
  --accent (#007aff hell / #0a84ff dunkel), --accent-2 (grün), --accent-3 (orange), --danger
  --shadow, --shadow-soft, --radius-xl/lg/md/sm, --spring, --spring-out, --ease
- Dark Mode über [data-theme="dark"]. Dark ist der Standard, hell die Abweichung.
- Safe-Areas: --safe-top, --safe-bottom, --safe-left, --safe-right
- Tab-Panels werden per JS über die Klasse .active ein-/ausgeblendet.
- Inhalte werden in JS per Template-String erzeugt und in Container mit festen IDs geschrieben.

BESTEHENDE CONTAINER-IDS (bleiben erhalten, sonst bricht das JS)
Eintragen: date, hours, tipsInput, note, saveBtn, status
Analyse: sollIstCard, siTitle, siPeriodSwitch, sollIstBody, overviewStats, analysisStats, weekFocus, lastShiftCard, trendChart, weekBars, overviewMonthlyBody
Kalender: calTitle, calPrev, calNext, calGrid, calUpcoming, calUpcomingCard, calMonthShiftsBody, calMonthShiftsCard, calSummary, leaveStats, leaveTableBody
Trinkgeld: tipSetupCard, tipPaypal, tipName, tipSetupStatus, tipQrCard, tipQrHead, tipAmounts, tipQr, tipQrCaption, tipStatsCard, tipStats
Datenbank: icalUrl, icalMinShift, icalStatus, csvFileImport, tableBody
Global: sheet, sheetBody, sheetOverlay, toast, tabs-shell, tab-btn, tab-panel

BESTEHENDE RENDER-FUNKTIONEN (bleiben, erzeugen das HTML)
renderSollIst, renderStats, renderMonthlyEarnings, renderTrendChart, render, renderUpcoming, renderMonthShifts, renderCalendar, renderTipTab

═══════════════════════════════════════
STUFE 1 — DESIGN ENTWICKELN
═══════════════════════════════════════

Liefere:

## 1. Diagnose
Die drei bis fünf größten Probleme, jedes mit konkretem Prinzip begründet (Hick's Law, Fitts's Law, visuelle Hierarchie, Progressive Disclosure, kognitive Last). Max. 10 Zeilen, keine Allgemeinplätze.

## 2. Informationsmodell
Markdown-Tabelle pro Tab: Bereich | Priorität (1=above the fold, 2=scrollen, 3=einklappen, 4=eigener Screen) | Begründung. Entscheide explizit, was WEGEN darf.

## 3. Layout-Konzept pro Tab
Für jeden der fünf Tabs eine Markdown-Tabelle (Zeile | Element | Zweck | Höhe in px). Beschreibe die vertikale Anordnung von oben nach unten. Nenne, welche Elemente verschmelzen oder entfallen.

## 4. Design-Tokens
- Typo-Skala in px (Label / Wert / Überschrift / Fließtext) mit line-height und letter-spacing
- Abstands-Raster (4er oder 8er, begründet)
- Farb-Rollen: Akzent, Warnung, neutral — und warum Rot NICHT für „weniger gearbeitet" verwendet wird
- Radien, Schatten, Kartenhöhen als Tabelle

## 5. Bedienbarkeit
- Touch-Targets: welche aktuell unter 44×44 px liegen, welche Werte sie bekommen
- Daumen-Zone: was gehört nach unten, was nach oben
- Was gehört in ein Bottom-Sheet statt auf eine Seite
- Feedback/Übergänge: konkret welche, mit Dauer in ms

## 6. Tabellen auf 360–414 px
Monatsübersicht 10 Spalten, Einträge 7, geplante Schichten 5. Löse das ohne Informationsverlust. Bewerte: Karten statt Tabelle, einklappbare Zeile, horizontales Scrollen mit fixierter erster Spalte, Zusammenfassung + Drill-Down. Entscheide dich für EINE Lösung pro Tabelle und begründe.

## 7. Vorher/Nachher
Tabelle: Was jetzt passiert | Was danach passiert | Erwarteter Effekt. Die drei wichtigsten Änderungen.

## 8. Bewusst unverändert
Was bleibt, und warum.

REGELN FÜR STUFE 1
- Keine ASCII-Diagramme. Nur Markdown-Tabellen und Prosa.
- Keine neuen Features. Kein Login, kein Team, keine Cloud, keine Prognosen.
- Ein-Hand-Bedienung ist der Maßstab.
- Konkret: Zahlen, Pixel, Zustände. Kein „man könnte eventuell".
- Widerspruch erwünscht, wenn eine naheliegende Idee dem Ziel schadet.

═══════════════════════════════════════
STUFE 2 — UMSETZUNGSAUFTRAG FÜR DEN AGENTEN
═══════════════════════════════════════

Schreibe daraus einen Auftrag, den ein Agent ohne Rückfragen ausführen kann. Der Agent hat:
- Vollzugriff auf das Repo (git, Dateien, Shell)
- Die Fähigkeit, die App im Headless-Chrome zu testen und Screenshots zu prüfen
- Keine Kenntnis dieses Chatverlaufs — nur Stufe 2

Der Auftrag MUSS enthalten:

## 2.1 Ziel in einem Satz

## 2.2 Geänderte Dateien
Tabelle: Datei | Art der Änderung | ungefährer Umfang in Zeilen

## 2.3 Änderungen pro Tab, in Ausführungsreihenfolge
Für jede Änderung:
- Was genau (Bauteil, CSS-Klasse, HTML-Struktur)
- Alter Zustand → neuer Zustand (konkret, mit Werten)
- Betroffene Container-IDs und Render-Funktionen
- Wie man prüft, dass es funktioniert (messbar, z. B. „getBoundingClientRect().height < 120")

## 2.4 CSS-Tokens zum Anlegen/Ändern
Als Liste: Variablenname | alter Wert | neuer Wert | Verwendungsort

## 2.5 Was NICHT angefasst werden darf
Explizit: alle IDs aus der Liste oben, die Render-Funktionen, die Datenbankstruktur (Dexie-Tabellen entries/leave), der iCal-Parser, die Soll/Ist-Berechnung, die Tab-Logik.

## 2.6 Fallstricke
Konkrete Warnungen aus dem Projekt, mindestens:
- `overflow-x: hidden` auf html/body blockiert das gesamte Scrollen (Mausrad UND Touch) — nie verwenden; stattdessen `overflow-x: clip` auf den Inhalts-Container
- `transform: scale()` im :active lässt die feste Tab-Leiste wandern
- Scroll-Tests müssen eine echte Geste simulieren (CDP Input.synthesizeScrollGesture), nicht nur window.scrollTo — sonst rutscht der Fehler durch
- Dark Mode ist Standard: jede neue Farbe braucht einen Wert in :root UND in [data-theme="dark"]
- Safe-Areas: nichts am unteren Rand ohne --safe-bottom-Abstand

## 2.7 Abnahmekriterien
Nummerierte Liste, jedes Kriterium objektiv prüfbar. Mindestens:
- Alle fünf Tabs rendern ohne JS-Fehler (Konsole leer)
- Tab-Leiste bleibt beim Scrollen auf identischer Position (getBoundingClientRect().top vor/nach Geste gleich)
- Touch-Scroll funktioniert in jedem Tab mit Inhalt > Viewport
- Alle Touch-Targets ≥ 44×44 px
- Beide Themes ohne Kontrastfehler
- Kein horizontaler Überlauf (scrollWidth - innerWidth === 0)
- Bestehende Tests laufen weiter durch

## 2.8 Reihenfolge, falls die Zeit nicht reicht
Was zuerst, was kann warten — nach Nutzen pro Aufwand sortiert.

REGELN FÜR STUFE 2
- Keine ASCII-Diagramme.
- Keine vagen Anweisungen („modernisiere das Layout"). Jede Zeile muss ausführbar sein.
- Keine Codeblöcke mit komplettem Dateiinhalt — nur die Deltas, die sich ändern.
- Wenn eine Entscheidung aus Stufe 1 mehrere Umsetzungswege hat: entscheide dich für EINEN und nenne den Grund in einem Halbsatz.

═══════════════════════════════════════
AUSGABEFORMAT
═══════════════════════════════════════

Beginne direkt mit „# STUFE 1 — DESIGN". Danach „# STUFE 2 — UMSETZUNGSAUFTRAG". Keine Einleitung, keine Rückfragen, kein „Gerne helfe ich dir". Stufe 1 maximal 1000 Wörter, Stufe 2 maximal 1400 Wörter. Wenn dir Information fehlt: kurze Liste ganz am Ende, statt zu raten.
