#!/bin/bash
# Startet die App lokal im Browser, damit du Änderungen SOFORT siehst,
# ohne eine APK zu bauen und aufs Handy zu schieben.
#
# Aufruf:   ./vorschau.sh
#           dann im Browser öffnen:  http://localhost:8090
#
# Beenden mit Ctrl+C.

set -e
cd "$(dirname "$0")/src"

echo "Starte Vorschau auf http://localhost:8090"
echo "  (Strg+C beendet den Server)"
echo

# macOS: Browser automatisch öffnen
( sleep 1 && open "http://localhost:8090" ) &

python3 -m http.server 8090
