# Node 24: node:sqlite is stable/unflagged (the config store depends on it).
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app
COPY package.json package-lock.json ./
COPY gateway ./gateway
COPY agentbox/adapter ./agentbox/adapter
RUN npm install \
    && npm run build --workspace=@agent_tts/gateway

WORKDIR /app/gateway
ENV NODE_ENV=production
EXPOSE 4100
CMD ["node", "dist/index.js"]
