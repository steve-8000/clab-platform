# ============================================================================
# Dockerfile — Multi-stage build for all clab-platform services
# Usage:  docker build --build-arg SERVICE=mission-service --build-arg PORT=4001 -t clab/mission-service:v1 .
# ============================================================================

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

# --- Install all deps ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.json ./
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile

# --- Build all packages + target app ---
FROM deps AS builder
ARG SERVICE
RUN pnpm build

# --- Production runner ---
FROM node:22-alpine AS runner
ARG SERVICE
ARG PORT=4000
ENV NODE_ENV=production PORT=${PORT}
RUN addgroup -S clab && adduser -S clab -G clab
WORKDIR /app

COPY --from=builder /app/apps/${SERVICE}/dist ./dist
COPY --from=builder /app/apps/${SERVICE}/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/*/dist ./packages/

USER clab
EXPOSE ${PORT}

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

CMD ["node", "dist/index.js"]
