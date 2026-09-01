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

| Module | Binary | Headless invocation | Per-prompt `model` / `effort` |
|---|---|---|---|
| `claude-code.ts` | `claude` | `claude -p --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions` | `--model <model>` and `--effort <effort>` before `--`. Effort is low, medium, high, xhigh, or max. Both override a resumed session. |
| `cursor-cli.ts` | `agent` | `agent -p --force --trust --approve-mcps --sandbox disabled --output-format stream-json --stream-partial-output` | `--model <model>` only. No effort flag — effort is baked into model slugs (e.g. `gpt-5.2-high`). `effort` is ignored. |
| `gemini-cli.ts` | `gemini` | `gemini -p … --output-format stream-json --yolo --skip-trust` (`GEMINI_CLI_TRUST_WORKSPACE=true`) | `--model <model>` only. gemini-cli v0.57 has no `--model-thinking-level`; `effort` is ignored. |
| `codex.ts` | `codex` | `codex exec --json --dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust` plus project `trust_level=trusted`; resume is `codex exec resume [OPTIONS] SESSION PROMPT`. `OPENAI_API_KEY` is mapped to `CODEX_API_KEY` for `codex exec`. | `--model <model>` and `-c model_reasoning_effort="<effort>"` on both `exec` and `exec resume`. Flags only — not written to `config.toml`. |

When the box `prompt` message omits `model` and `effort`, argv is unchanged.

Git: before the harness starts, the adapter clones every repository selected
for this container as a sibling under `/workspace`. Provisioning status is
streamed to the gateway and prompts remain locked until the adapter reports
`ready`. The harness may clone additional repositories afterward.

Clone/pull/push use a host-scoped `http.extraheader` (never write the GitHub
user access token into the remote URL or `.git/config`). The same token is
`GH_TOKEN` so `gh pr checkout`, `gh pr create`, and `gh pr review` work.
`GIT_TERMINAL_PROMPT=0`. SSH remotes have no extraheader and there is no
ssh-agent in the box.

GitHub auth is the live session identity for `git` and `gh`, not only startup
cloning. Mid-session connect/disconnect updates that identity. If `git` or
`gh` fails with missing, denied, unauthorized, or expired access, the harness
should ask the user to reconnect GitHub in the mobile app and retry after they
confirm — see `AGENTS.md` / `CLAUDE.md`.
