# agentbox — one image, four coding harnesses, one adapter protocol.
# The gateway spawns this per session with the user's repo + credentials
# injected via env; the adapter clones the repo and drives the selected
# harness, speaking JSON-lines on stdin/stdout.

FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Harness CLIs. Versions pinned at M1; latest during scaffold.
RUN npm install -g \
    @anthropic-ai/claude-code \
    @google/gemini-cli \
    @openai/codex \
    cursor-cli

WORKDIR /opt/adapter
COPY adapter/package.json adapter/tsconfig.json ./
COPY adapter/src ./src
RUN npm install && npm run build

# Non-root user; repo is cloned to /workspace by the adapter at startup.
RUN useradd -m agent && mkdir /workspace && chown agent:agent /workspace
USER agent
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/adapter/dist/index.js"]
