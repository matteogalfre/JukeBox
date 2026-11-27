#!/usr/bin/env bash
# Construit l'APK signé avec la clé de publication, et peut l'installer sur le téléphone branché.
#
#   scripts/build-apk.sh            construit dist/JukeBox-<version>.apk
#   scripts/build-apk.sh --install  construit, installe par-dessus l'appli (données gardées) et lance
#
# La clé reste hors du dépôt, dans ~/.config/jukebox :
#   release.jks            clé de publication (à sauvegarder : sans elle, plus de mises à jour)
#   release-key.env        son mot de passe (JUKEBOX_KEY_PASS=…)
#   old-debug.keystore     l'ancienne clé, publique, qui signait la 0.1.0
#   signing-lineage.bin    la preuve que l'ancienne clé passe la main à la nouvelle
# Grâce à cette preuve (Android 9 et plus), l'APK s'installe par-dessus la 0.1.0 sans
# désinstaller, donc sans perdre les écoutes ni l'historique du tri.
set -euo pipefail
cd "$(dirname "$0")/.."

CFG="${JUKEBOX_SIGNING_DIR:-$HOME/.config/jukebox}"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$JAVA_HOME/bin:$PATH"
BT="$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)"

for f in release.jks release-key.env old-debug.keystore signing-lineage.bin; do
  [ -f "$CFG/$f" ] || { echo "Il manque $CFG/$f (voir l'en-tête de ce script)." >&2; exit 1; }
done
set -a
. "$CFG/release-key.env"
set +a

npx expo prebuild -p android --clean --no-install
(cd android && ./gradlew assembleRelease --no-daemon -q)

VERSION="$(node -p "require('./app.json').expo.version")"
mkdir -p dist
OUT="dist/JukeBox-$VERSION.apk"
"$BT/apksigner" sign \
  --in android/app/build/outputs/apk/release/app-release.apk --out "$OUT" \
  --ks "$CFG/old-debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android \
  --next-signer --ks "$CFG/release.jks" --ks-key-alias jukebox \
  --ks-pass env:JUKEBOX_KEY_PASS --key-pass env:JUKEBOX_KEY_PASS \
  --lineage "$CFG/signing-lineage.bin"
rm -f "$OUT.idsig"
"$BT/apksigner" verify "$OUT"
echo "APK signé : $OUT"

if [ "${1:-}" = "--install" ]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
  "$ADB" install -r "$OUT"
  "$ADB" shell monkey -p com.matteogalfre.jukebox -c android.intent.category.LAUNCHER 1 > /dev/null
  echo "Installé et lancé."
fi
