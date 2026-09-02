import type { FastifyPluginAsync, FastifyRequest } from 'fastify'

/**
 * Self-description for the external API — the machine-readable equivalent of
 * docs/EXTERNAL_API_REFERENCE.md. An agent can call this once (it's the first
 * thing it should call) to learn every endpoint, its filters, and response
 * shape without a human having to paste docs into its prompt.
 *
 * Kept as a hand-maintained object rather than auto-generated from the Zod
 * schemas — simpler, and lets us write agent-oriented descriptions/examples
 * rather than raw parameter types. Update this alongside docs/EXTERNAL_API_REFERENCE.md
 * whenever an endpoint or filter changes.
 */
function buildDescriptor(baseUrl: string) {
  return {
    name:        'OB Inventory External API',
    version:     '2.1.0',
    description: 'Read-only HTTP API for external agents/scripts to query sales, inventory, '
      + 'products, warehouses, and pre-aggregated statistics. Separate from the internal /api/* '
      + 'used by the web app — authenticated with a long-lived API token instead of a user login.',
    baseUrl,

    authentication: {
      type:   'bearer',
      header: 'Authorization: Bearer <token>',
      notes:  'Tokens are created by an admin in Settings → API Tokens inside the OB Inventory web app '
        + 'and shown only once. This endpoint itself requires a valid token like everything else under /api/v1.',
      errors: {
        401: [
          { code: 'UNAUTHORIZED',    message: 'Missing Authorization header' },
          { code: 'INVALID_TOKEN',   message: 'Invalid or revoked token' },
          { code: 'TOKEN_EXPIRED',   message: 'Token expired' },
        ],
        429: [{ code: 'RATE_LIMITED', message: 'Rate limit exceeded — try again in <n>ms' }],
      },
    },

    rateLimit: { requestsPerMinute: 300, scope: 'per token' },

    conventions: {
      pagination: {
        style:   'limit/offset',
        params:  { limit: 'default 100, max 1000 (max 500 on stats/top-products)', offset: 'default 0' },
        shape:   { data: '[ ...rows ]', pagination: { limit: 100, offset: 0, total: 842 } },
        howToPageThrough: 'increment offset by limit until data.length < limit or offset >= total',
      },
      singleResource: { shape: { data: '{ ...one row }' } },
      errors:         { shape: { error: 'human message', code: 'MACHINE_CODE', details: 'optional, zod validation errors' } },
      dates:          'ISO-8601 — either a date (YYYY-MM-DD) or full datetime (2026-09-01T00:00:00Z)',
      incrementalSync: 'Endpoints with an updatedSince/createdSince param let you poll deltas '
        + 'instead of re-pulling everything — pass the timestamp of your last successful sync.',
      discoveringProducts: 'productId/sku filters used throughout this API are not guessable. '
        + 'Call GET /products?limit=1000 once (the catalog is currently well under 1000 items = a single '
        + 'page) to build a sku → { id, name, brand, category } lookup table, and reuse it for every '
        + 'filtered call. Use updatedSince to refresh the cache instead of re-pulling everything.',
    },

    endpoints: [
      {
        method: 'GET', path: '/products',
        summary: 'List products with resolved brand/category names and an attributes array (model, size, color, unit, ...).',
        params: {
          sku: 'exact SKU match', brandId: 'uuid', categoryId: 'uuid',
          search: 'matches sku or name, case-insensitive', updatedSince: 'ISO-8601 datetime — only products changed since',
          limit: 'default 100, max 1000', offset: 'default 0',
        },
        example: '/products?search=handwraps&limit=50',
      },
      {
        method: 'GET', path: '/products/:id',
        summary: "Single product, same shape as list, plus stock: [{ warehouseId, quantity, boxNumber }] for every warehouse holding it.",
      },
      { method: 'GET', path: '/brands',     summary: 'Reference data — all brands.' },
      { method: 'GET', path: '/categories', summary: 'Reference data — all categories.' },
      { method: 'GET', path: '/attributes', summary: 'Reference data — attribute definitions, each with its options[].' },

      {
        method: 'GET', path: '/warehouses',
        summary: 'List warehouses. Each row includes skuCount and totalQuantity aggregated from current stock.',
      },
      { method: 'GET', path: '/warehouses/:id', summary: 'Single warehouse.' },

      {
        method: 'GET', path: '/inventory/stock',
        summary: 'Current on-hand quantity per product per warehouse.',
        params: { warehouseId: 'uuid', productId: 'uuid', sku: 'exact match', limit: 'default 200, max 1000', offset: 'default 0' },
      },
      {
        method: 'GET', path: '/inventory/movements',
        summary: 'The append-only inventory ledger — every receive/transfer/sale/return/adjustment that ever touched stock. '
          + 'quantityDelta is signed (positive = stock in, negative = stock out).',
        params: {
          productId: 'uuid', sku: 'exact match, e.g. "every stock movement for SKU X"',
          warehouseId: 'uuid', actionType: 'receive | transfer_in | transfer_out | sale | return | adjustment',
          dateFrom: 'ISO-8601 date/datetime', dateTo: 'ISO-8601 date/datetime',
          limit: 'default 200, max 1000', offset: 'default 0',
        },
        example: '/inventory/movements?sku=HWR-BK&dateFrom=2026-03-01&dateTo=2026-03-31',
      },

      {
        method: 'GET', path: '/transfers',
        summary: 'Inter-warehouse stock transfers.',
        params: {
          fromWarehouseId: 'uuid', toWarehouseId: 'uuid', status: 'completed | cancelled',
          productId: 'uuid, returns only transfers containing that product', sku: 'exact match, same semantics as productId',
          dateFrom: 'ISO-8601', dateTo: 'ISO-8601', limit: 'default 100, max 1000', offset: 'default 0',
        },
      },
      { method: 'GET', path: '/transfers/:id', summary: 'Single transfer, includes items[].' },

      {
        method: 'GET', path: '/sales',
        summary: 'Sales. dateFrom/dateTo filter on saleDate. productId/sku return only sales that included that product — '
          + 'combine with dateFrom/dateTo and saleType/storeId for questions like "sales of SKU X via WooCommerce in Q2".',
        params: {
          saleType: 'direct | partner | woocommerce | merged — the closest concept to a "channel"',
          status: 'completed | cancelled | refunded | superseded',
          warehouseId: 'uuid', storeId: 'uuid', productId: 'uuid', sku: 'exact match',
          dateFrom: 'ISO-8601', dateTo: 'ISO-8601', updatedSince: 'ISO-8601 datetime — for incremental sync',
          limit: 'default 100, max 1000', offset: 'default 0',
        },
        example: '/sales?saleType=woocommerce&dateFrom=2026-04-01&dateTo=2026-06-30&sku=HWR-BK',
      },
      {
        method: 'GET', path: '/sales/:id',
        summary: 'Single sale. Includes items[], paymentMethods[], and cardcomDocuments[] (invoices/receipts issued for this sale).',
      },

      {
        method: 'GET', path: '/stats/sales-summary',
        summary: "Pre-aggregated revenue/count/quantity so you don't have to page through raw sales and sum client-side. "
          + 'Only counts completed sales. When productId/sku is set, revenue+quantity reflect only that product\'s line items, '
          + 'not the whole sale total.',
        params: {
          dateFrom: 'ISO-8601', dateTo: 'ISO-8601', warehouseId: 'uuid', saleType: 'direct|partner|woocommerce|merged',
          storeId: 'uuid', productId: 'uuid', sku: 'exact match',
          groupBy: 'day (default) | warehouse | saleType | store',
        },
        example: '/stats/sales-summary?dateFrom=2026-08-01&dateTo=2026-08-31&groupBy=saleType',
        responseExample: {
          groupBy: 'day',
          data: [{ group: '2026-09-01', count: 12, revenue: '4500.00', quantity: 34 }],
          totals: { count: 120, revenue: '45000.00', quantity: 340 },
        },
      },
      {
        method: 'GET', path: '/stats/top-products',
        summary: 'Best (or, with order=asc, worst) sellers by quantity or revenue — the direct answer to "what should we '
          + 'reorder from the manufacturer" or "what\'s dead stock". Only counts completed sales.',
        params: {
          dateFrom: 'ISO-8601', dateTo: 'ISO-8601', warehouseId: 'uuid', saleType: 'direct|partner|woocommerce|merged',
          storeId: 'uuid', brandId: 'uuid', categoryId: 'uuid',
          groupBy: 'product (default, individual SKUs) | brand | category',
          sortBy: 'quantity (default) | revenue', order: 'desc (default, best sellers) | asc (worst sellers / dead stock)',
          limit: 'default 50, max 500', offset: 'default 0',
        },
        example: '/stats/top-products?dateFrom=2026-06-01&sortBy=revenue&limit=20',
        responseExample: {
          groupBy: 'product', sortBy: 'quantity', order: 'desc',
          data: [{ sku: 'HWR-BK', name: '...', brandName: 'TKB', categoryName: 'ELASTICS', quantitySold: 91, revenue: '5560.00', orderCount: 46 }],
          limit: 50, offset: 0,
        },
      },
      {
        method: 'GET', path: '/stats/low-stock',
        summary: 'Reorder alert list: for every product with recent sales, projects daysOfStockRemaining from current stock '
          + 'divided by average daily sale rate over velocityDays, returns only products projected to run out within '
          + 'thresholdDays, most urgent first. Products with no sales in the window are excluded (no basis to project urgency).',
        params: {
          warehouseId: 'uuid', brandId: 'uuid', categoryId: 'uuid',
          velocityDays: 'window in days used to measure sales rate, default 30, max 365',
          thresholdDays: 'flag anything projected to run out within this many days, default 14',
          limit: 'default 100, max 1000', offset: 'default 0',
        },
        example: '/stats/low-stock?velocityDays=60&thresholdDays=30',
        responseExample: {
          data: [{ sku: 'HWR-BK', name: '...', currentStock: 4, qtySoldRecent: 24, avgDailyQty: 0.8, daysOfStockRemaining: 5 }],
          pagination: { limit: 100, offset: 0, total: 12 },
          meta: { velocityDays: 30, thresholdDays: 14 },
        },
      },
      {
        method: 'GET', path: '/stats/inventory-value',
        summary: 'Stock-on-hand valued at both costValue (cost price × qty) and retailValue (retail price × qty) — '
          + '"how much money is sitting in this warehouse/brand/category".',
        params: { warehouseId: 'uuid', brandId: 'uuid', categoryId: 'uuid', groupBy: 'none (default) | warehouse | brand | category' },
      },

      {
        method: 'GET', path: '/quotes',
        summary: 'Price quotes.',
        params: {
          status: 'open | converted | cancelled', warehouseId: 'uuid', productId: 'uuid', sku: 'exact match',
          customerEmail: 'exact match', dateFrom: 'ISO-8601', dateTo: 'ISO-8601',
          limit: 'default 100, max 1000', offset: 'default 0',
        },
      },
      { method: 'GET', path: '/quotes/:id', summary: 'Single quote, includes items[].' },

      {
        method: 'GET', path: '/customers',
        summary: 'Customers.',
        params: { search: 'matches name/email/phone', createdSince: 'ISO-8601 datetime', limit: 'default 100, max 1000', offset: 'default 0' },
      },
      { method: 'GET', path: '/customers/:id', summary: 'Single customer.' },

      {
        method: 'GET', path: '/users',
        summary: 'User metadata only — never password hashes. Fields: id, name, email, role, isActive, createdAt.',
      },
      { method: 'GET', path: '/users/:id', summary: 'Single user, same restricted fields.' },

      {
        method: 'GET', path: '/stores',
        summary: 'Store metadata only — never Woo/Cardcom secrets. Fields: id, name, url, platform, isActive, notes, createdAt.',
      },
    ],

    notAvailable: [
      'Write access — creating/editing sales, adjusting stock, etc. This entire surface is read-only.',
      'Cardcom/Woo credentials, password hashes, refresh/API token secrets — never exposed.',
    ],
  }
}

export const metaV1Routes: FastifyPluginAsync = async (fastify) => {
  const handler = async (request: FastifyRequest) => {
    const host    = request.headers.host ?? request.hostname
    const baseUrl = `${request.protocol}://${host}/api/v1`
    return buildDescriptor(baseUrl)
  }

  // Both the bare v1 root and an explicit /meta alias resolve to the same self-description —
  // an agent probing either should learn everything it needs in one call.
  fastify.get('/api/v1', handler)
  fastify.get('/api/v1/meta', handler)
}
