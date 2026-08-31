#!/usr/bin/env bash
# Print the EAS development-client build page URL ("the install link").
# Open that https://expo.dev/accounts/.../builds/... URL in Safari on the phone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PLATFORM="${1:-ios}"
PROFILE="${2:-preview}"
if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" ]]; then
  echo "Usage: bash scripts/print-dev-link.sh [ios|android] [profile]" >&2
  exit 2
fi

DEV_LINK="$(npx --yes eas-cli@latest build:list --platform "$PLATFORM" --limit 10 --json --non-interactive 2>/dev/null | node -e "
const profile = process.argv[1];
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const builds = JSON.parse(input);
  const build = builds.find(candidate =>
    candidate.buildProfile === profile &&
    ['FINISHED', 'IN_PROGRESS', 'IN_QUEUE', 'NEW'].includes(candidate.status)
  );
  if (!build) {
    console.log('NO_BUILD_FOUND');
    return;
  }
  const project = build.app ?? build.project;
  const owner = project.ownerAccount.name;
  console.log(
    \`https://expo.dev/accounts/\${owner}/projects/\${project.slug}/builds/\${build.id}\`
  );
});
" "$PROFILE")"

if [[ "$DEV_LINK" == "NO_BUILD_FOUND" ]]; then
  echo "NO_BUILD_FOUND for profile $PROFILE — run: npm run install:device -- $PLATFORM" >&2
  exit 1
fi

echo "$DEV_LINK"
