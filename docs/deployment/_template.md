# Provider guide template

Copy this file to `docs/deployment/<provider>.md` after a live deploy. Replace
every `TODO`. Keep the runtime contract in [README.md](./README.md); this file
is only the host-specific wiring.

## Status

- Provider:
- Date tested:
- Tester (GitHub handle):
- Plan/tier used:
- Public URL shape (e.g. `https://….up.example.com`):

## Why this host needs a guide

One paragraph: the behavior that is not obvious from a generic Docker deploy.

## Nuances (the whole point of this file)

Document only what operators would get wrong:

- Volume mount path and ownership
- Restart policy on **exit code 0** (session reset)
- Replica/scaling limits
- TLS + WebSocket idle timeouts
- `PORT` / public domain / health check
- Sleep/scale-to-zero (must stay off)
- Anything the vendor documents as “run as root”

## Steps

Numbered steps that produce a running agent. Prefer the vendor's current CLI
or dashboard; APIs change, so link to the official docs you used and the date.

## Secrets

Which variables are set on the host vs. pushed from the phone.

## Verify

```bash
curl --fail https://<host>/health
# Then from the app or:
# POST /v1/session/reset with GATEWAY_TOKEN
# Confirm the platform recreates the container and /health returns again.
```

## Cost / plan gotchas

Free-tier limits that break the contract (restart caps, sleeping, no volumes).
