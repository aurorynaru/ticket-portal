# syntax=docker/dockerfile:1
# TEMPLATE: becomes buildable after the local coding agent completes P0.
# No persistent SQLite data is created in this image.
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

# Native addon toolchain stays only in the build image.
# better-sqlite3 may use a prebuilt addon or compile via node-gyp.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
# P0 must implement: tsc -> dist/ and compiled Tailwind -> public/.
RUN npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/tickets.db \
    UPLOAD_DIR=/data/uploads

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/views ./src/views
COPY --from=build /app/public ./public
COPY --from=build /app/migrations ./migrations

# Railway must attach a persistent volume at /data (configured in Railway).
# Do not rely on Docker VOLUME or COPY to create/persist the Railway volume.
# The Node app must run reviewed migrations *after* /data mounts and before listen.
# Default root user: Railway volumes are root-owned; see security tradeoff in docs.
EXPOSE 3000
CMD ["node", "dist/server.js"]
