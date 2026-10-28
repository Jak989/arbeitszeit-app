#!/bin/bash
# Baut eine neue APK aus den Teil-Dateien.
#
# Aufruf:   ./build-apk.sh
#
# Was passiert:
#   1. build.sh läuft  -> src/index.html wird neu zusammengesetzt
#   2. www/ wird geleert und mit den App-Dateien gefüllt
#   3. Capacitor kopiert www/ ins Android-Projekt
#   4. Gradle baut die APK
#   5. Die fertige APK wird nach ../arbeitszeit-app-NEU.apk kopiert
#
# WICHTIG beim ersten Mal: siehe README.md, Abschnitt "Erste Einrichtung".
# Beim allerersten Lauf muss einmalig "npx cap add android" laufen.

set -e
cd "$(dirname "$0")"

# --- Java und Android SDK bekannt machen (auf diesem Mac nötig) ---
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

if ! java -version 2>&1 | grep -q "21"; then
  echo "!! Java 21 nicht gefunden. Prüfe JAVA_HOME."
  exit 1
fi

# --- 1. Teil-Dateien zusammensetzen ---
./build.sh

# --- 2. www/ füllen ---
rm -rf www
mkdir -p www
cp src/index.html         www/
cp src/dexie.min.js       www/
cp src/qrcode.js          www/
echo "www/ gefüllt"

# --- 3. Capacitor synchronisieren ---
if [ ! -d android ]; then
  echo
  echo "!! Das Android-Projekt fehlt noch."
  echo "   Einmalig ausführen:  npx cap add android"
  echo "   Danach dieses Skript erneut starten."
  exit 1
fi
npx cap sync android

# --- 4. APK bauen ---
cd android
./gradlew assembleDebug
cd ..

APK=android/app/build/outputs/apk/debug/app-debug.apk
if [ ! -f "$APK" ]; then
  echo "!! Build lieferte keine APK."
  exit 1
fi

# --- 5. Ergebnis ablegen ---
ZIEL="$(dirname "$0")/../arbeitszeit-app-NEU.apk"
cp "$APK" "$ZIEL"

echo
echo "================ FERTIG ================"
echo "APK:    $ZIEL"
echo "Größe:  $(du -h "$ZIEL" | cut -f1)"
echo
echo "Aufs Handy:  Datei per Kabel/USB oder Telegram schicken und antippen."
echo "WICHTIG:     Vorher die alte App NICHT deinstallieren (sonst Daten weg)."
echo "             Gleiche Signatur -> Installation als Update, Daten bleiben."
echo "========================================"
