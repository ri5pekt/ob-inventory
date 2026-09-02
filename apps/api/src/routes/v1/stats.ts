import type { FastifyPluginAsync } from 'fastify'
import { eq, and, gte, lte, exists, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import { sales, saleItems, warehouses, stores, products, brands, categories, inventoryStock } from '@ob-inventory/db'

const qSchema = z.object({
  dateFrom:    z.string().optional(),
  dateTo:      z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  saleType:    z.enum(['direct', 'partner', 'woocommerce', 'merged']).optional(),
  storeId:     z.string().uuid().optional(),
  productId:   z.string().uuid().optional(),
  sku:         z.string().optional(),
  groupBy:     z.enum(['day', 'warehouse', 'saleType', 'store']).default('day'),
})

export const statsV1Routes: FastifyPluginAsync = async (fastify) => {
  // ── Sales summary — revenue / count / quantity, bucketed by day, warehouse, saleType or store ──
  fastify.get('/api/v1/stats/sales-summary', async (request, reply) => {
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    // Only count completed sales in revenue stats by default — cancelled/refunded/superseded
    // sales would otherwise inflate revenue with money that was never actually kept.
    const filters: SQL[] = [eq(sales.status, 'completed')]
    if (f.warehouseId) filters.push(eq(sales.warehouseId, f.warehouseId))
    if (f.saleType)    filters.push(eq(sales.saleType, f.saleType))
    if (f.storeId)     filters.push(eq(sales.storeId, f.storeId))
    if (f.dateFrom)    filters.push(gte(sales.saleDate, new Date(f.dateFrom)))
    if (f.dateTo)      filters.push(lte(sales.saleDate, new Date(f.dateTo)))

    const hasProductFilter = !!(f.productId || f.sku)
    if (hasProductFilter) {
      const itemConds: SQL[] = [eq(saleItems.saleId, sales.id)]
      if (f.productId) itemConds.push(eq(saleItems.productId, f.productId))
      if (f.sku)        itemConds.push(eq(saleItems.sku, f.sku))
      filters.push(exists(db.select({ one: sql`1` }).from(saleItems).where(and(...itemConds))))
    }
    const where = and(...filters)

    // When scoped to a product/sku, revenue + quantity reflect that product's line items only
    // (not the whole sale total) — otherwise they reflect the full sale.
    const productCond = f.productId
      ? sql`AND ${saleItems.productId} = ${f.productId}`
      : f.sku
        ? sql`AND ${saleItems.sku} = ${f.sku}`
        : sql``

    const quantityExpr = sql<number>`(SELECT COALESCE(SUM(${saleItems.quantity}), 0) FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id} ${productCond})`
    const revenueExpr = hasProductFilter
      ? sql<string>`(SELECT COALESCE(SUM(${saleItems.lineTotal}), 0) FROM ${saleItems} WHERE ${saleItems.saleId} = ${sales.id} ${productCond})`
      : sql<string>`COALESCE(${sales.totalPrice}, 0)`

    const aggCols = {
      count:    sql<number>`count(*)`.as('count'),
      revenue:  sql<string>`coalesce(sum(${revenueExpr}), 0)`.as('revenue'),
      quantity: sql<number>`coalesce(sum(${quantityExpr}), 0)`.as('quantity'),
    }

    let rows: Array<{ group: string | null; count: number; revenue: string; quantity: number; warehouseName?: string | null; storeName?: string | null }>

    if (f.groupBy === 'warehouse') {
      const res = await db
        .select({ group: sales.warehouseId, warehouseName: warehouses.name, ...aggCols })
        .from(sales)
        .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
        .where(where)
        .groupBy(sales.warehouseId, warehouses.name)
        .orderBy(warehouses.name)
      rows = res.map(r => ({ ...r, count: Number(r.count), quantity: Number(r.quantity) }))
    } else if (f.groupBy === 'saleType') {
      const res = await db
        .select({ group: sales.saleType, ...aggCols })
        .from(sales)
        .where(where)
        .groupBy(sales.saleType)
        .orderBy(sales.saleType)
      rows = res.map(r => ({ ...r, count: Number(r.count), quantity: Number(r.quantity) }))
    } else if (f.groupBy === 'store') {
      const res = await db
        .select({ group: sales.storeId, storeName: stores.name, ...aggCols })
        .from(sales)
        .leftJoin(stores, eq(sales.storeId, stores.id))
        .where(where)
        .groupBy(sales.storeId, stores.name)
        .orderBy(stores.name)
      rows = res.map(r => ({ ...r, count: Number(r.count), quantity: Number(r.quantity) }))
    } else {
      const dayExpr = sql<string>`to_char(date_trunc('day', ${sales.saleDate}), 'YYYY-MM-DD')`
      const res = await db
        .select({ group: dayExpr, ...aggCols })
        .from(sales)
        .where(where)
        .groupBy(dayExpr)
        .orderBy(dayExpr)
      rows = res.map(r => ({ ...r, count: Number(r.count), quantity: Number(r.quantity) }))
    }

    const [totals] = await db
      .select({
        count:    sql<number>`count(*)`,
        revenue:  sql<string>`coalesce(sum(${revenueExpr}), 0)`,
        quantity: sql<number>`coalesce(sum(${quantityExpr}), 0)`,
      })
      .from(sales)
      .where(where)

    return {
      groupBy: f.groupBy,
      data: rows,
      totals: { count: Number(totals?.count ?? 0), revenue: totals?.revenue ?? '0', quantity: Number(totals?.quantity ?? 0) },
    }
  })

  // ── Top products — best/worst sellers, so an admin/agent knows what to reorder ──
  fastify.get('/api/v1/stats/top-products', async (request, reply) => {
    const topSchema = z.object({
      dateFrom:    z.string().optional(),
      dateTo:      z.string().optional(),
      warehouseId: z.string().uuid().optional(),
      saleType:    z.enum(['direct', 'partner', 'woocommerce', 'merged']).optional(),
      storeId:     z.string().uuid().optional(),
      brandId:     z.string().uuid().optional(),
      categoryId:  z.string().uuid().optional(),
      groupBy:     z.enum(['product', 'brand', 'category']).default('product'),
      sortBy:      z.enum(['quantity', 'revenue']).default('quantity'),
      order:       z.enum(['desc', 'asc']).default('desc'), // asc = worst sellers, useful for spotting dead stock
      limit:       z.coerce.number().int().min(1).max(500).default(50),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const q = topSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: SQL[] = [eq(sales.status, 'completed')]
    if (f.warehouseId) filters.push(eq(sales.warehouseId, f.warehouseId))
    if (f.saleType)    filters.push(eq(sales.saleType, f.saleType))
    if (f.storeId)     filters.push(eq(sales.storeId, f.storeId))
    if (f.dateFrom)    filters.push(gte(sales.saleDate, new Date(f.dateFrom)))
    if (f.dateTo)      filters.push(lte(sales.saleDate, new Date(f.dateTo)))
    if (f.brandId)     filters.push(eq(products.brandId, f.brandId))
    if (f.categoryId)  filters.push(eq(products.categoryId, f.categoryId))
    const where = and(...filters)

    const quantityAgg = sql<number>`coalesce(sum(${saleItems.quantity}), 0)`
    const revenueAgg  = sql<string>`coalesce(sum(${saleItems.lineTotal}), 0)`
    // Must match aggCols exactly (coalesce'd) — plain sum() over an all-null group returns NULL,
    // and Postgres sorts NULLs *first* on DESC by default, which would float zero-revenue rows
    // to the top of a "best sellers by revenue" list.
    const orderExpr   = f.sortBy === 'revenue' ? revenueAgg : quantityAgg
    const orderDir    = f.order === 'asc' ? sql`asc` : sql`desc`

    const aggCols = {
      quantitySold: quantityAgg.as('quantity_sold'),
      revenue:      revenueAgg.as('revenue'),
      orderCount:   sql<number>`count(distinct ${saleItems.saleId})`.as('order_count'),
    }

    let rows: Array<{ group: string | null; name?: string | null; quantitySold: number; revenue: string; orderCount: number; brandName?: string | null; categoryName?: string | null }>

    if (f.groupBy === 'brand') {
      const res = await db
        .select({ group: products.brandId, name: brands.name, ...aggCols })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .innerJoin(products, eq(saleItems.productId, products.id))
        .leftJoin(brands, eq(products.brandId, brands.id))
        .where(where)
        .groupBy(products.brandId, brands.name)
        .orderBy(sql`${orderExpr} ${orderDir}`)
        .limit(f.limit)
        .offset(f.offset)
      rows = res.map(r => ({ ...r, quantitySold: Number(r.quantitySold), orderCount: Number(r.orderCount) }))
    } else if (f.groupBy === 'category') {
      const res = await db
        .select({ group: products.categoryId, name: categories.name, ...aggCols })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .innerJoin(products, eq(saleItems.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .groupBy(products.categoryId, categories.name)
        .orderBy(sql`${orderExpr} ${orderDir}`)
        .limit(f.limit)
        .offset(f.offset)
      rows = res.map(r => ({ ...r, quantitySold: Number(r.quantitySold), orderCount: Number(r.orderCount) }))
    } else {
      // Grouped by (productId, sku) rather than productId alone — WooCommerce order lines can
      // have a null productId (product not yet mapped in OB Inventory), and SQL groups all
      // NULLs together, so sku keeps those distinct instead of collapsing them into one bucket.
      const res = await db
        .select({
          group:        saleItems.productId,
          sku:          saleItems.sku,
          name:         sql<string>`max(${saleItems.name})`,
          brandName:    sql<string | null>`max(${brands.name})`,
          categoryName: sql<string | null>`max(${categories.name})`,
          ...aggCols,
        })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .leftJoin(products, eq(saleItems.productId, products.id))
        .leftJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .groupBy(saleItems.productId, saleItems.sku)
        .orderBy(sql`${orderExpr} ${orderDir}`)
        .limit(f.limit)
        .offset(f.offset)
      rows = res.map(r => ({ ...r, quantitySold: Number(r.quantitySold), orderCount: Number(r.orderCount) }))
    }

    return { groupBy: f.groupBy, sortBy: f.sortBy, order: f.order, data: rows, limit: f.limit, offset: f.offset }
  })

  // ── Low stock — sales velocity vs current stock, i.e. what to reorder and how urgently ──
  fastify.get('/api/v1/stats/low-stock', async (request, reply) => {
    const lowStockSchema = z.object({
      warehouseId:   z.string().uuid().optional(),
      brandId:       z.string().uuid().optional(),
      categoryId:    z.string().uuid().optional(),
      velocityDays:  z.coerce.number().int().min(1).max(365).default(30), // window used to measure sales rate
      thresholdDays: z.coerce.number().int().min(0).max(365).default(14), // flag anything projected to run out within this many days
      limit:         z.coerce.number().int().min(1).max(1000).default(100),
      offset:        z.coerce.number().int().min(0).default(0),
    })
    const q = lowStockSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const productFilters: SQL[] = []
    if (f.brandId)    productFilters.push(eq(products.brandId, f.brandId))
    if (f.categoryId) productFilters.push(eq(products.categoryId, f.categoryId))

    const stockFilters: SQL[] = []
    if (f.warehouseId) stockFilters.push(eq(inventoryStock.warehouseId, f.warehouseId))

    const cutoff = new Date(Date.now() - f.velocityDays * 24 * 60 * 60 * 1000)
    const velocityFilters: SQL[] = [eq(sales.status, 'completed'), gte(sales.saleDate, cutoff)]
    if (f.warehouseId) velocityFilters.push(eq(sales.warehouseId, f.warehouseId))

    const [productRows, stockRows, velocityRows] = await Promise.all([
      db.select({ id: products.id, sku: products.sku, name: products.name, brandName: brands.name, categoryName: categories.name })
        .from(products)
        .leftJoin(brands, eq(products.brandId, brands.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(productFilters.length > 0 ? and(...productFilters) : undefined),
      db.select({ productId: inventoryStock.productId, stock: sql<number>`coalesce(sum(${inventoryStock.quantity}), 0)` })
        .from(inventoryStock)
        .where(stockFilters.length > 0 ? and(...stockFilters) : undefined)
        .groupBy(inventoryStock.productId),
      db.select({ productId: saleItems.productId, qty: sql<number>`coalesce(sum(${saleItems.quantity}), 0)` })
        .from(saleItems)
        .innerJoin(sales, eq(saleItems.saleId, sales.id))
        .where(and(...velocityFilters))
        .groupBy(saleItems.productId),
    ])

    const stockMap    = new Map(stockRows.map(r => [r.productId, Number(r.stock)]))
    const velocityMap  = new Map(velocityRows.filter((r): r is { productId: string; qty: number } => r.productId != null).map(r => [r.productId, Number(r.qty)]))

    const computed = productRows.map(p => {
      const currentStock  = stockMap.get(p.id) ?? 0
      const qtySoldRecent = velocityMap.get(p.id) ?? 0
      const avgDailyQty   = qtySoldRecent / f.velocityDays
      const daysOfStockRemaining = avgDailyQty > 0 ? Math.round((currentStock / avgDailyQty) * 10) / 10 : null
      return {
        productId: p.id, sku: p.sku, name: p.name, brandName: p.brandName, categoryName: p.categoryName,
        currentStock, qtySoldRecent, avgDailyQty: Math.round(avgDailyQty * 100) / 100, daysOfStockRemaining,
      }
    })

    // Only products with recent sales velocity are "reorder" candidates — no sales in the window
    // means we have no basis to project when they'll run out.
    const flagged = computed
      .filter(p => p.daysOfStockRemaining !== null && p.daysOfStockRemaining <= f.thresholdDays)
      .sort((a, b) => (a.daysOfStockRemaining ?? Infinity) - (b.daysOfStockRemaining ?? Infinity))

    const page = flagged.slice(f.offset, f.offset + f.limit)

    return {
      data: page,
      pagination: { limit: f.limit, offset: f.offset, total: flagged.length },
      meta: { velocityDays: f.velocityDays, thresholdDays: f.thresholdDays },
    }
  })

  // ── Inventory value — stock-on-hand valued at cost and retail price ──────────
  fastify.get('/api/v1/stats/inventory-value', async (request, reply) => {
    const invSchema = z.object({
      warehouseId: z.string().uuid().optional(),
      brandId:     z.string().uuid().optional(),
      categoryId:  z.string().uuid().optional(),
      groupBy:     z.enum(['none', 'warehouse', 'brand', 'category']).default('none'),
    })
    const q = invSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: SQL[] = []
    if (f.warehouseId) filters.push(eq(inventoryStock.warehouseId, f.warehouseId))
    if (f.brandId)     filters.push(eq(products.brandId, f.brandId))
    if (f.categoryId)  filters.push(eq(products.categoryId, f.categoryId))
    const where = filters.length > 0 ? and(...filters) : undefined

    const aggCols = {
      quantity:    sql<number>`coalesce(sum(${inventoryStock.quantity}), 0)`.as('quantity'),
      costValue:   sql<string>`coalesce(sum(${inventoryStock.quantity} * coalesce(${products.costPrice}, 0)), 0)`.as('cost_value'),
      retailValue: sql<string>`coalesce(sum(${inventoryStock.quantity} * coalesce(${products.retailPrice}, 0)), 0)`.as('retail_value'),
    }

    let rows: Array<{ group?: string | null; quantity: number; costValue: string; retailValue: string; warehouseName?: string | null; brandName?: string | null; categoryName?: string | null }>

    if (f.groupBy === 'warehouse') {
      const res = await db
        .select({ group: inventoryStock.warehouseId, warehouseName: warehouses.name, ...aggCols })
        .from(inventoryStock)
        .innerJoin(products, eq(inventoryStock.productId, products.id))
        .leftJoin(warehouses, eq(inventoryStock.warehouseId, warehouses.id))
        .where(where)
        .groupBy(inventoryStock.warehouseId, warehouses.name)
        .orderBy(warehouses.name)
      rows = res.map(r => ({ ...r, quantity: Number(r.quantity) }))
    } else if (f.groupBy === 'brand') {
      const res = await db
        .select({ group: products.brandId, brandName: brands.name, ...aggCols })
        .from(inventoryStock)
        .innerJoin(products, eq(inventoryStock.productId, products.id))
        .leftJoin(brands, eq(products.brandId, brands.id))
        .where(where)
        .groupBy(products.brandId, brands.name)
        .orderBy(brands.name)
      rows = res.map(r => ({ ...r, quantity: Number(r.quantity) }))
    } else if (f.groupBy === 'category') {
      const res = await db
        .select({ group: products.categoryId, categoryName: categories.name, ...aggCols })
        .from(inventoryStock)
        .innerJoin(products, eq(inventoryStock.productId, products.id))
        .leftJoin(categories, eq(products.categoryId, categories.id))
        .where(where)
        .groupBy(products.categoryId, categories.name)
        .orderBy(categories.name)
      rows = res.map(r => ({ ...r, quantity: Number(r.quantity) }))
    } else {
      const [totals] = await db
        .select(aggCols)
        .from(inventoryStock)
        .innerJoin(products, eq(inventoryStock.productId, products.id))
        .where(where)
      rows = [{ ...totals, quantity: Number(totals?.quantity ?? 0), costValue: totals?.costValue ?? '0', retailValue: totals?.retailValue ?? '0' }]
    }

    return { groupBy: f.groupBy, data: rows }
  })
}
