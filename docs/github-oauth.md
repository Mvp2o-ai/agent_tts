# GitHub OAuth

`agent_tts` uses an upstream GitHub OAuth App so a clean fork works without
creating or installing another GitHub application. The mobile app performs
GitHub Device Flow directly and never embeds a client secret.

## User flow

1. Tap **Connect GitHub**.
2. Sign in and authorize Agent TTS on GitHub.
3. Select an optional startup repository set for an agent.
4. Start a new session.

The OAuth flow requests `repo` so the token can list, clone, push, and open
pull requests for repositories available to the user. It also requests
`offline_access` so expiring tokens can be refreshed. The token stays in the
phone's native secure storage and is sent to the gateway only for a live
session; the gateway never persists it in SQLite. Connect or disconnect can
update the live session’s git/`gh` identity without recreating the container.
If the token is missing, denied, or expired, the app prompts the operator to
reconnect GitHub; harnesses on the box should ask for that reconnect rather
than inventing alternate auth.

The optional startup repository set selected in Agent TTS controls which
repositories are cloned before a new container session's harness starts. It is
not a live workspace inventory, and it does not narrow the underlying GitHub
OAuth grant: `repo` permits access to the user's available private
repositories.

## Public client configuration

The upstream OAuth client ID is committed in
`mobile/src/product-config.ts`. It is public application identity, not a
credential. A fork works with that default and needs no GitHub setup.

A rebranded fork may create its own GitHub OAuth App with Device Flow enabled
and override the client ID at build time:

```bash
export EXPO_PUBLIC_GITHUB_CLIENT_ID=Ov23.example
```

For EAS builds, place the same optional public override in the fork's EAS
environment. Never put a GitHub client secret in this repository, the mobile
app, or an `EXPO_PUBLIC_*` variable.

## Repository provisioning

Each recreated container clones the selected startup repositories to stable
`/workspace/owner--name` directories before the harness reports ready. The
mobile app passes the current OAuth token over the authenticated session
socket. Git and `gh` receive it through host-scoped environment configuration;
it is never written into a clone URL or `.git/config`. Any additional
in-session clones are owned by the harness and are not added to the startup
set.
