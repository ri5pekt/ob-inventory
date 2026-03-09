import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, and, ilike, or, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { inventoryLedger, products, warehouses, wooSyncLog, stores } from '@ob-inventory/db'

export const logsRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Unified inventory logs (ledger + Woo sync) ───────────────────────────────
  //
  // GET /api/inventory/logs?actionType=&warehouseId=&q=&limit=&offset=
  //
  // Returns merged ledger + woo_sync_log entries in one list, ordered by most recent.
  // Action types: receive, transfer_in, transfer_out, sale, return, adjustment,
  //               woo_push_success, woo_push_failed
  fastify.get('/api/inventory/logs', auth, async (request) => {
    const qSchema = z.object({
      actionType:  z.enum([
        'receive', 'transfer_in', 'transfer_out', 'sale', 'return', 'adjustment',
        'woo_push_success', 'woo_push_failed',
      ]).optional(),
      warehouseId: z.string().uuid().optional(),
      q:           z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(500).default(100),
      offset:      z.coerce.number().int().min(0).default(0),
    })
    const params = qSchema.parse((request as { query: unknown }).query)

    const isWooFilter = params.actionType === 'woo_push_success' || params.actionType === 'woo_push_failed'
    const includeLedger = !isWooFilter
    const includeWoo = true // always include woo logs so they appear alongside ledger (warehouse/action filters apply only to ledger)

    const ledgerActionType = params.actionType && !isWooFilter ? params.actionType : undefined
    const ledgerFilters: ReturnType<typeof and>[] = []
    if (ledgerActionType) ledgerFilters.push(eq(inventoryLedger.actionType, ledgerActionType as 'receive' | 'transfer_in' | 'transfer_out' | 'sale' | 'return' | 'adjustment'))
    if (params.warehouseId) ledgerFilters.push(eq(inventoryLedger.warehouseId, params.warehouseId))
    if (params.q?.trim()) {
      const term = `%${params.q.trim()}%`
      ledgerFilters.push(or(
        ilike(products.sku,  term),
        ilike(products.name, term),
      ) as ReturnType<typeof and>)
    }

    const [ledgerRows, wooRows] = await Promise.all([
      includeLedger
        ? db
            .select({
              id:            inventoryLedger.id,
              createdAt:     inventoryLedger.createdAt,
              actionType:    inventoryLedger.actionType,
              quantityDelta: inventoryLedger.quantityDelta,
              referenceType: inventoryLedger.referenceType,
              referenceId:   inventoryLedger.referenceId,
              notes:         inventoryLedger.notes,
              productId:     inventoryLedger.productId,
              productSku:    products.sku,
              productName:   products.name,
              warehouseId:   inventoryLedger.warehouseId,
              warehouseName: warehouses.name,
            })
            .from(inventoryLedger)
            .leftJoin(products,   eq(inventoryLedger.productId,   products.id))
            .leftJoin(warehouses, eq(inventoryLedger.warehouseId, warehouses.id))
            .where(ledgerFilters.length > 0 ? and(...ledgerFilters) : undefined)
            .orderBy(desc(inventoryLedger.createdAt))
            .limit(params.limit * 2)
        : [],
      includeWoo
        ? db
            .select({
              id:        wooSyncLog.id,
              createdAt: wooSyncLog.createdAt,
              action:    wooSyncLog.action,
              status:    wooSyncLog.status,
              productId: wooSyncLog.productId,
              productSku: products.sku,
              productName: products.name,
              payload:   wooSyncLog.payload,
              response:  wooSyncLog.response,
              error:     wooSyncLog.error,
            })
            .from(wooSyncLog)
            .leftJoin(products, eq(wooSyncLog.productId, products.id))
            .where(
              isWooFilter
                ? and(
                    eq(wooSyncLog.action, 'push_stock'),
                    eq(wooSyncLog.status, params.actionType === 'woo_push_success' ? 'success' : 'failed'),
                  )
                : eq(wooSyncLog.action, 'push_stock'),
            )
            .orderBy(desc(wooSyncLog.createdAt))
            .limit(params.limit * 2)
        : [],
    ])

    const storeIds = [...new Set(wooRows.map(r => (r.payload as { storeId?: string })?.storeId).filter(Boolean))] as string[]
    const storeRows = storeIds.length > 0
      ? await db.select({ id: stores.id, name: stores.name }).from(stores).where(inArray(stores.id, storeIds))
      : []
    const storeMap = new Map(storeRows.map(s => [s.id, s.name]))

    const qLower = params.q?.trim().toLowerCase()

    const ledgerEntries = ledgerRows.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      actionType: r.actionType,
      quantityDelta: r.quantityDelta,
      referenceType: r.referenceType,
      referenceId: r.referenceId,
      notes: r.notes,
      productId: r.productId,
      productSku: r.productSku,
      productName: r.productName,
      warehouseId: r.warehouseId,
      warehouseName: r.warehouseName,
    }))

    const wooEntries = wooRows
      .filter(r => !qLower || (r.productSku?.toLowerCase().includes(qLower)) || (r.productName?.toLowerCase().includes(qLower)))
      .map(r => {
        const storeId = (r.payload as { storeId?: string })?.storeId
        const storeName = storeId ? storeMap.get(storeId) ?? null : null
        const payloadQty = (r.payload as { quantity?: number })?.quantity
        const respQty = (r.response as { quantity?: number })?.quantity
        const notes = r.error
          ? r.error
          : r.response
            ? `OK — qty ${respQty ?? payloadQty ?? '?'}`
            : null
        return {
          id: `woo-${r.id}`,
          createdAt: r.createdAt,
          actionType: (r.status === 'success' ? 'woo_push_success' : 'woo_push_failed') as 'woo_push_success' | 'woo_push_failed',
          quantityDelta: payloadQty ?? 0,
          referenceType: null as string | null,
          referenceId: null as string | null,
          notes,
          productId: r.productId ?? '',
          productSku: r.productSku,
          productName: r.productName,
          warehouseId: storeId ?? null,
          warehouseName: storeName,
        }
      })

    const merged = [...ledgerEntries, ...wooEntries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(params.offset, params.offset + params.limit)

    return merged
  })
}
