# Contributing

This project takes **pull requests into `main`**. A fork and a pull request are
not alternatives: a fork is the contributor's copy of the repository, and a
pull request proposes merging a branch from that fork back into this project.
Maintainers can open the same kind of pull request from a branch in this repo.
Both paths have the same review and CI requirements.

Do not push commits straight to `main`.

## Contribution flow

1. Fork the repository (external contributors) or create a repository branch
   (maintainers).
2. Branch from the latest `main` and keep the change focused.
3. Run the local checks below and add tests for changed behavior.
4. Open a draft pull request early if design feedback would avoid rework.
5. Address review and CI findings. Update the branch with `main` when GitHub
   reports it is out of date.
6. A maintainer merges after approval, resolved conversations, and green CI.

Typical external setup:

```bash
git clone https://github.com/YOUR-ACCOUNT/agent_tts.git
cd agent_tts
git remote add upstream https://github.com/Mvp2o-ai/agent_tts.git
git fetch upstream
git switch -c your-change upstream/main
```

Push the branch to `origin`, open a pull request against
`Mvp2o-ai/agent_tts:main`, and sync from `upstream/main` when GitHub reports the
branch is out of date. Never commit `.env`, generated `ios/` or `android/`
trees, local app identity files, provider state, or SQLite databases.

Maintainers squash-merge ordinary pull requests. The pull request title should
therefore describe the resulting change clearly.

## Merge bar

The required `All checks` status verifies:

- Gateway and adapter: ESLint, TypeScript, tests, and production build
- Mobile: Expo ESLint, TypeScript, tests, and public config generation
- Android native module: generated-project compilation and unit tests
- Runtime image: build, non-root startup, health, and adapter round-trip when
  image inputs changed

The image is published to GHCR only after merge to `main` or on a version tag.
A fork pull request has a read-only token, receives no repository secrets, and
never publishes an image.

There is no web client, so browser E2E tools such as Cypress and Playwright do
not test this product. Native audio and device behavior require the physical
device checks in `AGENTS.md`. Hosting is bring-your-own, so Terraform or Pulumi
containing live operator state, credentials, project IDs, or required hosted
infrastructure does not belong in this public repository. Credential-free,
generic provider examples may be accepted under `docs/deployment/` after
disposable-account validation. Reusable provider launch behavior and generic
deployment documentation belong here.

## Local check (same as CI)

From the repository root:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Then the mobile workspace:

```bash
cd mobile
npm ci
npm run lint
npm run typecheck
npm test
```

Run the additional image, voice, and physical-device gates in `AGENTS.md` when
the affected area requires them.

## Issues and security

Use an issue template for reproducible bugs and product proposals. Keep support
questions concrete and include sanitized environment details.

Report vulnerabilities through the private process in `SECURITY.md`. Never put
credentials, private repository details, or live agent URLs in an issue, pull
request, test fixture, or log.

## License

By submitting a contribution, you agree that it is licensed under AGPL-3.0,
the same license as the repository.
