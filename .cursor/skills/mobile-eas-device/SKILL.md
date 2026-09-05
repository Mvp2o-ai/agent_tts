---
name: mobile-eas-device
description: >-
  Retrieves or submits the current EAS phone build for agent_tts. Use when the
  user asks for a phone link, install link, EAS/expo.dev URL,
  standalone/preview build, leave-the-Mac install, or development-client
  install.
---

# agent_tts — EAS install links

Return an `https://expo.dev/.../builds/...` URL for the requested source. Never
invent it. Never ask which kind. Never output `exp+…` or `agenttts://…`.

Simulator / Metro / localhost are not this skill — just run Expo against
`127.0.0.1` and open the sim.

## Intents

### Standalone (default)

**Say:** leave/close Mac, no Metro, standalone, preview, Safari install, vague
“give me a link” / “URL” / “phone link”

First run this from the repository root:

```bash
node scripts/runtime-image-lock.mjs check
```

Stop if it fails. Never submit or reuse a mobile artifact while the runtime
lock is pending, stale, not publicly pullable, or does not match its recorded
publishing commit.

Then inspect the latest `preview` build’s `gitCommitHash`. Reuse it only when
there are no changes under `mobile/` between that commit and the requested
release commit. A finished build is not necessarily the current build.

```bash
# from mobile/
npx eas-cli build:list --platform ios --limit 10 --json --non-interactive
# Select the newest preview candidate, then from the repository root:
git diff --quiet <candidate-gitCommitHash> <release-commit> -- mobile

# If no current preview exists:
npx eas-cli build --profile preview --platform ios --non-interactive --no-wait
bash scripts/print-dev-link.sh ios preview
```

**Reply:** `Standalone (no Mac): https://expo.dev/.../builds/<id>`

### Dev client install

**Say:** development client, native changed, reinstall the shell, EAS
development

```bash
bash scripts/print-dev-link.sh ios development
```

**Reply:** `Dev client install (needs Metro after): https://expo.dev/.../builds/<id>`

## Rules

- Default ambiguous requests to **standalone (preview)**.
- “Current” or “latest” means the requested release’s mobile source, not merely
  the newest build returned by EAS.
- This project has no OTA delivery. Rebuild preview for mobile JavaScript
  changes as well as native changes.
- The official local wrappers and EAS remote pre-install hook both reject a
  pending runtime lock. Never bypass either guard with a direct EAS command.
- Submit with `--no-wait`; return the build-page URL immediately. Do not wait
  on GitHub CI, Dependabot, or unrelated PRs.
- Do not give a development build when they want to leave the Mac.
- Product paths: `npm run install:device -- ios` (preview),
  `npm run eas:device:ios` (development).
- EAS project id / owner live in gitignored `mobile/eas-project.local.json`.
- Never deploy or inspect Railway while fulfilling an EAS build request.
