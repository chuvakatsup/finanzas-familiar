# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22.23.3-alpine3.24

# ---- base: pnpm vía corepack (versión fijada en package.json "packageManager") ----
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---- deps ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && pnpm build:scripts

# ---- runner: solo lo necesario, usuario sin privilegios ----
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=America/Mazatlan \
    MIGRATIONS_DIR=/app/drizzle
RUN apk add --no-cache tzdata

# Archivos propiedad de root (solo lectura para el usuario "node").
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist-scripts ./scripts
COPY --from=build /app/drizzle ./drizzle

USER node
EXPOSE 3000
# Aplica migraciones pendientes y arranca.
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node server.js"]
