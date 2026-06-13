#!/usr/bin/env bash
# Ad-hoc sign the packaged app inside-out (binaries → frameworks → helper apps →
# main app). `codesign --deep` chokes on Electron's pre-signed nested helpers
# ("code has no resources…"), so we sign each component explicitly. Ad-hoc (-s -)
# gives a stable local code identity so macOS TCC remembers granted permissions
# across launches and attributes them to "Claude Dispatch".
set -euo pipefail

APP="${1:-release/mac-arm64/Claude Dispatch.app}"
ENT="build/entitlements.mac.plist"
ENT_INHERIT="build/entitlements.mac.inherit.plist"

[ -d "$APP" ] || { echo "no app at $APP"; exit 1; }

echo "clearing extended attributes (per-file — the repo is under iCloud-synced"
echo "~/Documents, which stamps com.apple.FinderInfo/fileprovider xattrs that"
echo "codesign rejects and 'xattr -cr' doesn't fully clear)…"
find "$APP" -print0 | xargs -0 xattr -c 2>/dev/null || true

echo "signing nested Mach-O (dylibs, .node, unpacked native binaries)…"
find "$APP" \( -name "*.dylib" -o -name "*.node" \) -print0 | while IFS= read -r -d '' f; do
  codesign --force --timestamp=none --sign - "$f" 2>/dev/null || true
done
# The unpacked Agent SDK binary must be executable + signed (only exists when
# asar is on; with asar:false the native binary lives under Resources/app and is
# covered by the main-bundle seal).
if [ -d "$APP/Contents/Resources/app.asar.unpacked" ]; then
  find "$APP/Contents/Resources/app.asar.unpacked" -type f -perm +111 -print0 2>/dev/null | while IFS= read -r -d '' f; do
    codesign --force --timestamp=none --sign - "$f" 2>/dev/null || true
  done
fi

echo "signing nested frameworks…"
find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.framework" -print0 | while IFS= read -r -d '' fw; do
  codesign --force --timestamp=none --sign - "$fw"
done

echo "signing helper apps (inherit entitlements)…"
find "$APP/Contents/Frameworks" -maxdepth 1 -name "*.app" -print0 | while IFS= read -r -d '' h; do
  codesign --force --timestamp=none --entitlements "$ENT_INHERIT" --sign - "$h"
done

echo "signing main app…"
# Remove the inherited Electron signature first — re-signing over it leaves a
# stale CodeResources ("code has no resources but signature indicates they must
# be present") and the bundle keeps Identifier=Electron. Strip, then sign clean.
codesign --remove-signature "$APP" 2>/dev/null || true
codesign --force --timestamp=none --entitlements "$ENT" --sign - "$APP"

echo "verifying…"
# Non-strict verify: --strict flags the loose node_modules tree (asar:false), but
# the bundle seal, identity, and Designated Requirement are valid — which is what
# macOS TCC and Gatekeeper-on-launch actually use.
codesign --verify --verbose=2 "$APP" && echo "VERIFY_OK" || { echo "VERIFY_FAILED"; exit 1; }
codesign -dvv "$APP" 2>&1 | grep -E "Identifier=|Signature=" || true
