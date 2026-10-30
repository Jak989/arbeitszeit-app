# UI-Analyse: Was die App komplex macht

Stand: 744b784 · 13 Karten, 5 Accordions, 7 Kennzahl-Renderer, 1542 CSS-Zeilen

## Die Komplexitätstreiber (nach Wirkung sortiert)

| # | Treiber | Wo | Warum es komplex wirkt |
|---|---|---|---|
| 1 | **Übersicht hat 7 Blöcke** | Tab "Übersicht" | Soll/Ist + 4 Quickstats + 5 Accordions. Der Nutzer scrollt durch drei Bildschirmhöhen, um zu erfahren, was eine Zahl ihm sagen sollte. |
| 2 | **Karten-Überschrift 24 px** | `.card h2` | Jede der 13 Karten schreit gleich laut. Eine Karte in der Datenbank hat dieselbe Überschriften-Größe wie die Soll/Ist-Karte, die eigentlich die Hauptsache ist. |
| 3 | **Karte = Blur + Schatten + Rand** | `.card`, `.metric` | `backdrop-filter: blur(28px)` + `box-shadow 0 8px 32px` + heller Rand auf jeder Karte. Das erzeugt Tiefe, wo keine nötig ist — "Dashboard", nicht "App". |
| 4 | **Fließtext unter jeder Überschrift** | 12× `.section-copy` | "Schnell rein damit. Ohne Umwege, ohne Gefummel." ist Persönlichkeit, aber in 12 Karten wird es Rauschen. Erklärt Dinge, die man nach dem ersten Tag weiß. |
| 5 | **13 Karten mit identischem Innenabstand** | `.card padding: 20px` | Kalender, Tabellen, Formulare, QR-Code sitzen alle im selben Korsett. Nichts unterscheidet "Hauptsache" von "Nebenbei". |
| 6 | **Accordion-Pfeil als Chevron** | `.acc-chev` | 5 zugeklappte Balken untereinander sehen aus wie ein Menü, nicht wie Inhalt. Man weiß nicht, was drin ist, ohne aufzuklappen. |
| 7 | **Spalten-Tabellen auf 360 px** | 3 Tabellen mit 10/7/5 Spalten | Zwingt zu horizontalem Scrollen in einer Vertikal-App. |
| 8 | **Kein Rhythmus in den Abständen** | gemischt 10/12/14/16/20 px | Nichts rastet. 4/8er-Raster würde ruhiger wirken. |

## Was NICHT das Problem ist

Die Farben (Akzent-Blau, Grün, Orange) funktionieren. Der Dark Mode ist stimmig.
Die Soll/Ist-Karte ist inhaltlich richtig aufgebaut. Die Tab-Leiste ist gut.
Das Problem ist **Gewichtung**, nicht Farbe oder Struktur.

## Strategie

Nicht umbauen — **zurücknehmen**. Vier Eingriffe, alle additiv rückwärts:

1. **Ruhigere Karten**: Schatten und Blur raus, flacher Rand, kleinere Rundung, 4/8er-Abstände. Karten bleiben Karten, wirken aber wie Flächen statt wie schwebende Scheiben.
2. **Hierarchie über Größe**: `.card h2` von 24 px auf 15 px. Nur die Soll/Ist-Überschrift bleibt groß (das ist die Hero-Zahl).
3. **Hilfetexte zähmen**: `.section-copy` kleiner und gedämpfter; die langen Erklärtexte in Einstellungen/Trinkgeld bleiben, werden aber zur Fußnote.
4. **Übersicht entzerren**: Quickstats in die Soll/Ist-Karte integrieren (eine Karte statt zwei), Accordions als ruhige Zeilen mit sichtbarem Inhalt-Hinweis.
