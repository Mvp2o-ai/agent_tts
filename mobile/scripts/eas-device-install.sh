#!/usr/bin/env bash
# Guided bring-your-own-Expo standalone build. The final line is the install page.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"

usage() {
  echo "Usage: npm run install:device -- [ios|android]" >&2
}

PLATFORM="${1:-}"
if [[ -z "$PLATFORM" ]]; then
  if [[ ! -t 0 ]]; then
    usage
    exit 2
  fi
  printf "Install on (1) iPhone or (2) Android? [1]: " >&2
  read -r CHOICE
  case "${CHOICE:-1}" in
    1|ios|iPhone|iphone) PLATFORM="ios" ;;
    2|android|Android) PLATFORM="android" ;;
    *) usage; exit 2 ;;
  esac
fi
if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" ]]; then
  usage
  exit 2
fi

# A phone artifact must never embed a runtime digest older than its source.
node "$REPO_ROOT/scripts/runtime-image-lock.mjs" check

if [[ ! -f node_modules/expo/package.json ]]; then
  echo "Installing mobile dependencies…" >&2
  npm ci
fi

EAS=(npx --yes eas-cli@latest)
if ! ACCOUNT="$("${EAS[@]}" whoami 2>/dev/null)"; then
  echo "Sign in to the Expo account that should own this build." >&2
  "${EAS[@]}" login
  ACCOUNT="$("${EAS[@]}" whoami)"
fi
ACCOUNT="${ACCOUNT##*$'\n'}"

if [[ ! -f app-identity.local.json ]]; then
  if [[ ! -t 0 ]]; then
    echo "app-identity.local.json is missing; run this command interactively once." >&2
    exit 2
  fi
  SAFE_ACCOUNT="$(printf "%s" "$ACCOUNT" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')"
  SUGGESTED_ID="dev.user${SAFE_ACCOUNT:-fork}.agenttts"
  echo "Apple and Android require an app identifier unique to your fork." >&2
  printf "App identifier [%s]: " "$SUGGESTED_ID" >&2
  read -r APP_IDENTIFIER
  APP_IDENTIFIER="${APP_IDENTIFIER:-$SUGGESTED_ID}"
  if [[ ! "$APP_IDENTIFIER" =~ ^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*){2,}$ ]]; then
    echo "Use at least three dot-separated letter/number segments (for example, $SUGGESTED_ID)." >&2
    exit 2
  fi
  {
    printf '{\n'
    printf '  "bundleIdentifier": "%s",\n' "$APP_IDENTIFIER"
    printf '  "androidPackage": "%s"\n' "$APP_IDENTIFIER"
    printf '}\n'
  } >app-identity.local.json
fi

if [[ ! -f eas-project.local.json ]]; then
  if [[ -t 0 ]]; then
    printf "Expo account or organization [%s]: " "$ACCOUNT" >&2
    read -r REQUESTED_ACCOUNT
    ACCOUNT="${REQUESTED_ACCOUNT:-$ACCOUNT}"
  fi
  INIT_RESULT="$(mktemp)"
  trap 'rm -f "${INIT_RESULT:-}" "${EAS_ENV:-}"' EXIT
  "${EAS[@]}" init \
    --account "$ACCOUNT" \
    --json \
    --non-interactive >"$INIT_RESULT"
  node scripts/localize-eas-project.mjs "$INIT_RESULT" >&2
fi

# Upload only approved public identifiers. Never upload the gateway/voice .env.
if [[ -f .env.local ]]; then
  EAS_ENV="$(mktemp)"
  trap 'rm -f "${INIT_RESULT:-}" "${EAS_ENV:-}"' EXIT
  while IFS= read -r LINE || [[ -n "$LINE" ]]; do
    case "$LINE" in
      EXPO_PUBLIC_GITHUB_CLIENT_ID=*|\
      EXPO_PUBLIC_RAILWAY_CLIENT_ID=*)
        printf "%s\n" "$LINE" >>"$EAS_ENV"
        ;;
    esac
  done <.env.local
  if [[ -s "$EAS_ENV" ]]; then
    "${EAS[@]}" env:push preview --path "$EAS_ENV" --force
  fi
fi

echo "Submitting the standalone $PLATFORM app to EAS…" >&2
"${EAS[@]}" build \
  --profile preview \
  --platform "$PLATFORM" \
  --no-wait

# Keep the actionable result as the final line for terminals and coding agents.
bash scripts/print-dev-link.sh "$PLATFORM" preview
