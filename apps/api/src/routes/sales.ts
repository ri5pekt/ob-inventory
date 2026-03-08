import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, count, and, sql, inArray, gte, lte, isNotNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import {
  sales,
  saleItems,
  warehouses,
  stores,
  products,
  inventoryStock,
  inventoryLedger,
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
        itemCount:       count(saleItems.id),
      })
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleItems, eq(sales.id, saleItems.saleId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .groupBy(sales.id, warehouses.name, stores.name)
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
      })
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .where(eq(sales.id, request.params.id))

    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    const items = await db
      .select()
      .from(saleItems)
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
        notes:         d.notes ?? null,
        createdBy:     userId,
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

    return reply.status(201).send(result)
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

    return reply.status(200).send({ ok: true })
  })
}
