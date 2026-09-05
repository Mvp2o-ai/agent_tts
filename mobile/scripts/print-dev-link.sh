#!/usr/bin/env bash
# Print the EAS development-client build page URL ("the install link").
# Open that https://expo.dev/accounts/.../builds/... URL in Safari on the phone.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"

PLATFORM="${1:-ios}"
PROFILE="${2:-preview}"
if [[ "$PLATFORM" != "ios" && "$PLATFORM" != "android" ]]; then
  echo "Usage: bash scripts/print-dev-link.sh [ios|android] [profile]" >&2
  exit 2
fi

node "$REPO_ROOT/scripts/runtime-image-lock.mjs" check >/dev/null
if ! git -C "$REPO_ROOT" diff --quiet -- mobile ||
   ! git -C "$REPO_ROOT" diff --cached --quiet -- mobile; then
  echo "NO_CURRENT_BUILD: uncommitted mobile changes cannot reuse an EAS artifact" >&2
  exit 1
fi

DEV_LINK="$(npx --yes eas-cli@latest build:list --platform "$PLATFORM" --limit 10 --json --non-interactive 2>/dev/null | node -e "
const { spawnSync } = require('node:child_process');
const profile = process.argv[1];
const repoRoot = process.argv[2];
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const builds = JSON.parse(input);
  const build = builds.find(candidate =>
    candidate.buildProfile === profile &&
    ['FINISHED', 'IN_PROGRESS', 'IN_QUEUE', 'NEW'].includes(candidate.status) &&
    typeof candidate.gitCommitHash === 'string' &&
    spawnSync(
      'git',
      ['diff', '--quiet', candidate.gitCommitHash, 'HEAD', '--', 'mobile'],
      { cwd: repoRoot }
    ).status === 0
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
" "$PROFILE" "$REPO_ROOT")"

if [[ "$DEV_LINK" == "NO_BUILD_FOUND" ]]; then
  echo "NO_BUILD_FOUND for profile $PROFILE — run: npm run install:device -- $PLATFORM" >&2
  exit 1
fi

echo "$DEV_LINK"
