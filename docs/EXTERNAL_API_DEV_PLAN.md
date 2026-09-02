# External API (Agent Access) — Development Plan

**Goal:** Let external clients — AI agents, scripts, future integrations — read data from OB
Inventory (products, stock, movements, sales, quotes, transfers, warehouses, customers, users)
over HTTP using a long-lived **API token**, completely separate from the JWT session used by
the web app.

Status: **Planning — not built yet.**

---

## Decisions Log

| Topic | Decision |
|---|---|
| Auth mechanism | New `api_tokens` table, opaque random token, hashed at rest (same pattern as `refresh_tokens`) |
| Token transport | `Authorization: Bearer <token>` header, same convention as the Woo webhook token |
| Scope for v1 | **Read-only.** All list/detail GET endpoints. No create/update/delete via the external API yet |
| Route namespace | New versioned prefix `/api/v1/*`, kept separate from the app's existing unversioned `/api/*` routes used by the SPA. `/api/*` can keep changing freely; `/api/v1/*` is a stable contract for outside consumers |
| Token management | Admin-only internal endpoints (`/api/tokens`, JWT + `role=admin`) to create/list/revoke tokens, plus a Settings UI page. Tokens are shown **once** on creation |
| Granularity | v1 tokens are all-or-nothing (read everything). Per-resource / per-warehouse scoping is a documented future phase, not built now |
| Rate limiting | `@fastify/rate-limit` (already a dependency, currently unused) applied only to `/api/v1/*`, keyed by token id |
| Pagination | Same convention as existing list endpoints: `limit` (default 100, max 1000) + `offset`, plus a `total` count so agents know when to stop paging |
| Incremental sync | Key resources accept `updatedSince` / `createdSince` (ISO date) so agents can poll deltas instead of re-pulling everything |
| Discoverability | Ship a machine-readable OpenAPI doc (`@fastify/swagger`) at `/api/v1/openapi.json` **and** a human/agent-readable Markdown reference (`docs/EXTERNAL_API_REFERENCE.md`) |
| Secrets never exposed | `users.passwordHash`, `stores.secretToken`/Woo API secret, Cardcom credentials, refresh/API token hashes are never returned by any `/api/v1` endpoint |
| Audit | New `api_token_requests` log (lightweight) — token id, method, path, status, ip, created_at — for usage visibility, separate from `audit_log` (which is user-centric) |

---

## Why a separate `/api/v1` namespace instead of reusing `/api/*`

The existing `/api/*` routes are internal — built for the SPA, shaped around what the frontend
needs, and free to change whenever the UI changes (e.g. the Cardcom document shape changed
mid-project). External agents need a contract that doesn't shift under them. A dedicated,
versioned prefix with its own auth (`authenticateApiToken` instead of `fastify.authenticate`)
keeps the two concerns from leaking into each other. If we ever need breaking changes, we add
`/api/v2/*` and keep `/api/v1/*` alive.

---

## Phase 1 — Schema & migration

New file `packages/db/src/schema/api-tokens.ts`:

```typescript
export const apiTokens = pgTable('api_tokens', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),               // "n8n agent", "Claude inventory bot"
  tokenPrefix: text('token_prefix').notNull(),        // first 10 chars, shown in UI for identification
  tokenHash:   text('token_hash').notNull().unique(), // sha256(rawToken)
  isActive:    boolean('is_active').notNull().default(true),
  expiresAt:   timestamp('expires_at', { withTimezone: true }),   // nullable = never expires
  lastUsedAt:  timestamp('last_used_at', { withTimezone: true }),
  createdBy:   uuid('created_by').references(() => users.id),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt:   timestamp('revoked_at', { withTimezone: true }),
})

export const apiTokenRequests = pgTable('api_token_requests', {
  id:         uuid('id').primaryKey().defaultRandom(),
  tokenId:    uuid('token_id').references(() => apiTokens.id, { onDelete: 'cascade' }),
  method:     text('method').notNull(),
  path:       text('path').notNull(),
  statusCode: integer('status_code').notNull(),
  ip:         text('ip'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Migration `packages/db/src/migrations/0023_add_api_tokens.sql`. Register in
`packages/db/src/schema/index.ts` and `packages/db/src/migrations/meta/_journal.json`, same as
every prior migration.

> **Pitfall carried over from `0022_add_quotes`:** Drizzle's migrator on production has skipped
> files after `0000` (anomalous timestamp) before. Deploy plan must apply `0023` via `psql`
> directly if `to_regclass('public.api_tokens')` is null after running `migrate.js`, exactly like
> the quotes deploy.

Token format: `obk_live_<32 random hex bytes>` (`obk` = "OB Key"). Prefix stored in plaintext
(`obk_live_a1b2c3d4`) so the UI can show "…a1b2c3d4" without ever re-displaying the secret.
Hash stored is `sha256(rawToken)` — consistent with how `refresh_tokens.tokenHash` already works
in `apps/api/src/routes/auth.ts`.

---

## Phase 2 — Token issuance & management (internal, JWT-protected)

New file `apps/api/src/routes/api-tokens.ts`, registered like every other route file in
`apps/api/src/index.ts`. All endpoints require `fastify.authenticate` + `role === 'admin'`
(same guard pattern used in `users.ts`).

```
GET    /api/tokens              list: id, name, tokenPrefix, isActive, lastUsedAt, expiresAt,
                                 createdAt, createdBy — never the hash
