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
4. A pull request that changes runtime build inputs must run
   `node scripts/runtime-image-lock.mjs mark-pending` and commit the pending
   lock. CI rejects runtime changes that leave the lock marked ready.
5. Merge the release pull request only after required CI, review, and CodeQL
   protection pass.

## Publish

Create the version tag on the reviewed `main` commit and push the tag. The CI
workflow repeats all automated checks before publishing the runtime image to
GHCR. It emits exact-version and commit-SHA tags plus OCI provenance and an
SBOM. `main`, `latest`, major, and minor tags are conveniences and are mutable.

Use the image digest from the successful publish job as the immutable release
identity. Verify that a logged-out or new account can pull it, start the image,
and pass `/health`.

The publish job prints the exact `runtime-image-lock.mjs mark-ready` command.
Run it with that job's digest and source commit, then merge the generated lock
change through a separate reviewed pull request. The ready lock records:

- the immutable image digest;
- the publishing source commit;
- a fingerprint of every runtime build input.

CI verifies the fingerprint, the source tree at the recorded commit, both
published Linux platform manifests, and their OCI revision labels. A pending
or mismatched lock blocks the official local EAS wrappers and the remote EAS
pre-install hook. There is no supported path to produce a mobile artifact
while its default runtime is stale.

Forks can continue overriding the image at build time, but their committed
default runtime lock remains subject to the same release gate.

Create GitHub release notes from the matching changelog section. Do not publish
from an unreviewed branch or reuse an existing version tag.

## Rollback

Do not move an immutable version tag. Restore the prior verified digest in the
mobile runtime configuration or publish a new patch version containing the
revert.
