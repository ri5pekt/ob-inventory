# External API — Write Surface Expansion — Development Plan

**Goal:** Extend `/api/v1` (currently: read everything, write products + product stock) with the
next tier of write endpoints agents are likely to need — bulk stock sync, removing a product from
a warehouse, bulk product creation, product deletion/archiving, and creating stock transfers.
Prompted directly by a real agent (Claude, working via the API) needing to push 65 corrected
quantities and asking for a stock-set endpoint, which we shipped in v2.5.0. This plan covers the
next likely asks so we're not doing this one endpoint at a time, reactively, forever.

Status: **Planning — not built yet.** Nothing in this doc is live until its own phase ships.

Current state for reference (all live, v2.4.0–v2.5.0):
- `POST /api/v1/products` — create, with optional `initialStock`
- `PUT /api/v1/products/:id` — update catalog fields
- `PUT /api/v1/products/:id/stock` — set absolute quantity in one warehouse
- Everything else (`sales`, `transfers`, `quotes`, `warehouses`, `customers`, `users`, `stores`,
  `stats/*`) is still read-only

---

## Decisions Log

| Topic | Decision |
|---|---|
| Token scopes | Re-affirming the earlier call: **no read/write scope split.** Every token can use every write endpoint below. Revisit only if a real incident (bad actor, buggy agent) makes the case concretely — don't build speculative permission plumbing. |
| Batch endpoints — response shape | Every bulk endpoint below returns **per-item results**, never all-or-nothing. One bad SKU/id in a batch of 200 must not fail the other 199. Shape: `{ data: { succeeded: [...], failed: [{ input, error, code }] } }`. |
| Batch endpoints — size cap | Max **500 items** per call, enforced by zod (`z.array(...).max(500)`), matching the existing `stats/top-products` max-limit convention. Keeps one request from becoming a multi-minute transaction. |
| Product deletion | **Soft delete only.** Products are referenced by `sale_items`, `inventory_ledger`, `quote_items`, `transfer_items` — hard-deleting would either cascade-destroy sales history or fail on FK constraints. Add `products.archived_at` (nullable timestamp); "deleted" via the API means archived, never gone. |
| Transfers via API | Build it — it's a natural extension of the stock-set endpoint (same warehouses/products, same ledger pattern) and lower-risk than sales. |
| Sales via API | **Not in this round.** Bigger surface (Cardcom invoicing implications, `saleType` semantics, payment methods) and no concrete agent request for it yet. Left as an open question at the end of this doc — revisit if/when an agent actually asks. |
| Woo sync trigger | Every endpoint that changes Main-warehouse quantity (bulk stock, remove-from-warehouse, transfers touching Main) enqueues `enqueueSyncWooStock` per affected product — same as the existing single-item stock endpoint. |
| Ledger attribution | All ledger `notes` continue the `Stock set via API token "<name>"` convention already shipped, so API-driven changes stay distinguishable from UI-driven ones in `inventory/movements` history. |

---

## Phase 1 — Bulk stock set (highest priority — direct extension of what shipped)

**Why first:** the single-item `PUT /products/:id/stock` already solves today's ask (65 sequential
calls is genuinely fine), but the *next* agent doing this for 500 SKUs will ask for exactly this.

```
POST /api/v1/inventory/stock:bulk-set
```
Body:
```jsonc
{
  "items": [
    { "sku": "HWR-BK", "warehouseId": "<uuid>", "quantity": 50, "boxNumber": null },
    { "productId": "<uuid>", "warehouseId": "<uuid>", "quantity": 12 }
    // ... up to 500
  ]
}
```
- Accepts `sku` **or** `productId` per item (agents that just pulled a product list have the id;
  agents working off a spreadsheet have the SKU) — exactly one of the two required per item.
- Internally, loops the same logic as `PUT /products/:id/stock` (Phase already shipped) item by
  item, collecting results rather than throwing on first failure.
