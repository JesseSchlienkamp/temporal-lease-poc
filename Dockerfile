# One image, three roles. Pick the role with the container command:
#   node dist/temporal/worker.js        (default) Temporal worker + SQLite
#   node dist/api/server.js             HTTP API
#   node dist/mock-services/server.js   mock external services
#
# Use a glibc base image (not alpine): Temporal's native core and better-sqlite3 ship glibc prebuilds.
# Build for Azure from an Apple-silicon Mac with:  docker build --platform linux/amd64 .
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    DB_PATH=/app/data/leasing.db
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
CMD ["node", "dist/temporal/worker.js"]
