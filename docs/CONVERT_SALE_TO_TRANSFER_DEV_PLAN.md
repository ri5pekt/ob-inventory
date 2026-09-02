# Dev Plan — "Convert to Stock Transfer" (Sale → Transfer)

## 1. Feature summary

Add a **"Convert to Stock Transfer"** action on the sale detail screen. When used:

1. Admin picks a **destination warehouse**.
2. The sale is removed and a **stock transfer** is created from the sale's warehouse to the chosen destination, so the goods are now tracked as an internal movement instead of a sale.
3. If the sale came from **WooCommerce** (`wooOrderId` set), the corresponding Woo order is **cancelled** so it won't be re-imported by the sync plugin.

This is for cases like: an order was recorded as a sale, but the stock actually needs to move to another location (e.g., a wrong warehouse pick, a B2B transfer disguised as a sale, retail return that becomes restock elsewhere) — instead of "delete sale" (stock just goes back to the same warehouse) + manually creating a transfer + manually cancelling the Woo order.

## 2. Confirmed current behavior (baseline)

**Delete sale** — `DELETE /api/sales/:id` (`apps/api/src/routes/sales.ts:1277`)
- Restores stock to `sale.warehouseId` for every item with a resolved `productId` (`inventory_ledger` action `return`, `+quantity`).
- Deletes the sale (cascades `sale_items`, `sale_payment_method_links`, **and `cardcom_documents`** — `cardcomDocuments.saleId` is `ON DELETE CASCADE`).
- If the affected warehouse is `main`, enqueues `sync-woo-stock` per product.

**Create transfer** — `POST /api/transfers` (`apps/api/src/routes/transfers.ts:123`)
- Validates `fromWarehouseId !== toWarehouseId`, warehouse-admin scoping, and **sufficient stock** in source.
- Per item: `inventory_stock -= qty` on source (+ ledger `transfer_out`), `inventory_stock += qty` on destination (+ ledger `transfer_in`).
- Enqueues `sync-woo-stock` if `main` warehouse is involved.

**WooCommerce integration today (confirmed from `ob-inventory-sync.php`)**
- **Woo → OB** (webhook, one-directional): plugin's `class-ob-inventory-webhooks.php` hooks `woocommerce_order_status_processing`/`completed`, POSTs order payload to `{OB_URL}/api/webhooks/woo/order` with `Authorization: Bearer <token>`. Handled by `apps/api/src/routes/webhooks.ts` → creates a `sales` row (`saleType: 'woocommerce'`, `wooOrderId` set) and deducts `main` warehouse stock. Idempotent via `_ob_inventory_synced` post-meta on the Woo side and a `wooOrderId + storeId` lookup on ours.
- **OB → Woo** (existing capabilities, all in `class-ob-inventory-rest.php`, namespace `ob-inventory/v1`):
  - `GET /products` — pull Woo's SKU list (page/per_page).
  - `PUT /stock` — **push a stock quantity by SKU** (`{sku, quantity}`). This is what `apps/worker/src/index.ts` (`sync-woo-stock` BullMQ queue) calls after every stock-affecting operation.
  - `GET /ping`, `GET /ping-back` — connectivity checks only.
- **There is currently no way for OB Inventory to change a WooCommerce order's status.** This is the gap the plugin prompt (§6) closes.

**Sale/transfer schema facts that constrain the design**
- `transferItems.productId` is `NOT NULL` → a sale item with no matched product (`saleItems.productId IS NULL`, i.e. an unresolved Woo SKU) **cannot** be represented as a transfer item.
- `sales.warehouseId` is `NOT NULL` and single-valued — a sale only ever touches one warehouse, so "source" for the conversion is unambiguous (`sale.warehouseId`).
- `stores.secretToken` + `stores.url` already hold what's needed to call the plugin's REST API (same fields `sync-woo-stock` uses).
- `woo_sync_action` is a **Postgres enum** (`push_stock`, `pull_order`) — adding a `cancel_order` value needs a migration (`ALTER TYPE ... ADD VALUE`).

## 3. Net stock effect (the key design decision)

The sale already deducted stock from `sale.warehouseId` when it was created. Converting to a transfer should NOT touch that warehouse's net stock (physically nothing changed there) but MUST credit the destination warehouse, and must leave a clean audit trail rather than silently doing nothing on the source side. So per item we write **two offsetting ledger entries on the source** (clear audit trail: "sale reversed" then "transferred out") plus the normal transfer-in on the destination — this exactly mirrors calling `DELETE /api/sales/:id` followed by `POST /api/transfers`, just atomically and without the double round trip:

