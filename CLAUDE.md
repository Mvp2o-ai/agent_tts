# Claude / harness guidance for agent_tts

Follow [`AGENTS.md`](./AGENTS.md) for the full product and contribution
contract. This file calls out the GitHub auth rule that every harness on the
box must obey.

## GitHub: `git`, `gh`, and reconnect

- The agent box ships **`git` and `gh`**. Use them for clone, fetch, push, PR
  checkout/create/review, and other GitHub work.
- Session auth comes from the phone (**Connect GitHub**). It is injected as a
  host-scoped `git` extraheader and `GH_TOKEN`. Never put a token in a remote
  URL or `.git/config`.
- GitHub auth is the **live** git/`gh` identity for the session. The operator
  can sign in or out from the phone while the container is already up.
- If access is missing, denied, unauthorized, or expired — **ask the user to
  reconnect GitHub in the mobile app**, then continue after they confirm.
  Do not invent alternate credentials or work around a failed auth.
- Optional startup repositories are only the next-session clone template.
  They do not define whether GitHub auth is present.
