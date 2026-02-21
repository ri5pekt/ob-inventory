# OB Inventory — Development Plan

## Decisions Log

| Topic | Decision |
|---|---|
| WooCommerce | Existing store, bidirectional integration + custom WP plugin |
| Users | 2–3 admins, RBAC infrastructure built, simple roles initially |
| Frontend approach | Visualize-first — UI built alongside API phase by phase |
| State management | Pinia (app state) + TanStack Query (server data) |
| ORM | Drizzle ORM |
| WooCommerce inbound | Woo order → immediate stock decrement (treated as completed) |
| Partner sales | Admin enters via UI (phone/email reports) |
| Low-stock alerts | Bonus feature, deferred |
| SKU uniqueness | Globally unique, enforced at DB level |
| Bin location | Single text field on product (`bin_location`), multi-box noted freeform e.g. "101, 203" |
| Variants | Each color/size combination = unique SKU (no grouped variant entity in DB) |
| Data migration | CSV import script; opening stock loaded as ledger entries |
| Product attributes | `model`, `size`, `color`, `unit` are dynamic attributes (not fixed columns); admin can define new attributes at any time |
| Attribute options uniqueness | `(definition_id, code)` unique constraint enforced |
| Barcode | Dropped from fixed schema; admin can add as a custom text attribute if needed |
| Soft delete | Not implemented in Phase 1; deferred |
| Adjustment below zero | Hard fail — `inventory_stock.quantity >= 0` CHECK constraint enforced; no override |
| Woo stock sync path | Worker calls plugin endpoint `PUT /wp-json/ob-inventory/v1/stock` authenticated with `WOO_PLUGIN_API_KEY` |
| Woo stock sync trigger | API service layer explicitly enqueues BullMQ `sync-woo-stock` job after each mutation affecting main warehouse stock |
| Product Families page | Removed from scope |

---

## Repository Structure

