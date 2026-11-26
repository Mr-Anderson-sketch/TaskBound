#!/usr/bin/env bash
# Signed macOS build. macOS ties the Automation permission ("TimeBound wants to control
# Chrome") to the code signature, so an unsigned build loses that permission on every
# rebuild. This picks a signing identity from the keychain and passes it to Tauri.
#
#   npm run build:mac                         # auto-detect
#   APPLE_SIGNING_IDENTITY="..." npm run build:mac
#
# "Developer ID Application" builds can be shared once notarized. "Apple Development"
# builds are for this machine only.
set -euo pipefail

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  identities="$(security find-identity -v -p codesigning)"
  for kind in "Developer ID Application" "Apple Development"; do
    match="$(printf '%s\n' "$identities" | sed -n "s/.*\"\(${kind}: [^\"]*\)\".*/\1/p" | head -n 1)"
    if [[ -n "$match" ]]; then
      APPLE_SIGNING_IDENTITY="$match"
      break
    fi
  done
fi

if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  echo "No code-signing identity found. Install an Apple Development or Developer ID certificate." >&2
  exit 1
fi

case "$APPLE_SIGNING_IDENTITY" in
  "Apple Development:"*) echo "Signing with $APPLE_SIGNING_IDENTITY (local use only, not distributable)." ;;
  *) echo "Signing with $APPLE_SIGNING_IDENTITY." ;;
esac

export APPLE_SIGNING_IDENTITY
exec npx tauri build "$@"
