#!/usr/bin/env bash
# Print the EAS development-client build page URL ("the install link").
# Open that https://expo.dev/accounts/.../builds/... URL in Safari on the phone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEV_LINK="$(npx eas-cli build:list --platform ios --limit 10 --json --non-interactive 2>/dev/null | python3 -c "
import sys, json
builds = json.load(sys.stdin)
for b in builds:
    if b.get('buildProfile') == 'development' and b.get('status') in ('FINISHED', 'IN_PROGRESS', 'IN_QUEUE', 'NEW'):
        owner = b['project']['ownerAccount']['name']
        slug = b['project']['slug']
        print(f\"https://expo.dev/accounts/{owner}/projects/{slug}/builds/{b['id']}\")
        sys.exit(0)
print('NO_BUILD_FOUND')
")"

if [[ "$DEV_LINK" == "NO_BUILD_FOUND" ]]; then
  echo "NO_BUILD_FOUND — run: npm run eas:device:ios" >&2
  exit 1
fi

echo "$DEV_LINK"