- Response:
  ```jsonc
  {
    "data": {
      "succeeded": [ { "sku": "HWR-BK", "productId": "<uuid>", "warehouseId": "<uuid>", "quantity": 50 } ],
      "failed":    [ { "sku": "TYPO-SKU", "error": "Product not found", "code": "NOT_FOUND" } ]
    }
  }
  ```
- Woo sync: dedupe and enqueue once per distinct `productId` touching Main, not once per line item.

**Effort:** small — mostly extracting the existing single-stock-set logic into a shared function
and wrapping it in a loop + result collector. No schema change.

---

## Phase 2 — Remove a product from a warehouse entirely

Distinct from setting quantity to `0` (which still means "tracked here, just empty"). Needed for
agents that created a product in the wrong warehouse, or that are decommissioning a partner
location's catalog.

```
DELETE /api/v1/products/:id/stock/:warehouseId
```
- 404 if no stock row exists for that product+warehouse.
- Before deleting, if quantity > 0, records an `inventory_ledger` adjustment of `-quantity` (same
  pattern as the internal `DELETE /api/warehouses/:id/stock/:productId` route already does) so the
  removal is auditable.
- Enqueues Woo sync if the warehouse is Main.
- Response: `{ "data": { "ok": true } }`.

**Effort:** small — mirrors an existing internal route almost exactly, just re-homed under
`/api/v1` with SKU/id-based product lookup instead of a warehouse-scoped route param.

---

## Phase 3 — Bulk product create

For onboarding a new supplier's catalog, or the same 65-new-SKUs scenario but for brand-new
products instead of stock updates on existing ones.

```
POST /api/v1/products:bulk
```
Body: `{ "items": [ <same shape as POST /products>, ... up to 500 ] }`

- Same brand/category/size/color/unit resolve-or-auto-create behavior as the single-item endpoint,
  but resolved **once per distinct value across the whole batch**, not once per item — otherwise
  500 items with `"brand": "TKB"` would do 500 redundant lookups (and worse, 500 near-simultaneous
  "does this exist, if not create it" races on the same brand name).
