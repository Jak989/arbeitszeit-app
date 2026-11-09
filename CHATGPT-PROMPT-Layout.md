# Prompt für ChatGPT — Layout & Bedienbarkeit der Arbeitszeit-App

Kopiere alles zwischen den Linien in ChatGPT. Am besten in ein neues Chatfenster
(GPT-5 / o3 oder besser), damit kein alter Kontext stört.

---

Du bist Senior Product Designer für mobile Apps mit Schwerpunkt auf Android/WebView
(Capacitor). Du bist bekannt für ruhige, informationsdichte Interfaces, die eine
einzige Frage in unter zwei Sekunden beantworten — und die man mit dem Daumen bedienen
kann, ohne zu zielen.

## Deine Aufgabe

Optimiere Layout und Bedienbarkeit einer bestehenden, funktionierenden Single-User-App.
Die Funktionalität ist fertig und darf NICHT verändert werden. Du lieferst KEINEN Code,
sondern ein präzises, umsetzbares Design-Konzept.

## Die App

Persönliche Zeiterfassung für einen einzelnen Nutzer. Kein Team, kein Backend. Native App auf Android (CapacitorWebView, offline, IndexedDB).
Deutsch, Dark Mode als Standard.

**Fünf Tabs (feste Bottom-Tab-Bar):**

1. **Eintragen** — Datum, Stunden, Trinkgeld, Notiz, Speichern. Das ist der tägliche Weg,
   meist ein bis zwei Mal pro Tag, oft im Stehen oder nach Feierabend.
2. **Übersicht** — der Analyse-Tab. Enthält:
   - Soll/Ist-Karte: geplant vs. gearbeitet, Umschalter Woche/Monat/Jahr, Saldo,
     Fortschrittsbalken mit Marker, Kennzahlen Geplant/Gearbeitet/Saldo
   - Vier Kernzahlen (Stunden, Trinkgeld, Ø Trinkgeld/Std, Beste Woche) in 2×2-Raster
   - Zugeklappte Accordions: weitere Kennzahlen, aktuelle Woche, Zeitverlauf (Liniendiagramm),
     KW-Vergleich (Balken), Monatsübersicht (breite Tabelle mit 10 Spalten)
3. **Kalender** — Monatsraster Mo–So. Tage zeigen Stunden oder Uhrzeit.
   Farbcodes: grün = gearbeitet, blau = Urlaub bezahlt, orange = Urlaub unbezahlt,
   lila gestrichelt = geplant (aus iCal-Link). Darunter: „Nächste Schichten"-Liste,
   „Geplante Schichten im Monat" (Tabelle), Monatszusammenfassung, Urlaubstage,
   Urlaubsübersicht (Tabelle).
4. **Trinkgeld** — PayPal-Link einrichten, QR-Code anzeigen, Betrags-Buttons,
   Trinkgeld-Statistik.
5. **Datenbank** — Kalender-Link (iCal, z. B. Tanda) eintragen, Mindestdauer für
   Schichterkennung, Feed-Diagnose, CSV-Import/Export, Liste aller Einträge (7 Spalten).

**Technischer Rahmen (bitte respektieren):**
- Vanilla JS + CSS, kein Framework, kein Build-Step für Styles
- CSS-Variablen für Farben (--bg, --card, --text, --muted, --accent, --danger …)
- Dark Mode über `[data-theme="dark"]`
- Safe-Areas (iOS-Notch, Android-Gestenleiste) über --safe-top/--safe-bottom
- Kein Framework-Wechsel. Vorschläge müssen mit reinem CSS/HTML umsetzbar sein.

## Was der Nutzer ändern will

Sein Zitat: „Alle Funktionen sind da, aber ich möchte Layout und Bedienbarkeit optimieren."

Er ist kein Designer. Er meint damit konkret: es fühlt sich nicht wie eine fertige App an,
sondern wie eine Zusammenstellung von Karten. Ihn stören vermutlich (leite das aus dem
Aufbau ab, nicht raten): zu viele gleich aussehende Karten, zu viel Scrollen auf dem
Analyse-Tab, Tabellen mit zu vielen Spalten auf dem Handy, unklare Priorität — man weiß
nicht, wo man zuerst hinschauen soll.

## Was du liefern sollst

