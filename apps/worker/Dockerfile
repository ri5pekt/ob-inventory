## Build context: repo root (set in docker-compose.yml)

# ─── Base ───────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ─── Install dependencies ───────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json        ./apps/worker/package.json
COPY packages/db/package.json        ./packages/db/package.json
COPY packages/types/package.json     ./packages/types/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Build ──────────────────────────────────────────────
FROM deps AS builder
COPY . .

RUN pnpm --filter @ob-inventory/types build \
    && pnpm --filter @ob-inventory/db build \
    && pnpm --filter @ob-inventory/worker build

# ─── Production image ───────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

COPY --from=builder /app/apps/worker/dist        ./apps/worker/dist
COPY --from=builder /app/packages/db/dist        ./packages/db/dist
COPY --from=builder /app/packages/types/dist     ./packages/types/dist

COPY --from=deps /app/node_modules               ./node_modules
COPY --from=deps /app/apps/worker/node_modules   ./apps/worker/node_modules
COPY --from=deps /app/packages/db/node_modules   ./packages/db/node_modules

COPY package.json pnpm-workspace.yaml ./
COPY apps/worker/package.json       ./apps/worker/
COPY packages/db/package.json       ./packages/db/
COPY packages/types/package.json    ./packages/types/

CMD ["node", "apps/worker/dist/index.js"]
