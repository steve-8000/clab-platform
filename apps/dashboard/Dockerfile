FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS builder
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:22-alpine AS runner
ENV NODE_ENV=production PORT=3000
RUN addgroup -S clab && adduser -S clab -G clab
WORKDIR /app

COPY --from=builder /app/apps/dashboard/.next/standalone ./
COPY --from=builder /app/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder /app/apps/dashboard/public ./apps/dashboard/public 2>/dev/null || true

USER clab
EXPOSE 3000

CMD ["node", "apps/dashboard/server.js"]
