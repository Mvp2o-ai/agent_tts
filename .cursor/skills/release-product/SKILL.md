---
name: release-product
description: Releases the public agent_tts product and produces its installable artifacts. Use when the user says deploy, ship, release, publish, build for phone, make a binary, make a bundle, or wants phone use without Metro.
---

# Release the public product

In this repository, an unqualified “deploy”, “ship”, or “release” means publish
the open-source product artifacts. It does **not** mean deploy an operator’s
container to Railway or any other provider.

## Hard boundary

- While performing this public release flow, never open or run anything in
  `agent_tts-ops`.
- Never target Railway, a live provider project, or an operator host.
- A provider deployment is a downstream user action, not this repository’s
  CI/CD.
- Only touch an operator instance if the user explicitly names that instance
  or provider and asks to deploy it.

## Phone tests

Operator canary (`agent_tts-ops/scripts/railway-deploy.sh`) is **not** a
phone test. It deploys the ops `agent` service. The app’s agent tiles are
separate Railway projects on the published GHCR image. Never send the user
to the phone after a canary. Gateway changes they must feel on device go
through this release flow until those tiles run the new digest; then one
new session on an existing agent.

## Artifacts

- Runtime changes publish the BYOC container image to GHCR from `main`.
- “Phone use without Metro”, “standalone”, “binary”, “bundle”, or “install
  link” means an EAS `preview` internal-distribution build.
- A development client is not standalone; it still needs Metro.
- This project has no OTA update path. Any mobile JavaScript or native change
  needs a new preview build to reach a standalone phone.

## Release flow

1. Inspect and review only the requested product changes.
2. Run checks proportional to those changes.
3. Commit and push a focused branch.
4. Open or update its PR.
5. Merge when its applicable checks pass.
6. A runtime-changing PR must commit
   `node scripts/runtime-image-lock.mjs mark-pending`; CI rejects a ready lock
   after runtime inputs change.
7. For runtime/image changes, verify the `Publish runtime image` job on the
   resulting `main` run. Run the exact `mark-ready` command printed in its
   summary, open the separate runtime-lock PR, and merge it through CI.
8. Do not submit or reuse a mobile artifact until
   `node scripts/runtime-image-lock.mjs check` succeeds. This validates the
   runtime fingerprint, publishing commit, public GHCR digest, and OCI
   revision labels.
9. For mobile changes, or whenever the user asks for a standalone phone
   artifact, follow the `mobile-eas-device` skill and return the EAS build-page
   URL.

Do not process Dependabot PRs, dependency upgrades, or unrelated maintenance as
part of a release. They are separate work and must never serialize or delay the
requested product artifact.

Do not change or bypass repository protection as an incidental release step.
If the requested PR is genuinely blocked, report the exact failed required
check. The user decides whether protection policy itself should change.

## Waiting and completion

- Do not wait on unrelated PRs or checks.
- Submit EAS with `--no-wait`; the build page is the handoff and shows queue,
  build, and install status.
- Report runtime publication and EAS submission separately.
- A release is not blocked merely because unrelated Dependabot checks failed.
- A pending or stale runtime image lock is always release-blocking. Never
  bypass the local build guard or EAS pre-install hook.

## Handoff

State only what applies:

- merged PR and `main` commit;
- GHCR publish status (and immutable digest when available);
- standalone EAS preview link and current status;
- exact blocker, if one exists.
