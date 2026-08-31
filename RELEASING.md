# Releasing

Releases are made from reviewed commits on `main` and use semantic version tags
in the form `vX.Y.Z`.

## Prepare

1. Update the root, gateway, adapter, mobile, app, and native-module version
   fields together.
2. Move relevant entries from `CHANGELOG.md`'s Unreleased section into a dated
   release section.
3. Run every applicable verification gate in `AGENTS.md`, including an image
   build and physical-device checks for native audio changes.
4. Merge the release pull request only after required CI, review, and CodeQL
   protection pass.

## Publish

Create the version tag on the reviewed `main` commit and push the tag. The CI
workflow repeats all automated checks before publishing the runtime image to
GHCR. It emits exact-version and commit-SHA tags plus OCI provenance and an
SBOM. `main`, `latest`, major, and minor tags are conveniences and are mutable.

Use the image digest from the successful publish job as the immutable release
identity. Verify that a logged-out or new account can pull it, start the image,
and pass `/health`.

If an official mobile build should launch that runtime by default, update
`DEFAULT_AGENT_RUNTIME_IMAGE` in
`mobile/src/providers/runtime-config.ts` to the verified digest in a separate
reviewed pull request. Forks can continue overriding the image at build time.

Create GitHub release notes from the matching changelog section. Do not publish
from an unreviewed branch or reuse an existing version tag.

## Rollback

Do not move an immutable version tag. Restore the prior verified digest in the
mobile runtime configuration or publish a new patch version containing the
revert.
