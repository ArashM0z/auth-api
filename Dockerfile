# syntax=docker/dockerfile:1
# Multi-stage build. node:24-slim (Debian) over alpine: Node's musl builds
# are officially "Experimental" support tier; glibc slim is the safe minimum.

FROM node:26-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# ---- prod dependencies only (no devDependencies in the final image) -------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- dev image: everything installed, hot reload via tsx ------------------
FROM base AS dev
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
CMD ["npx", "tsx", "watch", "src/server.ts"]

# ---- compile TypeScript ----------------------------------------------------
FROM dev AS build
ENV NODE_ENV=production
RUN npm run build

# ---- production image: compiled JS + prod deps, non-root, healthchecked ---
FROM base AS prod
# 'node' is the unprivileged uid-1000 user shipped in the official image.
USER node
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node package.json ./
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
# node receives signals directly (no npm wrapper) so graceful shutdown works.
CMD ["node", "dist/server.js"]
