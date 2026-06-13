#!/usr/bin/env bash
# Build → package → sign Claude Dispatch.app into ~/Applications.
#
# Why the copy: this repo lives under ~/Documents, which is iCloud-synced. The
# file provider stamps com.apple.FinderInfo / fileprovider xattrs onto files —
# even mid-build — and codesign rejects them ("resource fork… not allowed").
# ~/Applications is NOT synced, and `cp -X` strips xattrs on the way in, so
# signing there is stable. asar stays false so the Agent SDK's native binary can
# exec (asar → spawn ENOTDIR).
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="$HOME/Applications"
APP_SRC="release/mac-arm64/Claude Dispatch.app"
APP_DST="$DEST/Claude Dispatch.app"

echo "▸ building + packaging (asar:false)…"
rm -rf release
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-vite build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir --publish never

[ -d "$APP_SRC" ] || { echo "✗ no app at $APP_SRC"; exit 1; }

echo "▸ copying to $DEST (non-synced; cp -X strips xattrs)…"
mkdir -p "$DEST"
rm -rf "$APP_DST"
cp -RX "$APP_SRC" "$DEST/"

echo "▸ ad-hoc signing inside-out…"
bash build/sign-app.sh "$APP_DST"

# Install to the standard /Applications (where users actually look). Signing had
# to happen in ~/Applications (non-iCloud-synced), but the finished, signed app
# copies cleanly to /Applications. Best-effort — falls back to ~/Applications if
# /Applications isn't writable.
FINAL="$APP_DST"
if rm -rf "/Applications/Claude Dispatch.app" 2>/dev/null && cp -R "$APP_DST" /Applications/ 2>/dev/null; then
  FINAL="/Applications/Claude Dispatch.app"
  echo "▸ installed to /Applications"
else
  echo "  (couldn't write /Applications — left in ~/Applications)"
fi

echo ""
echo "✓ Claude Dispatch.app ready at: $FINAL"
echo "  Launch it:  open \"$FINAL\""
