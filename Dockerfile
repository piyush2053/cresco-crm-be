FROM node:24-bookworm-slim AS production

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates postgresql-client \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node database-scripts ./database-scripts
RUN mkdir -p /app/uploads /app/backups && chown -R node:node /app

USER node
EXPOSE 4000
CMD ["node", "src/index.js"]