```
ob-inventory/
├── apps/
│   ├── api/                  # Fastify backend
│   ├── worker/               # BullMQ worker process
│   └── web/                  # Vue 3 frontend
├── packages/
│   ├── db/                   # Drizzle schema, migrations, DB client (shared)
│   └── types/                # Shared TypeScript DTOs and enums
├── woo-plugin/               # WordPress plugin (PHP)
│   └── ob-inventory-sync/
├── scripts/
│   └── import-csv.ts         # One-time inventory migration script
├── docs/
├── docker-compose.yml        # Production (all services)
├── docker-compose.dev.yml    # Dev (postgres + redis only)
├── Caddyfile
├── .env.example
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

---

## Phase 0 — Infrastructure & Scaffolding

**Goal:** All services boot and connect. Developer environment is one command.

- `docker-compose.yml` services: `postgres`, `redis`, `api`, `worker`, `web`, `caddy`
- `docker-compose.dev.yml` — postgres + redis only (Node apps run natively in dev)
- `Caddyfile` — `/api/*` → api (port 3000), `/*` → web
- pnpm workspace config
- TypeScript configs per package (`strict: true` everywhere)
- ESLint + Prettier
- `.env.example` with all required keys
- **Startup env validation** — `zod` schema validates all env vars at process start; fails loudly if misconfigured
- Health check: `GET /api/health` → `{ status: "ok", db: "ok", redis: "ok" }`

---

## Phase 1 — Database Schema

**Goal:** All tables defined with Drizzle, migrations run cleanly, relationships enforced.

### Catalog

**`brands`**
```
id, name (unique), created_at
```

**`categories`**
```
id, name (unique), created_at
```

**`attribute_definitions`** — admin-managed list of product attribute types
```
id
name          text, unique (e.g. "size", "color", "unit", "model")
input_type    enum: select | text | number
is_required   boolean, default false
sort_order    integer
created_at
```
Seeded on first run: `model` (select), `size` (select), `color` (select), `unit` (select)

**`attribute_options`** — values for `select`-type attributes; admin can add new values
```
id
definition_id   → attribute_definitions
code            text (e.g. "XL", "BK", "PIECE")
label           text (e.g. "XL", "Black", "Piece")
sort_order      integer
UNIQUE (definition_id, code)
```
Seeded from CSV data on first run.

**`product_attributes`** — stores each product's attribute values
```
product_id      → products  \
definition_id   → attribute_definitions  > composite primary key
option_id       → attribute_options, nullable (used when input_type = 'select')
value_text      text, nullable            (used when input_type = 'text')
value_number    numeric, nullable         (used when input_type = 'number')
```

**`products`**
```
id
sku             unique, required
name
brand_id        → brands
category_id     → categories
bin_location    text, nullable (e.g. "101" or "101, 203")
base_price      numeric, nullable
woo_product_id  nullable integer
notes
created_by      → users
created_at, updated_at
```

### Inventory

**`warehouses`**
```
id, name, type (enum: main | partner | other), is_active, notes, created_at
```

**`inventory_ledger`** — append-only, immutable
```
id
product_id            → products
warehouse_id          → warehouses
action_type           enum: receive | transfer_in | transfer_out | sale | return | adjustment
quantity_delta        integer (signed: positive = in, negative = out)
reference_id          uuid, nullable (points to sale/transfer/adjustment)
reference_type        text, nullable ('sale' | 'transfer' | 'adjustment')
supplier_ref          nullable (for receive actions)
date_received         nullable (for receive actions)
reason                nullable, required for adjustments
notes
created_by            → users
created_at
```

**`inventory_stock`** — denormalized current stock, updated transactionally with ledger
```
product_id            → products  \
warehouse_id          → warehouses  > composite primary key
quantity              integer, CHECK >= 0
updated_at
```

### Transfers

**`transfers`**
```
id, from_warehouse_id, to_warehouse_id, notes, created_by, created_at
```

**`transfer_items`**
```
id, transfer_id, product_id, quantity
```

### Sales

**`sales`** — three independent state fields
```
id
sale_type             enum: direct | partner | woocommerce
warehouse_id          → warehouses
fulfillment_state     enum: draft | prepared | shipped | delivered | cancelled | returned
payment_state         enum: unpaid | paid | refunded
invoice_state         enum: pending | invoice_created | tax_invoice_created | credited | not_required
customer_name         nullable
customer_ref          nullable (partner name, WC order number, etc.)
woo_order_id          nullable
notes
created_by            → users
created_at, updated_at
```

**`sale_items`**
```
id, sale_id, product_id, quantity, unit_price
```

### Users & Auth

**`users`**
```
id, email (unique), password_hash, name, role (enum: admin | staff), is_active, created_at, updated_at
```

**`refresh_tokens`**
```
id, user_id, token_hash, expires_at, created_at, revoked_at
```

### Integrations

**`woo_sync_log`**
```
id, product_id, woo_product_id, action (push_stock | pull_order),
status (pending | success | failed), payload (jsonb), response (jsonb),
error, attempts, created_at, completed_at
```

### Audit

**`audit_log`**
```
id, user_id, action, entity, entity_id, before (jsonb), after (jsonb), ip, created_at
```

### Key DB Constraints
- `inventory_stock.quantity >= 0` — CHECK constraint (adjustments that would go negative are hard-rejected)
- `products.sku` — UNIQUE index
- `attribute_definitions.name` — UNIQUE index
- `attribute_options (definition_id, code)` — UNIQUE index
- `product_attributes (product_id, definition_id)` — composite primary key (one value per attribute per product)
- All FK columns indexed
- `inventory_ledger.created_at`, `sales.created_at` — indexed for range queries

---

## Phase 1.5 — Data Migration Script

**Goal:** Import all 700+ real SKUs from `INVENTORY.csv` as opening stock.

`scripts/import-csv.ts` logic:
1. Parse CSV, skip blank rows
2. Deduplicate SKUs — if same SKU appears in multiple rows (different box numbers), **sum QTY** and **concatenate bin_locations** (e.g., "Box 101, Box 203")
3. Normalize: trim whitespace, upper-case SKUs, map `bc` dates → null, blank QTY → 0
4. Upsert reference data: brands, categories
5. Upsert `attribute_definitions` for `model`, `size`, `color`, `unit` (if not already seeded)
6. Upsert `attribute_options` for all distinct model/size/color/unit values from CSV
7. Insert products (fixed columns only)
8. Insert `product_attributes` rows for model, size, color, unit per product
9. For every product with `QTY > 0`: write one `inventory_ledger` entry (`action_type: receive`, notes: "Opening stock import") and set `inventory_stock.quantity`
10. Skip rows with blank SKU, report them to console
11. Idempotent — safe to re-run

---

## Phase 2 — Backend Foundation

**Goal:** Auth works, RBAC enforced, audit trail automatic, error handling consistent.

### Fastify Plugins
- `@fastify/jwt` — access token verification
- `@fastify/cookie` — refresh token via httpOnly cookie
- `@fastify/cors`, `@fastify/helmet`, `@fastify/rate-limit`
- `pino` — structured JSON logs (built into Fastify)

### Authentication
- `POST /api/auth/login` — access token (15 min) + refresh token in httpOnly cookie (30 days, stored hashed in DB)
- `POST /api/auth/refresh`
- `POST /api/auth/logout` — revokes refresh token
- `GET  /api/auth/me`
- Passwords hashed with **argon2**

### RBAC
- Fastify `preHandler` hooks: `requireAuth`, `requireRole('admin')`
- Roles: `admin` (full access), `staff` (read + limited write)

### Audit Trail
- Service-layer wrapper writes to `audit_log` within the same DB transaction as the mutating operation

### Error Handling
- All request bodies validated with `zod`
- Consistent error shape: `{ error: string, code: string, details?: object }`
- 400 validation | 401 auth | 403 permission | 404 not found | 409 conflict (duplicate SKU)

---

## Phase 3 — Core Domain APIs

### Catalog
```
GET    /api/products              filters: brand_id, category_id, sku, search, attribute values
POST   /api/products
GET    /api/products/:id
PATCH  /api/products/:id
DELETE /api/products/:id          blocked if ledger history exists

GET/POST         /api/brands
PATCH            /api/brands/:id

GET/POST         /api/categories
PATCH            /api/categories/:id

GET              /api/attribute-definitions
POST             /api/attribute-definitions
PATCH            /api/attribute-definitions/:id

GET              /api/attribute-definitions/:id/options
POST             /api/attribute-definitions/:id/options
PATCH            /api/attribute-options/:id
```

### Warehouses
```
GET    /api/warehouses
POST   /api/warehouses
PATCH  /api/warehouses/:id
GET    /api/warehouses/:id/stock    current stock snapshot
```

### Inventory Actions
Each action = DB transaction (ledger entry + snapshot update, atomic).

```
POST   /api/inventory/receive
       { product_id, warehouse_id, quantity, supplier_ref?, date_received, notes? }

POST   /api/inventory/transfer
       { items: [{product_id, quantity}], from_warehouse_id, to_warehouse_id, notes? }

POST   /api/inventory/adjust
       { product_id, warehouse_id, quantity_delta, reason (required), notes? }

POST   /api/inventory/return
       { product_id, warehouse_id, quantity, notes?, sale_id? }

GET    /api/inventory/ledger
       paginated, filters: product_id, warehouse_id, action_type, date_from, date_to

GET    /api/inventory/stock
       filters: warehouse_id, product_id
```

---

## Phase 4 — Sales APIs

```
POST   /api/sales
       { sale_type, warehouse_id, items: [{product_id, quantity, unit_price}],
         customer_name?, customer_ref?, notes? }
       → writes sale + items + ledger entries in one transaction

GET    /api/sales          filters: sale_type, fulfillment_state, payment_state,
                           invoice_state, date_from, date_to, search
GET    /api/sales/:id
PATCH  /api/sales/:id/fulfillment    { state }
PATCH  /api/sales/:id/payment        { state }
PATCH  /api/sales/:id/invoice        { state }
DELETE /api/sales/:id                only if fulfillment_state = draft
```

**State transitions (enforced at service layer):**
- `fulfillment`: draft → prepared → shipped → delivered; cancelled from any non-delivered; returned from delivered only
- `payment`: unpaid → paid → refunded
- `invoice`: administrative, less strict

---

## Phase 5 — WooCommerce Integration

### Inbound (Woo → System)
```
POST /api/webhooks/woo/order
```
- Verified by `X-WC-Webhook-Signature` (HMAC-SHA256 with shared secret)
- Returns 200 immediately, enqueues BullMQ job `process-woo-order`

**Worker `process-woo-order`:**
1. Validate payload
2. Check idempotency (woo_order_id not already processed)
3. Find products by `woo_product_id`
4. Create `woocommerce`-type sale + ledger entries
5. Log to `woo_sync_log`
6. BullMQ retries with exponential backoff (3 attempts → dead-letter)

### Outbound (System → Woo)
Triggered when `inventory_stock` changes for a product in the **main warehouse** with `woo_product_id` set. The API service layer explicitly enqueues BullMQ job `sync-woo-stock` after each relevant mutation (receive / transfer / adjust / sale).

**Worker `sync-woo-stock`:**
1. Read current stock from main warehouse
2. Call plugin endpoint: `PUT /wp-json/ob-inventory/v1/stock` with `{ woo_product_id, quantity }`, authenticated via Bearer `WOO_PLUGIN_API_KEY`
3. Log to `woo_sync_log`
4. Retry 3× with backoff → mark failed for admin review

### WordPress Plugin (`woo-plugin/ob-inventory-sync/`)
- **Settings page:** API endpoint URL, shared secret, API key
- **Outbound:** hooks `woocommerce_order_status_changed` → POST to `/api/webhooks/woo/order`
- **Inbound REST endpoint:** `PUT /wp-json/ob-inventory/v1/stock` — receives `{ woo_product_id, quantity }`, updates WC stock directly
- Auth: Bearer token (API key configured in plugin settings)

---

## Phase 6 — Frontend

### Setup
- Vue 3 + Vite + TypeScript
- PrimeVue — **Aura theme**
- Pinia — `useAuthStore`, `useUIStore` (sidebar, toasts)
- TanStack Query — all server data
- Vue Router — protected routes via navigation guard
- `axios` with JWT interceptor (auto-refresh on 401)

### Pages

| Module | Pages |
|---|---|
| Auth | Login |
| Dashboard | Stock summary, recent ledger entries, recent sales, quick-action buttons |
| Products | Filterable list (SKU/brand/category + dynamic attribute filters), Product detail + ledger history, Create/Edit drawer |
| Warehouses | List; Warehouse stock view (filterable, sortable by qty, shows bin_location) |
| Inventory | Tabs: Receive / Transfer / Adjust / Ledger log |
| Sales | Sales list (3 state filter axes), Sale detail with state controls, Create sale drawer |
| Settings | Users, Brands, Categories, Attribute Definitions & Options, Warehouses, WooCommerce config + sync log |

### UI Principles
- Data-dense tables with inline filters (PrimeVue DataTable)
- Slide-in drawers for create/edit (keeps context visible)
- Toast notifications for all actions
- Confirmation dialogs for destructive actions
- Loading skeletons (not just spinners)
- Empty states with actionable prompts

---

## Phase 7 — Polish & Hardening

- Pagination + sorting on all list endpoints
- DB index audit (EXPLAIN on heavy queries)
- Docker multi-stage builds (optimized image sizes)
- Rate limiting on auth endpoints
- Input sanitization review
- Error boundary components in frontend
- Environment-specific Caddy configs

---

## Build Sequence

```
Phase 0    Infrastructure (Docker, monorepo, env validation)          ← current
Phase 1    DB schema + Drizzle migrations
Phase 1.5  CSV import script (validate real data loads cleanly)
Phase 2    Auth + RBAC + audit trail
Phase 3    Catalog + Inventory APIs
Phase 4    Sales APIs
           ↕ (frontend development starts here, parallel with API phases)
Phase 5    WooCommerce worker + WP plugin
Phase 6    Frontend modules
Phase 7    Polish + deploy
```

---

## Real Inventory Data — Key Observations

From `INVENTORY.csv` (708 product rows, brands: TKB / OSO / FS / RDX / SJ / ELSE):

- **Product hierarchy:** brand → class (category) → model → size/color → SKU
- **Unit types:** PIECE or PAIR — stored per product
- **Size types are heterogeneous:** clothing (XS–XXXL, 4L, F), boxing oz (8–18), BJJ Gi (A1–A4, M0–M2, F0–F2)
- **Color codes:** abbreviations (BK, WH, RD) and full names (POWDER PINK, NAVY BLUE) — both stored with code + label
- **`bc` date** = "before count" (pre-system items) — imported as null
- **`Box#`** = physical bin/shelf number, stored as `bin_location` text on product
- **Data quality issues:** duplicate SKUs across box numbers (merge by summing QTY), blank SKUs (skip + report), blank QTY (treat as 0)