import type { FastifyPluginAsync } from 'fastify'
import { eq, and, gte, lte, exists, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import { sales, saleItems, warehouses, stores } from '@ob-inventory/db'

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
}
