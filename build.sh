#!/bin/bash
# Baut aus den Teil-Dateien in src/ wieder die fertige index.html
# und legt sie zusätzlich nach src/index.html (das ist die Datei, die in die APK geht).
#
# Aufruf:   ./build.sh
#
# Du musst NICHTS weiter tun, als die Teil-Dateien zu bearbeiten und danach
# dieses Skript zu starten. Es prüft am Ende, ob die Datei plausibel ist.

set -e
cd "$(dirname "$0")"

TEILE=(
  "src/01-head-meta.html"
  "src/02-db-setup.js"
  "src/03-styles.css"
  "src/04-layout-body.html"
  "src/05-app-logik.js"
  "src/99-fuss.html"
)

echo "Baue index.html aus ${#TEILE[@]} Teilen ..."

# Alle Teile in der richtigen Reihenfolge zusammensetzen
cat "${TEILE[@]}" > src/index.html

# Verifikation
GROESSE=$(wc -c < src/index.html)
ZEILEN=$(wc -l < src/index.html)

echo "  Größe:  $GROESSE Byte"
echo "  Zeilen: $ZEILEN"

# Plausibilitätsprüfungen
FEHLER=0
for marke in "</html>" "loadData()" "dexie.min.js" "qrcode.js"; do
  if ! grep -q "$marke" src/index.html; then
    echo "  FEHLT: $marke"
    FEHLER=1
  fi
done

# Zählen, ob alle Tab-Buttons da sind (sollte bei Layout-Änderungen auffallen)
TABS=$(grep -c 'class="tab-btn' src/index.html || true)
echo "  Tab-Buttons: $TABS"

if [ "$FEHLER" -eq 1 ]; then
  echo
  echo "!! Die gebaute Datei ist unvollständig. Prüfe die Teil-Dateien."
  exit 1
fi

echo
echo "OK — src/index.html ist fertig."
echo "Nächster Schritt (nur wenn du eine neue APK brauchst): ./build-apk.sh"
