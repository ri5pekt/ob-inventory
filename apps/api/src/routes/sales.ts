import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, and, sql, inArray, gte, lte, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { enqueueSyncWooStock } from '../queue.js'
import {
  sales,
  saleItems,
  warehouses,
  stores,
  products,
  inventoryStock,
  inventoryLedger,
  saleTargets,
  saleInvoiceStatuses,
  salePaymentMethods,
} from '@ob-inventory/db'

export const salesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List sales ─────────────────────────────────────────────────────────────
  fastify.get('/api/sales', auth, async (request) => {
    const qSchema = z.object({
      type:     z.enum(['direct', 'partner', 'woocommerce']).optional(),
      dateFrom: z.string().optional(),
      dateTo:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(1000).default(100),
      offset:   z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.parse((request as { query: unknown }).query)

    const filters: ReturnType<typeof eq>[] = []
    if (q.type)     filters.push(eq(sales.saleType, q.type))
    if (q.dateFrom) filters.push(gte(sales.createdAt, new Date(q.dateFrom)) as ReturnType<typeof eq>)
    if (q.dateTo)   filters.push(lte(sales.createdAt, new Date(q.dateTo))   as ReturnType<typeof eq>)

    const rows = await db
      .select({
        id:           sales.id,
        saleType:     sales.saleType,
        status:       sales.status,
        warehouseId:  sales.warehouseId,
        warehouseName: warehouses.name,
        storeId:      sales.storeId,
        storeName:    stores.name,
        wooOrderId:   sales.wooOrderId,
        customerName:    sales.customerName,
        customerEmail:   sales.customerEmail,
        customerPhone:   sales.customerPhone,
        customerAddress: sales.customerAddress,
        totalPrice:      sales.totalPrice,
        currency:        sales.currency,
        notes:           sales.notes,
        createdAt:       sales.createdAt,
        targetId:           sales.targetId,
        targetName:         saleTargets.name,
        invoiceStatusId:    sales.invoiceStatusId,
        invoiceStatusName:  saleInvoiceStatuses.name,
        paymentMethodId:    sales.paymentMethodId,
        paymentMethodName:  salePaymentMethods.name,
        itemCount:          sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
      })
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleItems, eq(sales.id, saleItems.saleId))
      .leftJoin(saleTargets, eq(sales.targetId, saleTargets.id))
      .leftJoin(saleInvoiceStatuses, eq(sales.invoiceStatusId, saleInvoiceStatuses.id))
      .leftJoin(salePaymentMethods, eq(sales.paymentMethodId, salePaymentMethods.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .groupBy(sales.id, warehouses.name, stores.name, saleTargets.name, saleInvoiceStatuses.name, salePaymentMethods.name)
      .orderBy(desc(sales.createdAt))
      .limit(q.limit)
      .offset(q.offset)

    return rows
  })

  // ── Get single sale with items ─────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/sales/:id', auth, async (request, reply) => {
    const [sale] = await db
      .select({
        id:           sales.id,
        saleType:     sales.saleType,
        status:       sales.status,
        warehouseId:  sales.warehouseId,
        warehouseName: warehouses.name,
        storeId:      sales.storeId,
        storeName:    stores.name,
        wooOrderId:   sales.wooOrderId,
        customerName:    sales.customerName,
        customerEmail:   sales.customerEmail,
        customerPhone:   sales.customerPhone,
        customerAddress: sales.customerAddress,
        totalPrice:      sales.totalPrice,
        currency:        sales.currency,
        notes:           sales.notes,
        createdAt:       sales.createdAt,
        updatedAt:       sales.updatedAt,
        targetId:          sales.targetId,
        targetName:        saleTargets.name,
        invoiceStatusId:   sales.invoiceStatusId,
        invoiceStatusName: saleInvoiceStatuses.name,
        paymentMethodId:   sales.paymentMethodId,
        paymentMethodName: salePaymentMethods.name,
      })
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleTargets, eq(sales.targetId, saleTargets.id))
      .leftJoin(saleInvoiceStatuses, eq(sales.invoiceStatusId, saleInvoiceStatuses.id))
      .leftJoin(salePaymentMethods, eq(sales.paymentMethodId, salePaymentMethods.id))
      .where(eq(sales.id, request.params.id))

    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    const items = await db
      .select({
        id:        saleItems.id,
        saleId:    saleItems.saleId,
        productId: saleItems.productId,
        sku:       saleItems.sku,
        name:      saleItems.name,
        quantity:  saleItems.quantity,
        unitPrice: saleItems.unitPrice,
        lineTotal: saleItems.lineTotal,
        boxNumber: inventoryStock.boxNumber,
      })
      .from(saleItems)
      .leftJoin(
        inventoryStock,
        and(
          eq(saleItems.productId, inventoryStock.productId),
          eq(inventoryStock.warehouseId, sale.warehouseId),
        ),
      )
      .where(eq(saleItems.saleId, request.params.id))
      .orderBy(saleItems.sku)

    return { ...sale, items }
  })

  // ── Create manual sale (direct / partner) ──────────────────────────────────
  fastify.post('/api/sales', auth, async (request, reply) => {
    const bodySchema = z.object({
      saleType:      z.enum(['direct', 'partner']),
      warehouseId:   z.string().uuid().optional(),  // required for partner; direct → main warehouse
      customerName:    z.string().optional(),
      customerEmail:   z.string().optional(),
      customerPhone:   z.string().optional(),
      customerAddress: z.string().optional(),
      currency:        z.string().default('ILS'),
      notes:           z.string().optional(),
      targetId:         z.string().uuid().optional(),
      invoiceStatusId:  z.string().uuid().optional(),
      paymentMethodId:  z.string().uuid().optional(),
      items: z.array(z.object({
        sku:       z.string().min(1),
        name:      z.string().min(1),
        quantity:  z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional(),
        lineTotal: z.number().nonnegative().optional(),
      })).min(1),
    })

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      })
    }
    const d = parsed.data

    // Resolve warehouse
    let warehouseId = d.warehouseId
    if (!warehouseId || d.saleType === 'direct') {
      const [main] = await db.select().from(warehouses).where(eq(warehouses.type, 'main'))
      if (!main) return reply.status(500).send({ error: 'No main warehouse configured' })
      warehouseId = main.id
    } else {
      const [wh] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId))
      if (!wh) return reply.status(404).send({ error: 'Warehouse not found' })
    }

    // Resolve products by SKU
    const skus = [...new Set(d.items.map(i => i.sku))]
    const foundProducts = await db.select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.sku, skus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    // Check stock availability
    const productIds = foundProducts.map(p => p.id)
    const stockRows = productIds.length > 0
      ? await db.select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(and(
            inArray(inventoryStock.productId, productIds),
            eq(inventoryStock.warehouseId, warehouseId),
          ))
      : []
    const stockByProductId = new Map(stockRows.map(s => [s.productId, s.quantity]))

    // Validate sufficient stock
    const insufficientItems: { sku: string; requested: number; available: number }[] = []
    for (const item of d.items) {
      const product = productBySku.get(item.sku)
      if (product) {
        const available = stockByProductId.get(product.id) ?? 0
        if (available < item.quantity) {
          insufficientItems.push({ sku: item.sku, requested: item.quantity, available })
        }
      }
    }
    if (insufficientItems.length > 0) {
      return reply.status(422).send({
        error: 'Insufficient stock',
        code: 'INSUFFICIENT_STOCK',
        items: insufficientItems,
      })
    }

    // Calculate totals
    const totalPrice = d.items.reduce((sum, item) => {
      const lt = item.lineTotal ?? (item.unitPrice != null ? item.unitPrice * item.quantity : null)
      return lt != null ? sum + lt : sum
    }, 0)

    // Execute in transaction
    const result = await db.transaction(async (tx) => {
      const jwtPayload = (request as { user?: { sub?: string } }).user
      const userId = jwtPayload?.sub ?? null

      const [sale] = await tx.insert(sales).values({
        saleType:      d.saleType,
        status:        'completed',
        warehouseId:   warehouseId!,
        customerName:    d.customerName    ?? null,
        customerEmail:   d.customerEmail   ?? null,
        customerPhone:   d.customerPhone   ?? null,
        customerAddress: d.customerAddress ?? null,
        totalPrice:    totalPrice > 0 ? String(totalPrice) : null,
        currency:      d.currency,
        notes:           d.notes            ?? null,
        targetId:        d.targetId         ?? null,
        invoiceStatusId: d.invoiceStatusId  ?? null,
        paymentMethodId: d.paymentMethodId  ?? null,
        createdBy:       userId,
      }).returning()

      const itemsToInsert: typeof saleItems.$inferInsert[] = []

      for (const item of d.items) {
        const product = productBySku.get(item.sku)
        const lt: string | null = item.lineTotal != null ? String(item.lineTotal) : (item.unitPrice != null ? String(item.unitPrice * item.quantity) : null)

        itemsToInsert.push({
          saleId:    sale.id,
          productId: product?.id ?? null,
          sku:       item.sku,
          name:      item.name,
          quantity:  item.quantity,
          unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
          lineTotal: lt,
        })

        if (product) {
          await tx.update(inventoryStock)
            .set({
              quantity:  sql`${inventoryStock.quantity} - ${item.quantity}`,
              updatedAt: sql`now()`,
            })
            .where(and(
              eq(inventoryStock.productId, product.id),
              eq(inventoryStock.warehouseId, warehouseId!),
            ))

          await tx.insert(inventoryLedger).values({
            productId:     product.id,
            warehouseId:   warehouseId!,
            actionType:    'sale',
            quantityDelta: -item.quantity,
            referenceId:   sale.id,
            referenceType: 'sale',
            notes:         `Manual sale — ${d.saleType}`,
            createdBy:     userId,
          })
        }
      }

      await tx.insert(saleItems).values(itemsToInsert)

      return sale
    })

    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, warehouseId!))
    if (wh?.type === 'main') {
      for (const item of d.items) {
        const product = productBySku.get(item.sku)
        if (product) {
          try {
            await enqueueSyncWooStock(product.id)
          } catch (err) {
            (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId: product.id }, 'Failed to enqueue sync-woo-stock')
          }
        }
      }
    }

    return reply.status(201).send(result)
  })

  // ── Edit sale ──────────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/sales/:id', auth, async (request, reply) => {
    const bodySchema = z.object({
      customerName:    z.string().optional(),
      customerEmail:   z.string().optional(),
      customerPhone:   z.string().optional(),
      customerAddress: z.string().optional(),
      currency:        z.string().optional(),
      notes:           z.string().optional(),
      targetId:        z.string().uuid().nullable().optional(),
      invoiceStatusId: z.string().uuid().nullable().optional(),
      paymentMethodId: z.string().uuid().nullable().optional(),
      items: z.array(z.object({
        productId: z.string().uuid().optional(),
        sku:       z.string().min(1),
        name:      z.string().min(1),
        quantity:  z.number().int().positive(),
        unitPrice: z.number().nonnegative().optional(),
        lineTotal: z.number().nonnegative().optional(),
      })).min(1),
    })

    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const d = parsed.data

    const [sale] = await db.select().from(sales).where(eq(sales.id, request.params.id))
    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    const jwtPayload = (request as { user?: { sub?: string } }).user
    const userId = jwtPayload?.sub ?? null

    // Load current items
    const oldItems = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id))

    // Resolve product IDs for new items by SKU
    const newSkus = [...new Set(d.items.map(i => i.sku))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(inArray(products.sku, newSkus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    // Build stock delta map: productId -> net change (positive = restore, negative = deduct)
    const stockDeltas = new Map<string, number>()
    for (const old of oldItems) {
      if (old.productId) stockDeltas.set(old.productId, (stockDeltas.get(old.productId) ?? 0) + old.quantity)
    }
    for (const item of d.items) {
      const product = productBySku.get(item.sku)
      if (product) stockDeltas.set(product.id, (stockDeltas.get(product.id) ?? 0) - item.quantity)
    }

    // Validate stock for items that need more than what's available
    const productIds = [...stockDeltas.keys()]
    const stockRows = productIds.length > 0
      ? await db
          .select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(and(inArray(inventoryStock.productId, productIds), eq(inventoryStock.warehouseId, sale.warehouseId)))
      : []
    const stockByProductId = new Map(stockRows.map(s => [s.productId, s.quantity]))

    const insufficientItems: { sku: string; requested: number; available: number }[] = []
    for (const item of d.items) {
      const product = productBySku.get(item.sku)
      if (product) {
        const currentStock = stockByProductId.get(product.id) ?? 0
        const oldQty       = oldItems.find(o => o.productId === product.id)?.quantity ?? 0
        const effectiveAvailable = currentStock + oldQty
        if (item.quantity > effectiveAvailable) {
          insufficientItems.push({ sku: item.sku, requested: item.quantity, available: effectiveAvailable })
        }
      }
    }
    if (insufficientItems.length > 0) {
      return reply.status(422).send({ error: 'Insufficient stock', code: 'INSUFFICIENT_STOCK', items: insufficientItems })
    }

    const totalPrice = d.items.reduce((sum, item) => {
      const lt = item.lineTotal ?? (item.unitPrice != null ? item.unitPrice * item.quantity : null)
      return lt != null ? sum + lt : sum
    }, 0)

    await db.transaction(async (tx) => {
      // Apply stock deltas + ledger entries
      for (const [productId, delta] of stockDeltas.entries()) {
        if (delta === 0) continue
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`${inventoryStock.quantity} + ${delta}`, updatedAt: sql`now()` })
          .where(and(eq(inventoryStock.productId, productId), eq(inventoryStock.warehouseId, sale.warehouseId)))

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   sale.warehouseId,
          actionType:    delta > 0 ? 'return' : 'sale',
          quantityDelta: delta,
          referenceId:   sale.id,
          referenceType: 'sale',
          notes:         `Sale edited — stock ${delta > 0 ? 'restored' : 'adjusted'} (${sale.saleType})`,
          createdBy:     userId,
        })
      }

      // Replace sale items
      await tx.delete(saleItems).where(eq(saleItems.saleId, sale.id))
      await tx.insert(saleItems).values(
        d.items.map(item => {
          const product = productBySku.get(item.sku)
          const lt: string | null = item.lineTotal != null
            ? String(item.lineTotal)
            : item.unitPrice != null ? String(item.unitPrice * item.quantity) : null
          return {
            saleId:    sale.id,
            productId: product?.id ?? null,
            sku:       item.sku,
            name:      item.name,
            quantity:  item.quantity,
            unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
            lineTotal: lt,
          }
        }),
      )

      // Update sale metadata
      await tx
        .update(sales)
        .set({
          customerName:    d.customerName    ?? null,
          customerEmail:   d.customerEmail   ?? null,
          customerPhone:   d.customerPhone   ?? null,
          customerAddress: d.customerAddress ?? null,
          currency:        d.currency        ?? sale.currency,
          notes:           d.notes           ?? null,
          totalPrice:      totalPrice > 0 ? String(totalPrice) : null,
          targetId:        d.targetId        !== undefined ? d.targetId        : sale.targetId,
          invoiceStatusId: d.invoiceStatusId !== undefined ? d.invoiceStatusId : sale.invoiceStatusId,
          paymentMethodId: d.paymentMethodId !== undefined ? d.paymentMethodId : sale.paymentMethodId,
        })
        .where(eq(sales.id, sale.id))
    })

    // Trigger Woo sync for all affected products
    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, sale.warehouseId))
    if (wh?.type === 'main') {
      const affectedIds = [
        ...new Set([
          ...oldItems.map(i => i.productId).filter(Boolean) as string[],
          ...d.items.map(i => productBySku.get(i.sku)?.id).filter((id): id is string => !!id),
        ]),
      ]
      for (const productId of affectedIds) {
        try {
          await enqueueSyncWooStock(productId)
        } catch (err) {
          (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId }, 'Failed to enqueue sync-woo-stock after sale edit')
        }
      }
    }

    return reply.status(200).send({ ok: true })
  })

  // ── Delete sale (restore stock + ledger) ───────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/sales/:id', auth, async (request, reply) => {
    const { id } = request.params
    const jwtPayload = (request as { user?: { sub?: string } }).user
    const userId = jwtPayload?.sub ?? null

    const bodySchema = z.object({ reason: z.string().optional() })
    const { reason } = bodySchema.parse(request.body ?? {})

    // Load the sale + its items in one go
    const [sale] = await db.select().from(sales).where(eq(sales.id, id))
    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    const items = await db
      .select()
      .from(saleItems)
      .where(and(eq(saleItems.saleId, id), isNotNull(saleItems.productId)))

    await db.transaction(async (tx) => {
      for (const item of items) {
        if (!item.productId) continue

        // Restore stock
        await tx
          .update(inventoryStock)
          .set({
            quantity:  sql`${inventoryStock.quantity} + ${item.quantity}`,
            updatedAt: sql`now()`,
          })
          .where(and(
            eq(inventoryStock.productId,   item.productId),
            eq(inventoryStock.warehouseId, sale.warehouseId),
          ))

        // Ledger entry
        await tx.insert(inventoryLedger).values({
          productId:     item.productId,
          warehouseId:   sale.warehouseId,
          actionType:    'return',
          quantityDelta: item.quantity,
          referenceId:   sale.id,
          referenceType: 'sale',
          notes:         `Sale deleted — stock restored (${sale.saleType} sale)${reason ? ` — ${reason}` : ''}`,
          createdBy:     userId,
        })
      }

      // Delete sale (cascade removes sale_items)
      await tx.delete(sales).where(eq(sales.id, id))
    })

    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, sale.warehouseId))
    if (wh?.type === 'main') {
      for (const item of items) {
        if (item.productId) {
          try {
            await enqueueSyncWooStock(item.productId)
          } catch (err) {
            (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId: item.productId }, 'Failed to enqueue sync-woo-stock')
          }
        }
      }
    }

    return reply.status(200).send({ ok: true })
  })
}
