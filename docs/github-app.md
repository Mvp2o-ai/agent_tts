# GitHub App setup

`agent_tts` uses a GitHub App user access token instead of asking users to
create personal access tokens. The mobile app performs GitHub Device Flow
directly; no callback service or client secret is required.

## Register the app

Create a GitHub App under the account or organization that will own the app:

1. Give it a public name and homepage URL.
2. Disable webhooks; this runtime does not receive them.
3. Enable **Device Flow**.
4. Under repository permissions, grant:
   - **Metadata:** Read-only
   - **Contents:** Read and write
   - **Pull requests:** Read and write
5. Keep **User-to-server token expiration** enabled. The mobile app stores the
   refresh token in native secure storage and rotates the access and refresh
   tokens before connecting a container.
6. Install the app and choose the repositories users may attach.

Do not grant Administration, Actions, Workflows, or organization permissions.
Contents write is required because opening a pull request also requires
pushing its branch.

## Build the mobile app

Copy the app's client ID (not its app ID) and URL slug into the mobile build
environment:

```bash
export EXPO_PUBLIC_GITHUB_CLIENT_ID=Iv1.example
export EXPO_PUBLIC_GITHUB_APP_SLUG=your-app-slug
cd mobile
npx expo run:ios
```

For EAS builds, define the same two public variables in the operator's EAS
environment. They identify the GitHub App and are safe to compile into the
client. Never put the GitHub App client secret in this repository, the mobile
app, or EAS public environment variables.

## User flow

In mobile Settings:

1. Tap **Connect GitHub** and enter the displayed code on GitHub.
2. Use **Manage GitHub repository access** if the app needs installation on
   additional repositories.
3. Refresh, multi-select repositories, and save to that agent's gateway.
4. Start a new session.

The app enumerates only repositories exposed by the user's GitHub App
installations. The recreated container clones each selection to a stable
`/workspace/owner--name` directory. Provisioning progress is shown on the Talk
screen. The microphone remains unavailable until every clone succeeds and the
harness reports ready. GitHub tokens are sent only for the live session and
are never written to the gateway's SQLite database.
