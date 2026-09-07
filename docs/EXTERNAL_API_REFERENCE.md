# OB Inventory — External API Reference (`/api/v1`)

HTTP API for external agents and scripts. Separate from the internal `/api/*` endpoints used by
the web app — this surface is authenticated with a long-lived **API token** instead of a user
login, and is meant to stay stable. Almost entirely read-only; the one write surface is product
catalog management (`POST`/`PUT /products`, below) — every token can use it, there's no separate
read/write scope.

Base URL: `https://activebrands.cloud/api/v1`

> **Machine-readable version.** `GET /api/v1` (same auth as everything else) returns this same
> reference as structured JSON — endpoints, params, response shapes, conventions. It's the same
> idea as an MCP server's `tools/list`: point an agent at the API and let it call `GET /api/v1`
> first to learn what's available, instead of pasting this file into its prompt. This markdown
> file stays as the human-readable version; keep both in sync when an endpoint changes
> (`apps/api/src/routes/v1/meta.ts` is the source for the JSON one).

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
Reference data — attribute definitions come with their `options`. Check these before creating a
product to see what brand/category/size/color/unit values already exist and avoid near-duplicate
spellings (e.g. "Nike" vs "nike " creating two brands) — though as noted below, exact lookups
aren't required since create/update auto-create by name.

```
POST /api/v1/products
```
Creates a product. Body:
```jsonc
{
  "sku": "HWR-BK",              // required, must be unique
  "name": "Hand Wraps Black",   // required
  "wooTitle": null,             // optional
  "brand": "TKB",               // optional — matched case-insensitively by name; auto-created if new
  "category": "Handwraps",      // optional — same resolve-or-create behavior
  "model": null,                // optional free text attribute
  "size": "L",                  // optional — matched by label against existing options; auto-created if new
  "color": "Black",             // optional — same
  "unit": null,                 // optional — same
  "costPrice": 12.5,            // optional
  "retailPrice": 29.9,          // optional
  "notes": null,                // optional
  "imageUrl": "https://...",    // optional — fetched server-side, resized to full + thumbnail JPEG, stored.
                                 //   No file upload needed; just point at a reachable image URL.
  "initialStock": {              // optional — omit entirely for a catalog-only product with no stock yet
    "warehouseId": "<uuid>",     // required if initialStock is present — see GET /warehouses
    "quantity": 50,              // optional, default 0
    "boxNumber": null            // optional
  }
}
```
Response `201 { "data": <product, same shape as GET /products/:id> }`. Errors:
`400 VALIDATION_ERROR` (bad input) or `400 IMAGE_FETCH_FAILED` (imageUrl unreachable/not an
image), `404` (`initialStock.warehouseId` doesn't exist), `409 DUPLICATE_SKU` (sku taken).

If `initialStock` targets the **main** warehouse, stock is auto-synced to WooCommerce the same
way a manual stock entry in the app would be (fire-and-forget — check
`GET /api/v1/inventory/movements?sku=...` afterwards if you need to confirm it landed).

```
PUT /api/v1/products/:id
```
Updates a product's catalog fields — **not stock**, which isn't adjustable via this API yet. Same
body shape as `POST` minus `initialStock`, but every field is optional: only the fields you
include are changed. Send `null` on a field to explicitly clear it, e.g. `{"imageUrl": null}`
removes the picture. Same brand/category/size/color/unit resolve-or-auto-create behavior as
create. Response `200 { "data": <product> }`. Errors: `400`, `404` (product not found),
`409 DUPLICATE_SKU` (if changing `sku` to one already in use).

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

```
GET /api/v1/stats/top-products
    ?dateFrom=&dateTo=&warehouseId=&saleType=&storeId=&brandId=&categoryId=
    &groupBy=product|brand|category&sortBy=quantity|revenue&order=desc|asc&limit=&offset=
```
Best (or, with `order=asc`, worst) sellers — the direct answer to "what should we reorder from
the manufacturer" or "what's dead stock we should stop buying". Only counts `completed` sales.
`groupBy=product` (default) ranks individual SKUs; `groupBy=brand`/`category` rolls sales up to
that level instead (e.g. "which brand sells best"). Response:
```json
{
  "groupBy": "product", "sortBy": "quantity", "order": "desc",
  "data": [ { "sku": "HWR-BK", "name": "...", "brandName": "TKB", "categoryName": "ELASTICS",
              "quantitySold": 91, "revenue": "5560.00", "orderCount": 46 } ],
  "limit": 50, "offset": 0
}
```

```
GET /api/v1/stats/low-stock
    ?warehouseId=&brandId=&categoryId=&velocityDays=30&thresholdDays=14&limit=&offset=
```
Reorder alert list: for every product with recent sales, projects `daysOfStockRemaining` from
current on-hand stock divided by its average daily sale rate over the last `velocityDays` days,
then returns only products projected to run out within `thresholdDays` — sorted most-urgent
first (stock already at 0 with active sales shows up with `daysOfStockRemaining: 0`). Products
with no sales in the window are excluded (no basis to project urgency). Response:
```json
{
  "data": [ { "sku": "HWR-BK", "name": "...", "currentStock": 4, "qtySoldRecent": 24,
              "avgDailyQty": 0.8, "daysOfStockRemaining": 5 } ],
  "pagination": { "limit": 100, "offset": 0, "total": 12 },
  "meta": { "velocityDays": 30, "thresholdDays": 14 }
}
```

```
GET /api/v1/stats/inventory-value
    ?warehouseId=&brandId=&categoryId=&groupBy=none|warehouse|brand|category
```
Stock-on-hand valued at both `costValue` (cost price × qty) and `retailValue` (retail price × qty)
— useful for "how much money is sitting in this warehouse" or per-brand/category exposure.

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

- **Write access to anything other than products** — sales, transfers, quotes, warehouses, stock
  levels, etc. are all still read-only. The only mutating endpoints are `POST`/`PUT /products`.
- Adjusting stock on an *existing* product, or deleting a product — not available yet.
- Cardcom/Woo credentials, password hashes, refresh/API token secrets — never exposed.

## Managing tokens

Admins manage tokens from **Settings → API Tokens** in the app (or the internal, JWT-protected
`POST/GET /api/tokens` endpoints, admin-only — not part of this external surface). Revoking a
token takes effect immediately; the next request with that token gets `401 INVALID_TOKEN`.
