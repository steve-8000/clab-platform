# ============================================================================
# Dockerfile — Multi-stage build for all clab-platform services
# Usage:  docker build --build-arg SERVICE=api-gateway --build-arg PORT=4000 -t clab/api-gateway:v1 .
# ============================================================================

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- Install + Build ---
FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

# --- Production runner (keep full monorepo for pnpm symlinks) ---
FROM node:22-alpine AS runner
ARG SERVICE
ARG PORT=4000
ENV NODE_ENV=production PORT=${PORT}

RUN addgroup -S clab && adduser -S clab -G clab
WORKDIR /app

# Copy entire built workspace (pnpm needs symlink structure)
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/${SERVICE}/dist ./apps/${SERVICE}/dist
COPY --from=builder /app/apps/${SERVICE}/package.json ./apps/${SERVICE}/
COPY --from=builder /app/apps/${SERVICE}/node_modules ./apps/${SERVICE}/node_modules
COPY --from=builder /app/packages ./packages

USER clab
EXPOSE ${PORT}

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

WORKDIR /app/apps/${SERVICE}
CMD ["node", "dist/index.js"]
