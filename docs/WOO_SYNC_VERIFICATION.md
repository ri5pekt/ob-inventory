# Woo Stock Sync — Verification Checklist

## Flow

```
Frontend → API (PUT /warehouses/:id/stock/:productId) → enqueueSyncWooStock()
  → BullMQ queue → Worker → PUT /wp-json/ob-inventory/v1/stock → WooCommerce
```

## Pre-requisites

- Postgres + Redis running (`docker compose -f docker-compose.dev.yml up -d`)
- API running (`pnpm dev:api`)
- Worker running (`pnpm dev:worker`)
- Web running (`pnpm dev:web`)
- Main warehouse configured
- WooCommerce store with URL + Secret Token
- OB Inventory Sync plugin installed on WordPress

## Run Diagnostic

```bash
pnpm woo-sync:diagnose
```

## Manual Checks

### 1. Change same product quantity 3 times

1. Go to Inventory → select main warehouse → find a product
2. Change quantity (e.g. 10 → 20)
3. Change again (20 → 30)
4. Change again (30 → 40)

**Expected:** Only the latest value (40) reaches WooCommerce. Older waiting jobs for the same product are removed before adding the new one.

### 2. Check logs

**API logs** (when changing quantity):
- `[sync-woo-stock] Quantity update request received` (productId, sku, quantity)
- `[sync-woo-stock] Job enqueued` (productId, jobId)

**Worker logs:**
- `[sync-woo-stock] Job started: jobId=... productId=...`
- `[sync-woo-stock] Woo request sent: store=... sku=... qty=...`
- `[sync-woo-stock] Woo success: store=... sku=... qty=...` (or Woo failure)
- `[sync-woo-stock] Job completed: jobId=... productId=...`
- `[sync-woo-stock] Stalled job detected: jobId=...` (if worker stalls)

### 3. Transient failures retry

Simulate a transient failure (e.g. temporary network issue or Woo 5xx). Job should retry automatically with exponential backoff (5 attempts, 5s base delay).

### 4. Completed/failed cleanup

- **Completed:** Auto-removed after 1 hour or when 1000+ exist
- **Failed:** Auto-removed after 1 day or when 500+ exist

Run `pnpm woo-sync:diagnose` to see queue counts.
