# OB Inventory — External API Reference (`/api/v1`)

Read-only HTTP API for external agents and scripts. Separate from the internal `/api/*`
endpoints used by the web app — this surface is authenticated with a long-lived **API token**
instead of a user login, and is meant to stay stable.

Base URL: `https://activebrands.cloud/api/v1`

## Authentication

Every request needs an `Authorization` header with a Bearer token issued from
**Settings → API Tokens** (admin only):

```
Authorization: Bearer obk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Tokens are shown **once** at creation time. If lost, revoke and create a new one.
- Missing header → `401 { "error": "Missing Authorization header", "code": "UNAUTHORIZED" }`
- Invalid/revoked token → `401 { "error": "Invalid or revoked token", "code": "INVALID_TOKEN" }`
- Expired token → `401 { "error": "Token expired", "code": "TOKEN_EXPIRED" }`

## Rate limiting

Each token is limited to **300 requests/minute** by default. Exceeding it returns:

```
429 { "error": "Rate limit exceeded — try again in <n>ms", "code": "RATE_LIMITED" }
```

## Response shape

**Lists** are wrapped with pagination:
```jsonc
{
  "data": [ /* rows */ ],
  "pagination": { "limit": 100, "offset": 0, "total": 842 }
}
```
Every list endpoint accepts `limit` (default 100, max 1000) and `offset`. Page through with
`offset += limit` until `data.length < limit` or `offset >= total`.

**Single resources**:
```jsonc
{ "data": { /* one row */ } }
```

**Errors** always look like:
```jsonc
{ "error": "human message", "code": "MACHINE_CODE", "details": { /* optional, zod validation errors */ } }
```

## Incremental sync

`products` and `sales` accept `updatedSince` (ISO-8601 datetime) so you can poll deltas instead
of re-pulling everything:
```
GET /api/v1/products?updatedSince=2026-09-01T00:00:00Z
GET /api/v1/sales?updatedSince=2026-09-01T00:00:00Z
```

---

## Endpoints

### Products

```
GET /api/v1/products
    ?sku=&brandId=&categoryId=&search=&updatedSince=&limit=&offset=
```
Returns products with resolved brand/category names and an `attributes` array (model, size,
color, unit — whatever attribute definitions exist).

```
GET /api/v1/products/:id
```
Same shape, plus `stock: [{ warehouseId, quantity, boxNumber }]` for every warehouse holding it.

```
GET /api/v1/brands
GET /api/v1/categories
GET /api/v1/attributes
```
Reference data — attribute definitions come with their `options`.

**Discovering valid SKUs / product IDs.** The `productId`/`sku` filters used throughout this API
(sales, inventory, transfers, quotes, stats) aren't guessable — an agent needs to look them up
first. The whole catalog (currently ~1,000 products) fits in a single page, so the standard
pattern is: pull it once, cache a `sku → { id, name, brand, category }` lookup table locally, and
reuse it for every filtered call afterwards.

```bash
curl -H "Authorization: Bearer $OB_API_TOKEN" \
  "https://activebrands.cloud/api/v1/products?limit=1000"
```
Check `pagination.total` — if it ever exceeds `1000`, page with `offset` until you've fetched all
of it (or narrow with `search=`/`brandId=`/`categoryId=`). For refreshing an existing cache, use
`updatedSince` instead of re-pulling everything (see [Incremental sync](#incremental-sync)).

Free-text lookup also works without pulling the whole catalog:
```
GET /api/v1/products?search=handwraps      → matches sku or name, case-insensitive
GET /api/v1/products?sku=HWR-BK             → exact SKU match
```

### Warehouses

```
GET /api/v1/warehouses
```
Each row includes `skuCount` and `totalQuantity` (aggregated from current stock).

```
GET /api/v1/warehouses/:id
```

### Inventory — stock & movements

```
GET /api/v1/inventory/stock
    ?warehouseId=&productId=&sku=&limit=&offset=
```
Current on-hand quantity per product per warehouse.

```
GET /api/v1/inventory/movements
    ?productId=&sku=&warehouseId=&actionType=&dateFrom=&dateTo=&limit=&offset=