| Step | Warehouse | Ledger action | Delta | Net stock effect |
|---|---|---|---|---|
| 1 | source (sale.warehouseId) | `return` (ref: sale) | `+qty` | stock temporarily restored |
| 2 | source (sale.warehouseId) | `transfer_out` (ref: transfer) | `-qty` | cancels out step 1 → **source stock unchanged** |
| 3 | destination | `transfer_in` (ref: transfer) | `+qty` | **destination stock increases** |

No "insufficient stock" check is needed against the source (unlike a normal transfer) because steps 1+2 net to zero — we're not pulling from currently-available stock, we're reclassifying stock the sale already removed.

## 4. Schema change

Add a nullable traceability column to `transfers` (mirrors `quotes.convertedSaleId`'s pattern already used elsewhere in this codebase):

```typescript
// packages/db/src/schema/transfers.ts
export const transfers = pgTable('transfers', {
  // ...existing columns...
  convertedFromSaleId: uuid('converted_from_sale_id').references(() => sales.id, { onDelete: 'set null' }),
})
```

New migration `packages/db/src/migrations/00XX_add_transfer_converted_from_sale.sql`:
```sql
ALTER TABLE transfers ADD COLUMN converted_from_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL;
ALTER TYPE woo_sync_action ADD VALUE IF NOT EXISTS 'cancel_order';
```
(Remember: production has skipped early migration files before — add this file to the `PENDING_MIGRATIONS` psql-fallback list in `scripts/deploy-production.py` just in case, same as `0022`/`0023`.)

## 5. New backend endpoint

`POST /api/sales/:id/convert-to-transfer`

**Body:**
```json
{ "toWarehouseId": "uuid", "reference": "optional string", "notes": "optional string" }
```

**Validation (in order, mirrors existing transfer/sale route conventions):**
1. `id` is a valid UUID; sale exists → 404 `Sale not found`.
2. Sale `status` is `completed` (not already `superseded`/`cancelled`) → 409 `Sale cannot be converted (status: ...)`.
3. Sale has ≥1 item → 400 `Sale has no items`.
4. `toWarehouseId` exists → 404 `Destination warehouse not found`.
5. `toWarehouseId !== sale.warehouseId` → 400 `SAME_WAREHOUSE`.
6. Warehouse-admin role: caller must have access to **both** `sale.warehouseId` and `toWarehouseId` → 403 (mirrors `POST /api/transfers`).
7. **Every** sale item has a resolved `productId` → otherwise 422 `Cannot convert — sale has unresolved items` with `{ unresolvedSkus: [...] }`. (This is the one truly new hard constraint, driven by the `transferItems.productId NOT NULL` schema fact above.)

**Transaction:**
1. Insert `transfers` row: `fromWarehouseId = sale.warehouseId`, `toWarehouseId`, `status: 'completed'`, `reference: reference ?? `Converted from sale ${sale.id}``, `notes`, `convertedFromSaleId: sale.id`, `createdBy: userId`.
2. For each sale item: insert `transferItems`, apply the 3-step ledger/stock sequence from §3.
3. Delete the sale (cascades `sale_items`, `sale_payment_method_links`, `cardcom_documents` — same cascade as today's `DELETE /api/sales/:id`).

**After the transaction (best-effort, non-blocking — same pattern as `enqueueSyncWooStock` calls elsewhere):**
4. Enqueue `sync-woo-stock` for every affected product if `main` warehouse is `sale.warehouseId` or `toWarehouseId`.
5. **If `sale.wooOrderId` is set:** call the WooCommerce plugin to cancel that order (see §6). This call is synchronous (same pattern as `chargeCard`/`createDocument` in `invoices.ts`, which already call out to Cardcom directly from the route) but its failure **does not roll back** the conversion — the local state change is authoritative. On failure, log to `wooSyncLog` (`action: 'cancel_order'`, `status: 'failed'`) and include a warning in the response.

**Response:**
```json
{
  "transferId": "uuid",
  "saleDeleted": true,
  "wooOrderCancelled": true | false | null,   // null = sale wasn't a Woo order
  "wooCancelWarning": "string | undefined"     // present only if wooOrderCancelled === false
}
```

**Note on Cardcom documents:** since the sale row cascades away, any linked Cardcom documents (invoices/receipts) lose their local link (identical risk profile to today's plain "Delete Sale" — nothing new). The frontend should surface a warning if the sale has documents (see §7).

## 6. WooCommerce order cancellation call

New helper, e.g. `apps/api/src/services/woo-orders.ts`:
```typescript
export async function cancelWooOrder(store: { url: string; secretToken: string }, wooOrderId: string, reason?: string) {
  const url = `${store.url.replace(/\/$/, '')}/wp-json/ob-inventory/v1/orders/${wooOrderId}/cancel`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.secretToken}` },
    body: JSON.stringify({ reason: reason ?? 'Converted to stock transfer in OB Inventory' }),
  })
  // ...parse, log to wooSyncLog with action 'cancel_order', return {ok, status, body}
}
```
Requires the **new plugin endpoint** described in §7 below (does not exist yet — this is the blocking dependency).

## 7. Frontend changes

### 7.1 Sale detail footer cleanup ("More actions")

The current footer (`SaleDetailDialog.vue`) crams 5 buttons into one row (Delete, PDF, Cardcom, Charge, Edit), which wraps/overflows on mobile. Restructure to only **3** footer controls, uniformly (not just on mobile — simpler to maintain one layout):

- **Delete** (icon-only, danger, unchanged) — left.
- **More actions** (icon-only, `pi-ellipsis-h`, secondary) — opens a new lightweight action-sheet dialog.
- **Edit** (label + icon, unchanged) — right.

**New `SaleMoreActionsModal.vue`** — a small dialog (~360px) listing the remaining actions as full-width rows (icon + label + chevron), each closing the sheet and triggering the existing action:
- Download PDF
- Cardcom Documents
- Charge Card
- *(divider)*
- **Convert to Stock Transfer** (new — `pi-truck`, disabled unless `sale.status === 'completed'`)

`SaleDetailDialog.vue` keeps owning all the actual modals (`CardcomDocumentsModal`, `CardcomTerminalModal`, new `ConvertToTransferModal`) and existing `pdfLoading`/`downloadPdf` logic; the "more actions" sheet just emits which one to open (`@pick="action"`) and gets out of the way.

### 7.2 Convert to Transfer modal

**New `ConvertToTransferModal.vue`** (mirrors `CreateTransferModal.vue`'s warehouse-select UX + `SaleDetailDialog.vue`'s delete-confirm UX):
- `Select` for destination warehouse, options = all warehouses except `sale.warehouseId` (same `toWarehouseOptions` computed pattern as `CreateTransferModal.vue`).
- Optional reference/notes `Textarea`.
- Summary line: "This will remove the sale, create a transfer of **N item(s)** to **<warehouse>**" + (if `sale.wooOrderId`) "and cancel WooCommerce order #<id>."
- If the sale has any Cardcom documents (check via existing `GET /api/sales/:id/documents`), show a `Message severity="warn"`: "This sale has N Cardcom document(s) on file. They will be unlinked (not cancelled on Cardcom)."
- Confirm/Cancel buttons; loading + error state (mirror `deleting`/`deleteError` pattern exactly).
- On success: close, toast success; if `wooOrderCancelled === false`, toast a **warning** ("Transfer created, but WooCommerce order #X could not be cancelled — cancel it manually.") instead of a plain success.

**`apps/web/src/api/sales.ts`**: add `convertSaleToTransfer(saleId, body)`.

## 8. Edge cases / guardrails

- Unresolved sale items (no `productId`) → hard block with a clear list of SKUs (admin must fix product mapping first).
- Sale already `superseded` (merged away) or not `completed` → hard block.
- Role scoping identical to `POST /api/transfers`.
- Woo cancellation failure never blocks the local conversion — surfaced as a warning only.
- Idempotency isn't needed here (unlike the Woo→OB webhook) since this is a single admin-triggered action guarded by the sale existing at all — once deleted, retrying 404s.

## 9. Testing plan

- Non-Woo direct sale → convert → verify: sale gone, transfer exists with correct items, source warehouse stock unchanged, destination warehouse stock increased, 4 ledger rows per item (`return`, `transfer_out`, `transfer_in`, and none extra), `sync-woo-stock` enqueued only if `main` involved.
- WooCommerce sale → convert → verify local effects as above **and** mock/stub the plugin call to confirm `PUT .../orders/:id/cancel` is called with the right order id + token; verify graceful handling when the plugin returns 404/500/timeout.
- Sale with an unresolved SKU item → expect 422 with `unresolvedSkus`.
- Sale in `main` warehouse → destination non-main (and vice versa) → confirm exactly the products that touch `main` get a `sync-woo-stock` job.
- Warehouse-admin user without access to destination warehouse → 403.

## 10. Rollout

1. Migration (`convertedFromSaleId` column + `cancel_order` enum value) — add to `PENDING_MIGRATIONS` psql fallback in `scripts/deploy-production.py`.
2. Backend route + service.
3. Frontend button + modal.
4. **Blocking external dependency:** the WooCommerce plugin needs the new `/orders/:id/cancel` endpoint — see prompt below. This can ship *before* the plugin update; OB will just log a `wooCancelWarning` until the plugin is updated (graceful degradation, not a hard blocker for merging).
5. Deploy, smoke test both a direct-sale and a Woo-sale conversion in production.
