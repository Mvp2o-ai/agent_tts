# Harness adapters

One module per harness, each exporting the same interface: start a turn from a
prompt string, stream text chunks and tool events, support hard abort.

Planned modules (M1 = claude-code, M5 = the rest):

- `claude-code.ts` — `claude -p` streaming JSON mode
- `gemini-cli.ts`
- `codex.ts`
- `cursor-cli.ts`
