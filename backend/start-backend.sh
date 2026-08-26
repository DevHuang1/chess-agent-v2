#!/bin/zsh
# Launcher for the Sentio Python backend (FastAPI + uvicorn).
#
# Sets up the macOS SWI-Prolog/pyswip workarounds so the Logician panel works:
#   - LIBSWIPL_PATH points at our patched copy of libswipl (backend/lib/) whose
#     @rpath dependencies (libgmp, libz) were rewritten to absolute paths via
#     install_name_tool — the SWI-Prolog.app bundle's rpath does not resolve
#     inside the Python process.
#   - SWI_HOME_DIR tells SWI where its boot resources live.
#
# Usage: ./start-backend.sh   (serves http://127.0.0.1:8000)

cd "$(dirname "$0")" || exit 1

APP_FRAMEWORKS="/Applications/SWI-Prolog.app/Contents/Frameworks"
PATCHED_LIB="$PWD/lib/libswipl.10.0.2.dylib"

export LIBSWIPL_PATH="$PATCHED_LIB"
export SWI_HOME_DIR="/Applications/SWI-Prolog.app/Contents/Resources/swipl"

# Rebuild the patched library if missing or if the app updated underneath us.
if [ ! -f "$PATCHED_LIB" ] || [ "$APP_FRAMEWORKS/libswipl.10.0.2.dylib" -nt "$PATCHED_LIB" ]; then
  echo "Patching libswipl into $PWD/lib ..."
  mkdir -p lib
  cp "$APP_FRAMEWORKS/libswipl.10.0.2.dylib" "$APP_FRAMEWORKS/libgmp.10.dylib" "$APP_FRAMEWORKS/libz.1.dylib" lib/
  install_name_tool \
    -change @rpath/libgmp.10.dylib "$PWD/lib/libgmp.10.dylib" \
    -change @rpath/libz.1.dylib "$PWD/lib/libz.1.dylib" \
    lib/libswipl.10.0.2.dylib
  codesign -f -s - lib/libswipl.10.0.2.dylib
fi

exec python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
