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
    ?productId=&warehouseId=&actionType=&dateFrom=&dateTo=&limit=&offset=
```
The append-only inventory ledger — every receive / transfer / sale / return / adjustment that
ever touched stock. `actionType` is one of `receive | transfer_in | transfer_out | sale | return
| adjustment`. `quantityDelta` is signed (positive = stock in, negative = stock out).

### Transfers

```
GET /api/v1/transfers
    ?fromWarehouseId=&toWarehouseId=&status=&dateFrom=&dateTo=&limit=&offset=
GET /api/v1/transfers/:id     → includes items[]
```

### Sales

```
GET /api/v1/sales
    ?saleType=&status=&warehouseId=&storeId=&dateFrom=&dateTo=&updatedSince=&limit=&offset=
```
`saleType`: `direct | partner | woocommerce | merged`.
`status`: `completed | cancelled | refunded | superseded`.

```
GET /api/v1/sales/:id
```
Includes `items[]`, `paymentMethods[]`, and `cardcomDocuments[]` (invoices/receipts issued for
this sale).

### Price Quotes

```
GET /api/v1/quotes
    ?status=&warehouseId=&dateFrom=&dateTo=&limit=&offset=
```
`status`: `open | converted | cancelled`.

```
GET /api/v1/quotes/:id     → includes items[]
```

### Customers

```
GET /api/v1/customers?search=&limit=&offset=
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

---

## Not available via this API (v1)

- **Write access** — creating/editing sales, adjusting stock, etc. This API is read-only.
- Cardcom/Woo credentials, password hashes, refresh/API token secrets — never exposed.

## Managing tokens

Admins manage tokens from **Settings → API Tokens** in the app (or the internal, JWT-protected
`POST/GET /api/tokens` endpoints, admin-only — not part of this external surface). Revoking a
token takes effect immediately; the next request with that token gets `401 INVALID_TOKEN`.