- Per-item `imageUrl` fetches happen individually (can't dedupe network calls), but are not
  awaited serially — fetch concurrently with a small concurrency cap (e.g. 10 at a time) so 500
  image URLs don't take 500× the single-item latency.
- Per-item duplicate SKU (either against the DB or against another item earlier in the same
  batch) goes to `failed`, not a hard stop.

**Effort:** medium — the concurrency + dedup-within-batch logic is the only non-trivial part;
the per-item logic itself is a direct reuse of the existing create-product code path.

---

## Phase 4 — Product delete (soft) / archive

**Schema change required** — this is the one phase that needs a migration.

`packages/db/src/schema/catalog.ts`:
```typescript
export const products = pgTable('products', {
  // ...existing columns...
  archivedAt: timestamp('archived_at', { withTimezone: true }),
})
```
Migration `packages/db/src/migrations/00XX_add_products_archived_at.sql` — single nullable column,
no backfill needed (existing rows stay `null` = active).

API surface:
```
DELETE /api/v1/products/:id
```
- Sets `archivedAt = now()`. Does **not** touch `inventory_stock`/`inventory_ledger` rows — an
  archived product can still have historical stock/sales; it just stops showing up by default.
- 409 if the product currently has non-zero stock in any warehouse (`ARCHIVE_HAS_STOCK`) — force
  the agent to zero it out first via the stock endpoints, so archiving can't silently "lose" units
  that are physically still on a shelf somewhere. Overridable with `?force=true` if the item is
  genuinely gone (damaged, written off) — still just archives, never hard-deletes.
- `GET /api/v1/products` gets a new default: **excludes archived** products unless
  `?includeArchived=true` is passed. `GET /api/v1/products/:id` still returns an archived product
  by id (so an agent that already has the id doesn't get a confusing 404) with `archivedAt` in the
  response.
- No "unarchive" endpoint in this phase — if that turns out to be needed, it's a one-line addition
  later (`PUT /products/:id` accepting `archived: false`).

**Effort:** medium — small schema change, but touches the list-query default filter which needs
care not to break existing agent integrations relying on the current (unfiltered) behavior. Ship
with a note in the changelog/meta descriptor calling out the behavior change explicitly.

---

## Phase 5 — Create stock transfers

```
POST /api/v1/transfers
```
Body:
```jsonc
{
  "fromWarehouseId": "<uuid>",
  "toWarehouseId": "<uuid>",
  "notes": null,
  "items": [
    { "sku": "HWR-BK", "quantity": 10 }
    // or "productId" instead of "sku", same either/or rule as Phase 1
  ]
}
```
- Mirrors the internal transfer-creation logic: validates `fromWarehouseId` has enough stock for
  every line item **before** writing anything (all-or-nothing for a single transfer — unlike the
  bulk endpoints above, a transfer is one logical operation, not a batch of independent ones).
- On success: decrements `inventory_stock` in `fromWarehouseId`, increments in `toWarehouseId`,
  writes `transfer_out`/`transfer_in` ledger pairs per item, creates the `transfers` +
  `transfer_items` rows (status `completed`, matching how transfers are created today).
- Enqueues Woo sync for any affected product where either warehouse is Main.
- Insufficient stock on any line → `409 INSUFFICIENT_STOCK` with the offending SKU(s) named in the
  error, nothing written.
- Response: `{ "data": <transfer, same shape as GET /transfers/:id, includes items[]> }`.

**Effort:** medium — the all-or-nothing validate-then-write transaction is the main design point;
otherwise a fairly direct mirror of the existing internal transfer-creation route.

---

## Open question — deferred, not planned yet

**Creating sales via the external API.** Not requested by any agent yet, and meaningfully
higher-risk than everything above:
- Would need a decision on `saleType` — a new `'api'` value, or reuse `'direct'`? Reporting/stats
  endpoints (`stats/sales-summary`, `stats/top-products`) already group by `saleType`, so this
  isn't just a label.
- Cardcom invoicing: does an API-created sale attempt to issue a Cardcom document automatically
  (real financial/legal side effect), or is invoicing always a separate manual step for
  API-created sales?
- Payment method(s) — required for a "real" sale in the UI; what's the right default/requirement
  for an agent-created one?

Not designing this until there's a concrete request driving the specific shape needed — flagging
now so it's not a surprise later.

---

## Documentation & hardening (applies to every phase above)

- [ ] `apps/api/src/routes/v1/meta.ts` — add each new endpoint the same way Phases so far have
      (summary, body, responses, example) so `GET /api/v1` stays the single source of truth for
      agents.
- [ ] `docs/EXTERNAL_API_REFERENCE.md` — human-readable mirror of the above, same convention.
- [ ] Bump `package.json` (root + `apps/web`), `apps/api/src/routes/v1/meta.ts` version field, and
      `scripts/deploy-production.py`'s version string per shipped phase (minor bump — these are
      additive, non-breaking endpoints).
- [ ] Manual production smoke test per phase before calling it done: exercise the happy path,
      the "not found" path, and (for batch endpoints) a mixed batch with one deliberately-bad item
      — same pattern used when `PUT /products/:id/stock` shipped. Clean up any test data created
      against production afterward.
- [ ] `pnpm --filter @ob-inventory/api build` (tsc) clean before every deploy, per project
      convention.

---

## Build sequence

```
Phase 1   POST /api/v1/inventory/stock:bulk-set        (no schema change)
Phase 2   DELETE /api/v1/products/:id/stock/:warehouseId (no schema change)
Phase 3   POST /api/v1/products:bulk                    (no schema change)
Phase 4   DELETE /api/v1/products/:id (soft/archive)     (schema: products.archived_at + migration)
Phase 5   POST /api/v1/transfers                        (no schema change)

Deferred  Sales write endpoint — open questions above, build only on concrete request
```

Ordered by (a) how directly each extends what just shipped, (b) implementation risk/effort, and
(c) whether it needs a migration (pushed later so the no-schema-change wins land fast). Happy to
re-order if a specific one becomes urgent — e.g. if the next agent request is "let me delete the
test products I made," Phase 4 jumps to the front.
