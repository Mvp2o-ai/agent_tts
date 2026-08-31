# Security policy

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability and do not include
tokens, API keys, private repository details, or live host URLs in any report.

Use [GitHub private vulnerability reporting](https://github.com/Mvp2o-ai/agent_tts/security/advisories/new).
Include the affected version or commit, impact, reproduction, and any suggested
remediation. A maintainer will acknowledge the report and coordinate disclosure
and a fix through the private advisory.

## Supported versions

Security fixes are made on `main` and included in the next tagged runtime image.
Only the latest release is supported.

## Security boundary

Operators own their hosts, provider accounts, repositories, and credentials.
See `AGENTS.md` for the repository's credential-handling and non-root runtime
requirements.
