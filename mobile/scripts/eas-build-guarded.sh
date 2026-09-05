#!/usr/bin/env bash
set -euo pipefail

MOBILE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$MOBILE_ROOT/.." && pwd)"
PROFILE="${1:?usage: eas-build-guarded.sh <profile> <ios|android>}"
PLATFORM="${2:?usage: eas-build-guarded.sh <profile> <ios|android>}"

if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" ]]; then
  echo "platform must be ios or android" >&2
  exit 2
fi

node "$REPO_ROOT/scripts/runtime-image-lock.mjs" check

cd "$MOBILE_ROOT"
exec npx eas-cli build \
  --profile "$PROFILE" \
  --platform "$PLATFORM"
