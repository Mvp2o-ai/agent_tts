---
name: mobile-eas-device
description: >-
  Retrieves the correct EAS Safari install URL for agent_tts. Use when the user
  asks for a phone link, install link, EAS/expo.dev URL, standalone/preview
  build, leave-the-Mac install, or development-client install.
---

# agent_tts — EAS install links

Skills retrieve things. This one retrieves an `https://expo.dev/.../builds/...`
URL. Never invent it. Never ask which kind. Never output `exp+…` or
`agenttts://…`.

Simulator / Metro / localhost are not this skill — just run Expo against
`127.0.0.1` and open the sim.

## Intents

### Standalone (default)

**Say:** leave/close Mac, no Metro, standalone, preview, Safari install, vague
“give me a link” / “URL” / “phone link”

```bash
# from mobile/
bash scripts/print-dev-link.sh ios preview
# if NO_BUILD_FOUND:
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
- Do not give a development build when they want to leave the Mac.
- Product paths: `npm run install:device -- ios` (preview),
  `npm run eas:device:ios` (development).
- EAS project id / owner live in gitignored `mobile/eas-project.local.json`.
