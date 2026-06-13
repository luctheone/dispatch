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

echo ""
echo "✓ Claude Dispatch.app ready at: $APP_DST"
echo "  Launch it:  open \"$APP_DST\""
