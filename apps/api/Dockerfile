## Build context: repo root (set in docker-compose.yml)

# ─── Base ───────────────────────────────────────────────
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# ─── Install dependencies ───────────────────────────────
FROM base AS deps
WORKDIR /app

# Copy only the manifests needed for this app and its workspace deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/api/package.json           ./apps/api/package.json
COPY packages/db/package.json        ./packages/db/package.json
COPY packages/types/package.json     ./packages/types/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Build ──────────────────────────────────────────────
FROM deps AS builder
COPY . .

RUN pnpm --filter @ob-inventory/types build \
    && pnpm --filter @ob-inventory/db build \
    && pnpm --filter @ob-inventory/api build

# Copy migration SQL files into the build so they land in dist/migrations
RUN mkdir -p apps/api/dist/migrations
COPY packages/db/src/migrations/*.sql apps/api/dist/migrations/

# ─── Production image ───────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Copy built artifacts
COPY --from=builder /app/apps/api/dist         ./apps/api/dist
COPY --from=builder /app/packages/db/dist      ./packages/db/dist
COPY --from=builder /app/packages/types/dist   ./packages/types/dist

# Copy production node_modules
COPY --from=deps /app/node_modules             ./node_modules
COPY --from=deps /app/apps/api/node_modules    ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules

# Copy manifests (needed for module resolution)
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json         ./apps/api/
COPY packages/db/package.json      ./packages/db/
COPY packages/types/package.json   ./packages/types/

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]
