# Install the mobile app with EAS

Expo Application Services (EAS) is an optional bridge from a source checkout
to a standalone iPhone app or Android APK. The build, signing
credentials, and Expo project remain in the forker's own accounts. Expo Go
cannot run this app because the voice path uses a local native module.

From the repository root:

```bash
npm run mobile:install
```

The guided command:

1. installs the mobile dependencies when needed;
2. asks for iPhone or Android;
3. signs in to Expo and creates an EAS project in the selected account;
4. creates a unique, local app identifier for the fork;
5. optionally uploads the fork's public GitHub App identifiers;
6. guides signing and iPhone device selection when Apple requires it;
7. submits a self-contained internal-distribution build; and
8. prints the `https://expo.dev/accounts/.../builds/...` install page.

Open that final URL on the phone. It is also the build-progress page, so the
same link works while the build is queued and after it finishes.

## Accounts and cost

- Both platforms require an Expo account. EAS has a limited free tier; queue
  priority and included build allowances depend on the current Expo plan.
- Installing an ad hoc build on a physical iPhone requires membership in the
  paid Apple Developer Program. The first build requires interactive Apple
  login/MFA and permission to create or reuse signing credentials.
- An Android internal build is an installable APK and does not require a
  Google Play developer account.

This is a guided one-command flow, not unattended first-time iOS provisioning:
Expo and Apple intentionally require the account owner to approve authentication
and signing.

## Local files and credentials

The command writes two ignored files under `mobile/`:

- `app-identity.local.json` — the fork's iOS bundle identifier and Android
  package name. These identifiers must be globally unique.
- `eas-project.local.json` — the Expo owner and EAS project ID.

Optional public build identifiers belong in `mobile/.env.local`, using
`mobile/.env.example` as the template. The installer uploads only these names
to the EAS `preview` environment:

```dotenv
EXPO_PUBLIC_GITHUB_CLIENT_ID=
EXPO_PUBLIC_GITHUB_APP_SLUG=
# EXPO_PUBLIC_RAILWAY_CLIENT_ID=
```

`EXPO_PUBLIC_*` values are compiled into the app and are never secrets. Do not
put Apple credentials, Expo tokens, gateway tokens, GitHub client secrets,
model keys, or voice-provider keys in that file. Apple signing
material stays with Apple/EAS; runtime secrets are entered in the app and kept
in the phone's secure credential storage.

## Repeat builds and direct commands

After the first successful build, the same installer reuses the local identity
and EAS-managed credentials:

```bash
npm run mobile:install
```

Platform-specific commands are also available from `mobile/`:

```bash
npm run install:device -- ios
npm run install:device -- android
bash scripts/print-dev-link.sh ios preview
```

The installed app contains its JavaScript bundle and does not need Metro.
Rebuild to deliver source or native changes through this standalone path. For
faster JavaScript iteration, build the separate `development` profile once and
run `npm start` from `mobile/` to connect that development client to Metro.

For local Xcode/Android Studio builds and TestFlight details, see
[`mobile/README.md`](../mobile/README.md).