POST   /api/tokens              { name, expiresAt? }
                                 → generates raw token, stores hash, returns
                                   { id, name, token (shown once), tokenPrefix }
POST   /api/tokens/:id/revoke   sets isActive = false, revokedAt = now()
DELETE /api/tokens/:id          hard delete (only if never used, else force revoke instead)
GET    /api/tokens/:id/usage    recent api_token_requests for this token (last 100), for debugging
```

The raw token is **never** persisted anywhere in plaintext and is returned exactly once in the
`POST /api/tokens` response body. The UI must show a "copy now, you won't see this again"
warning, same spirit as GitHub/Stripe API keys.

---

## Phase 3 — External auth middleware

`apps/api/src/middleware/api-token-auth.ts`:

```typescript
fastify.decorate('authenticateApiToken', async function (request, reply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing Authorization header', code: 'UNAUTHORIZED' })
  }
  const raw = authHeader.slice(7)
  const tokenHash = crypto.createHash('sha256').update(raw).digest('hex')

  const [token] = await db.select().from(apiTokens).where(eq(apiTokens.tokenHash, tokenHash))

  if (!token || !token.isActive || token.revokedAt) {
    return reply.status(401).send({ error: 'Invalid or revoked token', code: 'INVALID_TOKEN' })
  }
  if (token.expiresAt && token.expiresAt < new Date()) {
    return reply.status(401).send({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
  }

  request.apiToken = token
  // fire-and-forget, don't block the request on logging
  void db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, token.id))
})
```

`onResponse` hook on the `/api/v1` scope writes one row to `api_token_requests` per call
(method, path, status, ip) — cheap, useful for "which agent is calling what" visibility in the
token usage page from Phase 2.

Register `@fastify/rate-limit` scoped to `/api/v1`, keyed by `request.apiToken.id` (fallback to
IP if somehow unauthenticated), e.g. 300 requests/minute per token, configurable via env
(`API_V1_RATE_LIMIT`).

---

## Phase 4 — Read-only v1 endpoints

All routes live under `apps/api/src/routes/v1/*.ts`, registered as a single `apiV1Routes` plugin
with `{ prefix: '/api/v1' }` and `onRequest: [fastify.authenticateApiToken]` applied at the
plugin level so every sub-route inherits it automatically.

Response envelope:
```jsonc
// list endpoints
{ "data": [ /* rows */ ], "pagination": { "limit": 100, "offset": 0, "total": 842 } }

// detail endpoints
{ "data": { /* single row */ } }
```

### Catalog
```
GET /api/v1/products            filters: sku, brandId, categoryId, search, updatedSince
                                 includes: brand name, category name, resolved attributes
GET /api/v1/products/:id
GET /api/v1/brands
GET /api/v1/categories
GET /api/v1/attributes          definitions + options (for decoding attribute values)
```

### Warehouses & inventory ("movements")
```
GET /api/v1/warehouses
GET /api/v1/inventory/stock     filters: warehouseId, productId, sku
                                 → current inventory_stock snapshot
GET /api/v1/inventory/movements filters: productId, warehouseId, actionType, dateFrom, dateTo
                                 → inventory_ledger rows (append-only history)
```

### Transfers
```
GET /api/v1/transfers           filters: fromWarehouseId, toWarehouseId, status, dateFrom, dateTo
GET /api/v1/transfers/:id       includes transfer_items
```

### Sales
```
GET /api/v1/sales               filters: saleType, status, warehouseId, storeId,
                                 dateFrom, dateTo, search