```
The append-only inventory ledger — every receive / transfer / sale / return / adjustment that
ever touched stock. `actionType` is one of `receive | transfer_in | transfer_out | sale | return
| adjustment`. `quantityDelta` is signed (positive = stock in, negative = stock out).
`productId`/`sku` scope the ledger to a single product — e.g. "every stock movement for SKU X
in March".

### Transfers

```
GET /api/v1/transfers
    ?fromWarehouseId=&toWarehouseId=&status=&productId=&sku=&dateFrom=&dateTo=&limit=&offset=
GET /api/v1/transfers/:id     → includes items[]
```
`productId`/`sku` return only transfers that contain that product (via a line-item match).

### Sales

```
GET /api/v1/sales
    ?saleType=&status=&warehouseId=&storeId=&productId=&sku=&dateFrom=&dateTo=&updatedSince=&limit=&offset=
```
`saleType`: `direct | partner | woocommerce | merged` — this is the closest concept to a "channel".
`status`: `completed | cancelled | refunded | superseded`.
`dateFrom`/`dateTo` filter on `saleDate`, so you can pull "sales in period X".
`productId`/`sku` return only sales that included that product — combine with `dateFrom`/`dateTo`
and `saleType`/`storeId` to answer "sales of SKU X via WooCommerce in Q2", etc.

```
GET /api/v1/sales/:id
```
Includes `items[]`, `paymentMethods[]`, and `cardcomDocuments[]` (invoices/receipts issued for
this sale).

### Statistics

```
GET /api/v1/stats/sales-summary
    ?dateFrom=&dateTo=&warehouseId=&saleType=&storeId=&productId=&sku=&groupBy=day|warehouse|saleType|store
```
Pre-aggregated revenue/count/quantity so an agent doesn't have to page through raw sales and sum
them client-side. Only counts `completed` sales. `groupBy` (default `day`) buckets the results;
combine with any of the filters above to scope by warehouse, channel (`saleType`/`storeId`),
period, or a single product. Response shape:
```json
{
  "groupBy": "day",
  "data": [ { "group": "2026-09-01", "count": 12, "revenue": "4500.00", "quantity": 34 } ],
  "totals": { "count": 120, "revenue": "45000.00", "quantity": 340 }
}
```
When `productId`/`sku` is set, `revenue` and `quantity` reflect only that product's line items
(not the whole sale total) — e.g. "revenue from SKU X, per day, in August".

### Price Quotes

```
GET /api/v1/quotes
    ?status=&warehouseId=&productId=&sku=&customerEmail=&dateFrom=&dateTo=&limit=&offset=
```
`status`: `open | converted | cancelled`.
`productId`/`sku` return only quotes that contain that product.

```
GET /api/v1/quotes/:id     → includes items[]
```

### Customers

```
GET /api/v1/customers?search=&createdSince=&limit=&offset=
GET /api/v1/customers/:id
```

### Users (metadata only)

```
GET /api/v1/users
GET /api/v1/users/:id
```
Never includes password hashes — only `id, name, email, role, isActive, createdAt`.

### Stores (metadata only)

```
GET /api/v1/stores
```
Never includes Woo/Cardcom secrets — only `id, name, url, platform, isActive, notes, createdAt`.

---

## Example

```bash
curl -H "Authorization: Bearer $OB_API_TOKEN" \
  "https://activebrands.cloud/api/v1/inventory/movements?warehouseId=<id>&dateFrom=2026-09-01&limit=200"
```

```bash
curl -H "Authorization: Bearer $OB_API_TOKEN" \
  "https://activebrands.cloud/api/v1/sales?updatedSince=2026-09-01T00:00:00Z"
```

```bash
curl -H "Authorization: Bearer $OB_API_TOKEN" \
  "https://activebrands.cloud/api/v1/stats/sales-summary?dateFrom=2026-08-01&dateTo=2026-08-31&groupBy=saleType"
```

---

## Not available via this API (v1)

- **Write access** — creating/editing sales, adjusting stock, etc. This API is read-only.
- Cardcom/Woo credentials, password hashes, refresh/API token secrets — never exposed.

## Managing tokens

Admins manage tokens from **Settings → API Tokens** in the app (or the internal, JWT-protected
`POST/GET /api/tokens` endpoints, admin-only — not part of this external surface). Revoking a
token takes effect immediately; the next request with that token gets `401 INVALID_TOKEN`.
