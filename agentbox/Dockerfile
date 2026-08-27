# agentbox — one image, four coding harnesses, one adapter protocol.
# The gateway spawns this per session with the user's repo + credentials
# injected via env; the adapter clones the repo and drives the selected
# harness, speaking JSON-lines on stdin/stdout.

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/*

# CLIs in product order: Claude, Cursor, Gemini, Codex.
# Versions verified against `*-help` in this image on 2026-08-27:
#   claude 2.1.246, gemini 0.57.0, codex 0.150.1
# Cursor Agent CLI is curl-installed (verified binary 2026.08.25-3e8eec8).
RUN npm install -g \
      @anthropic-ai/claude-code@2.1.246 \
      @google/gemini-cli@0.57.0 \
      @openai/codex@0.150.1 \
    && curl -fsSL https://cursor.com/install | bash \
    # The cursor-agent launcher needs its whole versioned install dir;
    # relocate it somewhere world-readable and symlink the binary.
    && mv /root/.local/share/cursor-agent /opt/cursor-agent \
    && chmod -R a+rX /opt/cursor-agent \
    && ln -sf /opt/cursor-agent/versions/*/cursor-agent /usr/local/bin/agent

ENV DISABLE_AUTOUPDATER=1 \
    PATH="/usr/local/bin:/root/.local/bin:${PATH}"

WORKDIR /opt/adapter
COPY adapter/package.json adapter/tsconfig.json ./
COPY adapter/src ./src
RUN npm install && npm run build \
    && find src -name '*.test.ts' -delete

RUN useradd -m agent && mkdir /workspace && chown agent:agent /workspace

USER agent
RUN git config --global --add safe.directory /workspace \
    && git config --global --add safe.directory '*' \
    && git config --global init.defaultBranch main \
    && mkdir -p /home/agent/.claude /home/agent/.codex \
    && printf '{}\n' > /home/agent/.claude.json
ENV PATH="/usr/local/bin:/home/agent/.local/bin:${PATH}" \
    CI=1 \
    GIT_TERMINAL_PROMPT=0 \
    CODEX_HOME=/home/agent/.codex \
    NO_OPEN_BROWSER=1
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/adapter/dist/index.js"]