GET /api/v1/sales/:id           includes sale_items, payment methods, cardcom_documents
```

### Quotes
```
GET /api/v1/quotes              filters: status, warehouseId, dateFrom, dateTo
GET /api/v1/quotes/:id          includes quote_items
```

### Customers
```
GET /api/v1/customers           filters: search
GET /api/v1/customers/:id
```

### Users (metadata only — never credentials)
```
GET /api/v1/users               id, name, email, role, isActive, createdAt
GET /api/v1/users/:id
```

### Stores / integrations (metadata only — never secrets)
```
GET /api/v1/stores              id, name, url, platform, isActive
```

Every list endpoint reuses the existing `limit`/`offset` zod pattern already in
`apps/api/src/routes/sales.ts` (`z.coerce.number().int().min(1).max(1000).default(100)`), plus a
`total` count query so pagination is deterministic.

**Explicitly excluded from every response, regardless of resource:** `passwordHash`,
`tokenHash`, `secretToken`, Cardcom API credentials, refresh token hashes, `woo_sync_log`
payload/response blobs that may contain the Woo API secret in headers.

---

## Phase 5 — Admin UI

New page `apps/web/src/views/settings/ApiTokensView.vue`, route
`/settings/api-tokens` (`adminOnly: true`, same guard as `settings/users`), nav entry under
Settings alongside Users/Tools.

- Table: Name · Token (•••••••…prefix) · Status (Active/Revoked/Expired) · Last used · Created
- **New Token** button → modal: name + optional expiry → on submit, show the full raw token in a
  copyable box with "this is shown once" warning, then it disappears from state.
- **Revoke** button per row → confirmation dialog (same pattern as Cardcom document delete) →
  calls `POST /api/tokens/:id/revoke`.
- Optional: expand row to show recent `usage` (last N calls) from `GET /api/tokens/:id/usage`.

`apps/web/src/api/apiTokens.ts` — thin client wrapping the five endpoints from Phase 2.

---

## Phase 6 — Documentation for agents

1. **`docs/EXTERNAL_API_REFERENCE.md`** — human/LLM-readable reference: auth header format,
   base URL, every endpoint with example `curl`, filters, response shape, error codes, rate
   limit headers. This is the doc you'd paste into an agent's system prompt or point it at.
2. **OpenAPI spec** — `@fastify/swagger` + `@fastify/swagger-ui`, mounted only on the `/api/v1`
   plugin, exposed at `GET /api/v1/openapi.json`. This gives agents (and tools like the OpenAI
   / Anthropic tool-calling importers) a spec they can ingest directly instead of relying on
   prose. Zod schemas already used for validation can mostly be reused/mirrored for the schema
   definitions.

---

## Phase 7 — Hardening & rollout

- [ ] Rate limit tuned and tested (429 response includes `Retry-After`)
- [ ] `api_token_requests` cleanup — cron/worker job to prune rows older than N days so the log
      table doesn't grow unbounded (reuse the existing BullMQ worker, similar to how
      `woo_sync_log` is written)
- [ ] Load test the heaviest endpoint (`/api/v1/inventory/movements` — ledger can be large) with
      realistic filters + pagination
- [ ] `pnpm typecheck` clean, `docker compose build` clean (per the project's own Docker
      pitfalls doc — no `tsx` in prod, migrations copied into the image)
- [ ] Backup production DB before deploying migration `0023` (standard practice already used for
      every release — see `scripts/backup-production.py`)
- [ ] Deploy via `scripts/deploy-production.py`, extending the same "apply migration via `psql`
      if Drizzle skipped it" fallback added for `0022_add_quotes`
- [ ] Smoke test after deploy: create one real token via the UI, hit `GET /api/v1/products` and
      `GET /api/v1/inventory/movements` from an external client (e.g. `curl` from a machine that
      isn't the VPS) to confirm CORS/Caddy routing doesn't block `/api/v1/*`
- [ ] Confirm Caddy/nginx doesn't need a new route rule — `/api/v1/*` falls under the existing
      `/api/*` → api container proxy rule, but worth explicitly checking the Caddyfile pattern
      (e.g. `path /api/*` vs `path_regexp`) doesn't accidentally require the literal `/api/`
      prefix in a way that excludes `/api/v1/`

---

## Out of scope for v1 (documented, not built)

- **Write access** (creating sales, adjusting stock, etc.) via token auth — deliberately deferred.
  If needed later: add a `scopes` text[] column to `api_tokens` (e.g. `['read', 'write:sales']`),
  gate each mutating `/api/v1` route on the relevant scope, and require re-confirmation in the UI
  before issuing a write-capable token.
- **Per-warehouse scoping** — mirror the existing `user_warehouses` pattern with an
  `api_token_warehouses` join table if an agent should only see one warehouse's data.
- **Webhooks outbound to agents** (push instead of poll) — not requested; current need is agents
  *pulling* data on demand.

---

## Build sequence

```
Phase 1   Schema: api_tokens, api_token_requests + migration 0023
Phase 2   Internal token issuance endpoints (admin, JWT-protected)
Phase 3   authenticateApiToken middleware + rate limiting + request logging
Phase 4   Read-only /api/v1/* endpoints (products, inventory, movements, warehouses,
          transfers, sales, quotes, customers, users, stores)
Phase 5   Settings → API Tokens admin UI
Phase 6   EXTERNAL_API_REFERENCE.md + OpenAPI spec at /api/v1/openapi.json
Phase 7   Hardening, backup, deploy, smoke test
```
