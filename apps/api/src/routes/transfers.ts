import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, count, and, gt, gte, lte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { enqueueSyncWooStock } from '../queue.js'
import {
  transfers,
  transferItems,
  warehouses,
  products,
  inventoryStock,
  inventoryLedger,
} from '@ob-inventory/db'

// Note: GET /api/products/search is in ./product-search.ts

export const transferRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List transfers ─────────────────────────────────────────────────────────
  fastify.get('/api/transfers', auth, async (request) => {
    const qSchema = z.object({
      limit:    z.coerce.number().int().min(1).max(1000).default(50),
      offset:   z.coerce.number().int().min(0).default(0),
      dateFrom: z.string().optional(),
      dateTo:   z.string().optional(),
    })
    const { limit, offset, dateFrom, dateTo } = qSchema.parse((request as { query: unknown }).query)

    const dateFilters: ReturnType<typeof and>[] = []
    if (dateFrom) dateFilters.push(gte(transfers.createdAt, new Date(dateFrom)) as ReturnType<typeof and>)
    if (dateTo)   dateFilters.push(lte(transfers.createdAt, new Date(dateTo))   as ReturnType<typeof and>)

    const rows = await db
      .select({
        id:               transfers.id,
        status:           transfers.status,
        reference:        transfers.reference,
        notes:            transfers.notes,
        createdAt:        transfers.createdAt,
        fromWarehouseId:  transfers.fromWarehouseId,
        toWarehouseId:    transfers.toWarehouseId,
        itemCount:        count(transferItems.id),
      })
      .from(transfers)
      .leftJoin(transferItems, eq(transfers.id, transferItems.transferId))
      .where(dateFilters.length > 0 ? and(...dateFilters) : undefined)
      .groupBy(transfers.id)
      .orderBy(desc(transfers.createdAt))
      .limit(limit)
      .offset(offset)

    if (rows.length === 0) return []

    // Resolve warehouse names in a second query
    const allWhIds = [...new Set(rows.flatMap(r => [r.fromWarehouseId, r.toWarehouseId]))]
    const whRows = await db
      .select({ id: warehouses.id, name: warehouses.name })
      .from(warehouses)
      .where(inArray(warehouses.id, allWhIds))

    const whMap = new Map(whRows.map(w => [w.id, w.name]))

    return rows.map(r => ({
      ...r,
      fromWarehouseName: whMap.get(r.fromWarehouseId) ?? null,
      toWarehouseName:   whMap.get(r.toWarehouseId)   ?? null,
    }))
  })

  // ── Get single transfer with items ─────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/transfers/:id', auth, async (request, reply) => {
    const [transfer] = await db
      .select()
      .from(transfers)
      .where(eq(transfers.id, request.params.id))

    if (!transfer) return reply.status(404).send({ error: 'Transfer not found' })

    const [fromWh, toWh] = await Promise.all([
      db.select().from(warehouses).where(eq(warehouses.id, transfer.fromWarehouseId)).then(r => r[0]),
      db.select().from(warehouses).where(eq(warehouses.id, transfer.toWarehouseId)).then(r => r[0]),
    ])

    const items = await db
      .select({
        id:         transferItems.id,
        transferId: transferItems.transferId,
        productId:  transferItems.productId,
        sku:        transferItems.sku,
        name:       transferItems.name,
        quantity:   transferItems.quantity,
        boxNumber:  inventoryStock.boxNumber,
      })
      .from(transferItems)
      .leftJoin(
        inventoryStock,
        and(
          eq(transferItems.productId, inventoryStock.productId),
          eq(inventoryStock.warehouseId, transfer.fromWarehouseId),
        ),
      )
      .where(eq(transferItems.transferId, request.params.id))
      .orderBy(transferItems.sku)

    return {
      ...transfer,
      fromWarehouseName: fromWh?.name ?? null,
      toWarehouseName:   toWh?.name   ?? null,
      items,
    }
  })

  // ── Create and execute a transfer ──────────────────────────────────────────
  fastify.post('/api/transfers', auth, async (request, reply) => {
    const bodySchema = z.object({
      fromWarehouseId: z.string().uuid(),
      toWarehouseId:   z.string().uuid(),
      reference:       z.string().optional(),
      notes:           z.string().optional(),
      items: z.array(z.object({
        productId: z.string().uuid(),
        quantity:  z.number().int().positive(),
      })).min(1),
    })

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const d = parsed.data

    if (d.fromWarehouseId === d.toWarehouseId) {
      return reply.status(400).send({ error: 'Source and destination warehouses must be different', code: 'SAME_WAREHOUSE' })
    }

    // Validate warehouses exist
    const [fromWh, toWh] = await Promise.all([
      db.select().from(warehouses).where(eq(warehouses.id, d.fromWarehouseId)).then(r => r[0]),
      db.select().from(warehouses).where(eq(warehouses.id, d.toWarehouseId)).then(r => r[0]),
    ])
    if (!fromWh) return reply.status(404).send({ error: 'Source warehouse not found' })
    if (!toWh)   return reply.status(404).send({ error: 'Destination warehouse not found' })

    // Resolve product details
    const productIds = d.items.map(i => i.productId)
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.id, productIds))

    if (foundProducts.length !== productIds.length) {
      return reply.status(404).send({ error: 'One or more products not found' })
    }
    const productMap = new Map(foundProducts.map(p => [p.id, p]))

    // Check stock availability
    const stockRows = await db
      .select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
      .from(inventoryStock)
      .where(and(
        inArray(inventoryStock.productId, productIds),
        eq(inventoryStock.warehouseId, d.fromWarehouseId),
      ))

    const stockMap = new Map(stockRows.map(s => [s.productId, s.quantity]))

    const insufficient = d.items
      .filter(item => (stockMap.get(item.productId) ?? 0) < item.quantity)
      .map(item => ({
        sku:       productMap.get(item.productId)?.sku ?? item.productId,
        requested: item.quantity,
        available: stockMap.get(item.productId) ?? 0,
      }))

    if (insufficient.length > 0) {
      return reply.status(422).send({ error: 'Insufficient stock', code: 'INSUFFICIENT_STOCK', items: insufficient })
    }

    // Execute everything in a transaction
    const jwtPayload = (request as { user?: { sub?: string } }).user
    const userId = jwtPayload?.sub ?? null

    const result = await db.transaction(async (tx) => {
      const [transfer] = await tx.insert(transfers).values({
        fromWarehouseId: d.fromWarehouseId,
        toWarehouseId:   d.toWarehouseId,
        status:          'completed',
        reference:       d.reference ?? null,
        notes:           d.notes     ?? null,
        createdBy:       userId,
      }).returning()

      for (const item of d.items) {
        const product = productMap.get(item.productId)!

        await tx.insert(transferItems).values({
          transferId: transfer.id,
          productId:  item.productId,
          sku:        product.sku,
          name:       product.name,
          quantity:   item.quantity,
        })

        // ── Deduct from source warehouse ──────────────────────────────────
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`${inventoryStock.quantity} - ${item.quantity}`, updatedAt: sql`now()` })
          .where(and(
            eq(inventoryStock.productId,   item.productId),
            eq(inventoryStock.warehouseId, d.fromWarehouseId),
          ))

        await tx.insert(inventoryLedger).values({
          productId:     item.productId,
          warehouseId:   d.fromWarehouseId,
          actionType:    'transfer_out',
          quantityDelta: -item.quantity,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `Transfer to ${toWh.name}${d.reference ? ` (${d.reference})` : ''}`,
          createdBy:     userId,
        })

        // ── Add to destination warehouse (upsert) ─────────────────────────
        await tx
          .insert(inventoryStock)
          .values({ productId: item.productId, warehouseId: d.toWarehouseId, quantity: item.quantity })
          .onConflictDoUpdate({
            target: [inventoryStock.productId, inventoryStock.warehouseId],
            set: {
              quantity:  sql`${inventoryStock.quantity} + ${item.quantity}`,
              updatedAt: sql`now()`,
            },
          })

        await tx.insert(inventoryLedger).values({
          productId:     item.productId,
          warehouseId:   d.toWarehouseId,
          actionType:    'transfer_in',
          quantityDelta: item.quantity,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `Transfer from ${fromWh.name}${d.reference ? ` (${d.reference})` : ''}`,
          createdBy:     userId,
        })
      }

      return transfer
    })

    const [mainWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.type, 'main'))
    if (mainWh) {
      const affectedProductIds = d.items.map(i => i.productId)
      if (d.fromWarehouseId === mainWh.id || d.toWarehouseId === mainWh.id) {
        for (const pid of affectedProductIds) {
          try {
            await enqueueSyncWooStock(pid)
          } catch (err) {
            (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId: pid }, 'Failed to enqueue sync-woo-stock')
          }
        }
      }
    }

    return reply.status(201).send(result)
  })

  // ── Edit transfer (items + metadata, warehouses frozen) ────────────────────
  fastify.put<{ Params: { id: string } }>('/api/transfers/:id', auth, async (request, reply) => {
    const bodySchema = z.object({
      reference: z.string().optional(),
      notes:     z.string().optional(),
      items: z.array(z.object({
        productId: z.string().uuid(),
        quantity:  z.number().int().positive(),
      })).min(1),
    })

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const d = parsed.data

    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, request.params.id))
    if (!transfer) return reply.status(404).send({ error: 'Transfer not found' })

    const jwtPayload = (request as { user?: { sub?: string } }).user
    const userId = jwtPayload?.sub ?? null

    // Load current items
    const oldItems = await db.select().from(transferItems).where(eq(transferItems.transferId, transfer.id))

    // Resolve product details for new items
    const newProductIds = [...new Set(d.items.map(i => i.productId))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.id, newProductIds))
    if (foundProducts.length !== newProductIds.length) {
      return reply.status(404).send({ error: 'One or more products not found' })
    }
    const productMap = new Map(foundProducts.map(p => [p.id, p]))

    // Compute per-product net delta for the FROM warehouse:
    //   positive = net restore to from (old qty > new qty or item removed)
    //   negative = net additional deduction from from (new qty > old qty or item added)
    const fromDeltas = new Map<string, number>()
    for (const old of oldItems) {
      fromDeltas.set(old.productId, (fromDeltas.get(old.productId) ?? 0) + old.quantity)
    }
    for (const item of d.items) {
      fromDeltas.set(item.productId, (fromDeltas.get(item.productId) ?? 0) - item.quantity)
    }

    // Validate: for products needing more from fromWarehouse (delta < 0),
    // check effectiveAvailable = currentStock + oldQtyInTransfer >= newQty
    const allProductIds = [...fromDeltas.keys()]
    const stockRows = allProductIds.length > 0
      ? await db
          .select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(and(inArray(inventoryStock.productId, allProductIds), eq(inventoryStock.warehouseId, transfer.fromWarehouseId)))
      : []
    const stockMap = new Map(stockRows.map(s => [s.productId, s.quantity]))

    const insufficient: { sku: string; requested: number; available: number }[] = []
    for (const item of d.items) {
      const currentStock = stockMap.get(item.productId) ?? 0
      const oldQty       = oldItems.find(o => o.productId === item.productId)?.quantity ?? 0
      const effectiveAvailable = currentStock + oldQty
      if (item.quantity > effectiveAvailable) {
        insufficient.push({
          sku:       productMap.get(item.productId)?.sku ?? item.productId,
          requested: item.quantity,
          available: effectiveAvailable,
        })
      }
    }
    if (insufficient.length > 0) {
      return reply.status(422).send({ error: 'Insufficient stock', code: 'INSUFFICIENT_STOCK', items: insufficient })
    }

    const [fromWh, toWh] = await Promise.all([
      db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, transfer.fromWarehouseId)).then(r => r[0]),
      db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, transfer.toWarehouseId)).then(r => r[0]),
    ])

    await db.transaction(async (tx) => {
      // Apply net stock deltas for each affected product
      for (const [productId, fromDelta] of fromDeltas.entries()) {
        if (fromDelta === 0) continue
        const toDelta = -fromDelta // mirror: if from gets +5, to loses 5

        // FROM warehouse
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`${inventoryStock.quantity} + ${fromDelta}`, updatedAt: sql`now()` })
          .where(and(eq(inventoryStock.productId, productId), eq(inventoryStock.warehouseId, transfer.fromWarehouseId)))

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   transfer.fromWarehouseId,
          actionType:    fromDelta > 0 ? 'transfer_in' : 'transfer_out',
          quantityDelta: fromDelta,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `Transfer edited — stock adjusted (${fromDelta > 0 ? 'restored to' : 'additional deduction from'} ${fromWh?.name ?? 'source'})`,
          createdBy:     userId,
        })

        // TO warehouse
        await tx
          .insert(inventoryStock)
          .values({ productId, warehouseId: transfer.toWarehouseId, quantity: Math.max(0, toDelta) })
          .onConflictDoUpdate({
            target: [inventoryStock.productId, inventoryStock.warehouseId],
            set: {
              quantity:  sql`GREATEST(0, ${inventoryStock.quantity} + ${toDelta})`,
              updatedAt: sql`now()`,
            },
          })

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   transfer.toWarehouseId,
          actionType:    toDelta > 0 ? 'transfer_in' : 'transfer_out',
          quantityDelta: toDelta,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `Transfer edited — stock adjusted (${toDelta > 0 ? 'additional to' : 'removed from'} ${toWh?.name ?? 'destination'})`,
          createdBy:     userId,
        })
      }

      // Replace transfer items
      await tx.delete(transferItems).where(eq(transferItems.transferId, transfer.id))
      await tx.insert(transferItems).values(
        d.items.map(item => ({
          transferId: transfer.id,
          productId:  item.productId,
          sku:        productMap.get(item.productId)!.sku,
          name:       productMap.get(item.productId)!.name,
          quantity:   item.quantity,
        })),
      )

      // Update transfer metadata
      await tx
        .update(transfers)
        .set({
          reference: d.reference ?? null,
          notes:     d.notes     ?? null,
        })
        .where(eq(transfers.id, transfer.id))
    })

    // Trigger Woo sync for all affected products if main warehouse is involved
    const [mainWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.type, 'main'))
    if (mainWh && (transfer.fromWarehouseId === mainWh.id || transfer.toWarehouseId === mainWh.id)) {
      const affectedIds = [...new Set([
        ...oldItems.map(i => i.productId),
        ...d.items.map(i => i.productId),
      ])]
      for (const productId of affectedIds) {
        try {
          await enqueueSyncWooStock(productId)
        } catch (err) {
          (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId }, 'Failed to enqueue sync-woo-stock after transfer edit')
        }
      }
    }

    return reply.status(200).send({ ok: true })
  })

  // ── Delete transfer (reverse stock + ledger) ────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/transfers/:id', auth, async (request, reply) => {
    const { id } = request.params
    const jwtPayload = (request as { user?: { sub?: string } }).user
    const userId = jwtPayload?.sub ?? null

    const bodySchema = z.object({ reason: z.string().optional() })
    const { reason } = bodySchema.parse(request.body ?? {})

    const [transfer] = await db.select().from(transfers).where(eq(transfers.id, id))
    if (!transfer) return reply.status(404).send({ error: 'Transfer not found' })

    const items = await db
      .select()
      .from(transferItems)
      .where(eq(transferItems.transferId, id))

    const [fromWh, toWh] = await Promise.all([
      db.select().from(warehouses).where(eq(warehouses.id, transfer.fromWarehouseId)).then(r => r[0]),
      db.select().from(warehouses).where(eq(warehouses.id, transfer.toWarehouseId)).then(r => r[0]),
    ])

    await db.transaction(async (tx) => {
      for (const item of items) {
        const note = `Transfer deleted — stock reversed${reason ? ` — ${reason}` : ''}`

        // Restore stock to source warehouse
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`${inventoryStock.quantity} + ${item.quantity}`, updatedAt: sql`now()` })
          .where(and(
            eq(inventoryStock.productId,   item.productId),
            eq(inventoryStock.warehouseId, transfer.fromWarehouseId),
          ))

        await tx.insert(inventoryLedger).values({
          productId:     item.productId,
          warehouseId:   transfer.fromWarehouseId,
          actionType:    'transfer_in',
          quantityDelta: item.quantity,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `${note} (returned to ${fromWh?.name ?? 'source'})`,
          createdBy:     userId,
        })

        // Deduct stock from destination warehouse
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`GREATEST(0, ${inventoryStock.quantity} - ${item.quantity})`, updatedAt: sql`now()` })
          .where(and(
            eq(inventoryStock.productId,   item.productId),
            eq(inventoryStock.warehouseId, transfer.toWarehouseId),
          ))

        await tx.insert(inventoryLedger).values({
          productId:     item.productId,
          warehouseId:   transfer.toWarehouseId,
          actionType:    'transfer_out',
          quantityDelta: -item.quantity,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `${note} (removed from ${toWh?.name ?? 'destination'})`,
          createdBy:     userId,
        })
      }

      // Delete transfer (cascade removes transfer_items)
      await tx.delete(transfers).where(eq(transfers.id, id))
    })

    const [mainWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.type, 'main'))
    if (mainWh && (transfer.fromWarehouseId === mainWh.id || transfer.toWarehouseId === mainWh.id)) {
      for (const item of items) {
        try {
          await enqueueSyncWooStock(item.productId)
        } catch (err) {
          (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId: item.productId }, 'Failed to enqueue sync-woo-stock')
        }
      }
    }

    return reply.status(200).send({ ok: true })
  })
}
