# Harness adapters

Each module maps a coding CLI's JSONL stream onto the box protocol:
start a turn from a prompt string, stream text chunks and tool events, hard abort.

**Yolo policy:** the Docker agentbox is the isolation boundary (non-root
`agent` user, ephemeral `--rm` container, empty `/workspace`). Every harness
runs fully unattended — no TTY permission prompts, no nested OS sandbox
that would block network or hang headless. Do not run these flags on a
developer laptop.

Install order in the image (and the default dropdown): Claude Code, Cursor CLI,
Gemini CLI, Codex CLI.

CLI versions pinned/verified in `agentbox/Dockerfile` (2026-08-27 `--help`):
Claude Code 2.1.246, Gemini CLI 0.57.0, Codex CLI 0.150.1, Cursor Agent
`2026.08.25-3e8eec8` (curl installer, unpinned), GitHub CLI 2.98.0.

| Module | Binary | Headless invocation |
|---|---|---|
| `claude-code.ts` | `claude` | `claude -p --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions` |
| `cursor-cli.ts` | `agent` | `agent -p --force --trust --approve-mcps --sandbox disabled --output-format stream-json --stream-partial-output` |
| `gemini-cli.ts` | `gemini` | `gemini -p … --output-format stream-json --yolo --skip-trust` (`GEMINI_CLI_TRUST_WORKSPACE=true`) |
| `codex.ts` | `codex` | `codex exec --json --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust` plus project `trust_level=trusted`; resume is `codex exec resume [OPTIONS] SESSION PROMPT`. `OPENAI_API_KEY` is mapped to `CODEX_API_KEY` for `codex exec`. |

Git: the adapter does **not** clone. `/workspace` starts empty. Clone/pull/push
use a host-scoped `http.extraheader` (never write the PAT into the remote URL
/ `.git/config`). The same PAT is `GH_TOKEN` so `gh pr checkout`, `gh pr create`,
and `gh pr review` work. `GIT_TERMINAL_PROMPT=0`. HTTPS push to that host works
only if the PAT has write scope. SSH remotes have no extraheader and there is
no ssh-agent in the box.