**1. Diagnose (max. 10 Zeilen)**
Die drei bis fünf größten Probleme in der aktuellen Struktur. Begründe jedes mit einem
konkreten Prinzip (Hick's Law, visuelle Hierarchie, Fitts's Law, Progressive Disclosure,
kognitive Last). Keine Allgemeinplätze.

**2. Neues Informationsmodell als Markdown-Tabelle**
Für jeden Tab: Was steht oben (above the fold), was darunter, was wird eingeklappt oder
in einen eigenen Screen verschoben? Spalten: Bereich | Priorität | Begründung.

**3. Layout-Konzept pro Tab**
Für jeden der fünf Tabs:
- ASCII-freie Beschreibung der Anordnung (nutze eine Markdown-Tabelle mit Zeile/Element/
  Zweck statt ASCII-Grafik — Telegram bricht ASCII-Diagramme)
- Welche Elemente entfallen, verschmelzen oder wandern
- Begründung in einem Satz pro Entscheidung

**4. Konkrete Design-Tokens**
- Typo-Skala (px) für Label / Wert / Überschrift / Fließtext
- Abstands-Raster (4 oder 8 px)
- Farb-Rollen: was ist Akzent, was Warnung, was neutral (und warum NICHT rot)
- Radien, Schatten, Kartenhöhen — als Tabelle mit Werten

**5. Bedienbarkeit**
- Touch-Targets (min. 44×44 px) — welche aktuell zu klein sind
- Wo sollte eine Aktion mit einer Bewegung erreichbar sein (Daumen-Zone unten)
- Was gehört in eine Bottom-Sheet statt auf eine eigene Seite
- Vorschläge für Übergänge/Feedback, die nicht nerven

**6. Die Tabellen auf dem Handy**
Die Monatsübersicht hat 10 Spalten, die Einträge-Liste 7, die geplanten Schichten 5.
Erarbeite, wie man das auf 360–414 px Breite lesbar macht, ohne Informationen zu
verlieren (z. B. Karten statt Tabelle, einklappbare Zeilen, horizontales Scrollen mit
fixierter erster Spalte, Zusammenfassung + Drill-Down).

**7. Vorher/Nachher: die drei wichtigsten Änderungen**
Als Markdown-Tabelle: Was jetzt passiert | Was danach passiert | Erwarteter Effekt.

**8. Was du bewusst NICHT änderst**
Und warum — damit klar ist, dass die Funktionen unangetastet bleiben.

## Regeln

- **Keine ASCII-Diagramme.** Markdown-Tabellen und klare Prosa. (Der Nutzer liest
  das auf dem Handy in Telegram; ASCII bricht dort.)
- **Keine Funktionsvorschläge, die es nicht gibt.** Erfasse nichts dazu, was nicht
  in der Liste oben steht. Kein Login, kein Team-Feature, keine Cloud, keine Prognosen.
- **Dark Mode zuerst denken**, hell nur als Abweichung.
- **Ein-Hand-Bedienung** ist der Maßstab, nicht Desktop-Maus.
- **Sei konkret**: Zahlen, Pixel, Zustände. Kein „man könnte eventuell".
- **Widersprich dem Nutzer**, wenn eine seiner Ideen dem Ziel schadet — mit Begründung.
- Wenn dir Information fehlt: sag am Ende in einer kurzen Liste, was du bräuchtest,
  statt zu raten.

## Ausgabeformat

Markdown, Überschriften ab `##`. Maximal 1200 Wörter. Keine Einleitung, kein
„Gerne helfe ich dir" — direkt mit der Diagnose beginnen.

---

## Nach dem ChatGPT-Lauf

Bring die Antwort zurück. Sinnvoll ist es, sie in Abschnitte zu zerlegen und einzeln
umzusetzen — nicht alles auf einmal. Die Reihenfolge, die am meisten bringt:

1. Abschnitt 5 (Touch-Targets, Daumen-Zone) — kleinster Aufwand, größter Effekt
2. Abschnitt 6 (Tabellen) — betrifft drei Tabs gleichzeitig
3. Abschnitt 2 (Informationsmodell) — entscheidet, was auf dem Analyse-Tab bleibt
4. Abschnitt 3/4 (Layout, Tokens) — der große Umbau
