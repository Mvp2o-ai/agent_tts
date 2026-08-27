# agentbox — one image, four coding harnesses, one adapter protocol.
# The gateway spawns this per session with git/gh credentials injected via
# env. The adapter does not clone. The harness owns remotes, branches, and PRs.

FROM node:22-bookworm-slim

ARG GH_VERSION=2.98.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates curl ripgrep python3 \
    && rm -rf /var/lib/apt/lists/* \
    && arch="$(dpkg --print-architecture)" \
    && case "$arch" in amd64) gharch=amd64 ;; arm64) gharch=arm64 ;; *) echo "unsupported arch: $arch" >&2; exit 1 ;; esac \
    && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${gharch}.tar.gz" \
      | tar -xz -C /tmp \
    && mv "/tmp/gh_${GH_VERSION}_linux_${gharch}/bin/gh" /usr/local/bin/gh \
    && rm -rf "/tmp/gh_${GH_VERSION}_linux_${gharch}" \
    && git --version \
    && gh --version

# CLIs in product order: Claude, Cursor, Gemini, Codex.
# Versions verified against `*-help` in this image on 2026-08-27:
#   claude 2.1.246, gemini 0.57.0, codex 0.150.1, gh 2.98.0
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
    && git config --global user.email "agent@localhost" \
    && git config --global user.name "agent" \
    && mkdir -p /home/agent/.claude /home/agent/.codex /home/agent/.config/gh \
    && printf '{}\n' > /home/agent/.claude.json \
    && gh config set git_protocol https
ENV PATH="/usr/local/bin:/home/agent/.local/bin:${PATH}" \
    CI=1 \
    GIT_TERMINAL_PROMPT=0 \
    CODEX_HOME=/home/agent/.codex \
    NO_OPEN_BROWSER=1
WORKDIR /workspace

ENTRYPOINT ["node", "/opt/adapter/dist/index.js"]
