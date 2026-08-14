import type { FastifyPluginAsync } from 'fastify'
import { eq, desc, and, sql, inArray, ilike, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { enqueueSyncWooStock } from '../queue.js'
import {
  quotes,
  quoteItems,
  sales,
  saleItems,
  warehouses,
  products,
  inventoryStock,
  inventoryLedger,
  users,
} from '@ob-inventory/db'
import { upsertCustomerFromSale } from './sales.js'

const itemSchema = z.object({
  sku:       z.string().min(1),
  name:      z.string().min(1),
  quantity:  z.number().int().positive(),
  unitPrice: z.number().nonnegative().optional(),
  lineTotal: z.number().nonnegative().optional(),
})

const quoteBodySchema = z.object({
  warehouseId:      z.string().uuid().optional(),
  customerName:     z.string().optional(),
  customerEmail:    z.string().optional(),
  customerPhone:    z.string().optional(),
  customerAddress:  z.string().optional(),
  customerIdNumber: z.string().optional(),
  currency:         z.string().default('ILS'),
  notes:            z.string().optional(),
  quoteDate:        z.string().optional(),
  createCustomer:   z.boolean().default(true),
  items:            z.array(itemSchema).min(1),
})

async function resolveCreatedBy(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId))
  return row?.id ?? null
}

async function resolveWarehouseId(requested: string | undefined) {
  if (requested) {
    const [wh] = await db.select().from(warehouses).where(eq(warehouses.id, requested))
    return wh ?? null
  }
  const [main] = await db.select().from(warehouses).where(eq(warehouses.type, 'main'))
  return main ?? null
}

function calcTotal(items: z.infer<typeof itemSchema>[]) {
  return items.reduce((sum, item) => {
    const lt = item.lineTotal ?? (item.unitPrice != null ? item.unitPrice * item.quantity : null)
    return lt != null ? sum + lt : sum
  }, 0)
}

async function loadQuoteDetail(id: string) {
  const [quote] = await db
    .select({
      id:               quotes.id,
      quoteNumber:      quotes.quoteNumber,
      status:           quotes.status,
      warehouseId:      quotes.warehouseId,
      warehouseName:    warehouses.name,
      customerName:     quotes.customerName,
      customerEmail:    quotes.customerEmail,
      customerPhone:    quotes.customerPhone,
      customerAddress:  quotes.customerAddress,
      customerIdNumber: quotes.customerIdNumber,
      totalPrice:       quotes.totalPrice,
      currency:         quotes.currency,
      notes:            quotes.notes,
      quoteDate:        quotes.quoteDate,
      createdAt:        quotes.createdAt,
      updatedAt:        quotes.updatedAt,
      createdByName:    users.name,
      convertedSaleId:  quotes.convertedSaleId,
    })
    .from(quotes)
    .leftJoin(warehouses, eq(quotes.warehouseId, warehouses.id))
    .leftJoin(users, eq(quotes.createdBy, users.id))
    .where(eq(quotes.id, id))

  if (!quote) return null

  const items = await db
    .select({
      id:        quoteItems.id,
      quoteId:   quoteItems.quoteId,
      productId: quoteItems.productId,
      sku:       quoteItems.sku,
      name:      quoteItems.name,
      quantity:  quoteItems.quantity,
      unitPrice: quoteItems.unitPrice,
      lineTotal: quoteItems.lineTotal,
    })
    .from(quoteItems)
    .where(eq(quoteItems.quoteId, id))
    .orderBy(quoteItems.sku)

  return { ...quote, items }
}

export const quotesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  fastify.get('/api/quotes', auth, async (request) => {
    const q = z.object({
      status: z.enum(['open', 'converted', 'cancelled']).optional(),
      q:      z.string().optional(),
      limit:  z.coerce.number().int().min(1).max(1000).default(200),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse((request as { query: unknown }).query)

    const user = request.user as { role: string; warehouseIds: string[] }
    const filters = []
    if (q.status) filters.push(eq(quotes.status, q.status))
    if (user.role === 'warehouse_admin') {
      if (user.warehouseIds.length === 0) return []
      filters.push(inArray(quotes.warehouseId, user.warehouseIds))
    }
    if (q.q?.trim()) {
      const term = `%${q.q.trim()}%`
      filters.push(or(
        ilike(quotes.customerName, term),
        ilike(quotes.customerEmail, term),
        sql`cast(${quotes.quoteNumber} as text) ilike ${term}`,
      )!)
    }

    const rows = await db
      .select({
        id:               quotes.id,
        quoteNumber:      quotes.quoteNumber,
        status:           quotes.status,
        warehouseId:      quotes.warehouseId,
        warehouseName:    warehouses.name,
        customerName:     quotes.customerName,
        customerEmail:    quotes.customerEmail,
        customerPhone:    quotes.customerPhone,
        customerAddress:  quotes.customerAddress,
        customerIdNumber: quotes.customerIdNumber,
        totalPrice:       quotes.totalPrice,
        currency:         quotes.currency,
        notes:            quotes.notes,
        quoteDate:        quotes.quoteDate,
        createdAt:        quotes.createdAt,
        createdByName:    users.name,
        convertedSaleId:  quotes.convertedSaleId,
        itemCount:        sql<number>`coalesce(sum(${quoteItems.quantity}), 0)`,
      })
      .from(quotes)
      .leftJoin(warehouses, eq(quotes.warehouseId, warehouses.id))
      .leftJoin(quoteItems, eq(quotes.id, quoteItems.quoteId))
      .leftJoin(users, eq(quotes.createdBy, users.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .groupBy(quotes.id, warehouses.name, users.name)
      .orderBy(desc(quotes.quoteDate))
      .limit(q.limit)
      .offset(q.offset)

    return rows
  })

  fastify.get<{ Params: { id: string } }>('/api/quotes/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const quote = await loadQuoteDetail(id)
    if (!quote) return reply.status(404).send({ error: 'Quote not found' })
    return quote
  })

  fastify.post('/api/quotes', auth, async (request, reply) => {
    const parsed = quoteBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      })
    }
    const d = parsed.data
    const postUser = request.user as { role: string; warehouseIds: string[]; id?: string }

    const warehouse = await resolveWarehouseId(d.warehouseId)
    if (!warehouse) return reply.status(404).send({ error: 'Warehouse not found' })
    if (postUser.role === 'warehouse_admin' && !postUser.warehouseIds.includes(warehouse.id)) {
      return reply.status(403).send({ error: 'Access to this warehouse is not allowed', code: 'FORBIDDEN' })
    }

    const skus = [...new Set(d.items.map(i => i.sku))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(inArray(products.sku, skus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    const totalPrice = calcTotal(d.items)
    const userId = await resolveCreatedBy(postUser.id)

    const [quote] = await db.transaction(async (tx) => {
      const [row] = await tx.insert(quotes).values({
        warehouseId:      warehouse.id,
        customerName:     d.customerName     ?? null,
        customerEmail:    d.customerEmail    ?? null,
        customerPhone:    d.customerPhone    ?? null,
        customerAddress:  d.customerAddress  ?? null,
        customerIdNumber: d.customerIdNumber ?? null,
        totalPrice:       totalPrice > 0 ? String(totalPrice) : null,
        currency:         d.currency,
        notes:            d.notes ?? null,
        quoteDate:        d.quoteDate ? new Date(d.quoteDate) : new Date(),
        createdBy:        userId,
      }).returning()

      await tx.insert(quoteItems).values(d.items.map(item => {
        const product = productBySku.get(item.sku)
        const lt = item.lineTotal != null
          ? String(item.lineTotal)
          : (item.unitPrice != null ? String(item.unitPrice * item.quantity) : null)
        return {
          quoteId:    row.id,
          productId:  product?.id ?? null,
          sku:        item.sku,
          name:       item.name,
          quantity:   item.quantity,
          unitPrice:  item.unitPrice != null ? String(item.unitPrice) : null,
          lineTotal:  lt,
        }
      }))

      return [row]
    })

    await upsertCustomerFromSale(
      {
        customerName:     d.customerName,
        customerEmail:    d.customerEmail,
        customerPhone:    d.customerPhone,
        customerAddress:  d.customerAddress,
        customerIdNumber: d.customerIdNumber,
      },
      { allowCreate: d.createCustomer },
    )

    return reply.status(201).send(await loadQuoteDetail(quote.id))
  })

  fastify.put<{ Params: { id: string } }>('/api/quotes/:id', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const parsed = quoteBodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      })
    }
    const d = parsed.data
    const postUser = request.user as { role: string; warehouseIds: string[] }

    const [existing] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1)
    if (!existing) return reply.status(404).send({ error: 'Quote not found' })
    if (existing.status !== 'open') {
      return reply.status(400).send({ error: 'Only open quotes can be edited', code: 'QUOTE_NOT_OPEN' })
    }

    const warehouse = await resolveWarehouseId(d.warehouseId ?? existing.warehouseId)
    if (!warehouse) return reply.status(404).send({ error: 'Warehouse not found' })
    if (postUser.role === 'warehouse_admin' && !postUser.warehouseIds.includes(warehouse.id)) {
      return reply.status(403).send({ error: 'Access to this warehouse is not allowed', code: 'FORBIDDEN' })
    }

    const skus = [...new Set(d.items.map(i => i.sku))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(inArray(products.sku, skus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))
    const totalPrice = calcTotal(d.items)

    await db.transaction(async (tx) => {
      await tx.update(quotes).set({
        warehouseId:      warehouse.id,
        customerName:     d.customerName     ?? null,
        customerEmail:    d.customerEmail    ?? null,
        customerPhone:    d.customerPhone    ?? null,
        customerAddress:  d.customerAddress  ?? null,
        customerIdNumber: d.customerIdNumber ?? null,
        totalPrice:       totalPrice > 0 ? String(totalPrice) : null,
        currency:         d.currency,
        notes:            d.notes ?? null,
        quoteDate:        d.quoteDate ? new Date(d.quoteDate) : existing.quoteDate,
        updatedAt:        new Date(),
      }).where(eq(quotes.id, id))

      await tx.delete(quoteItems).where(eq(quoteItems.quoteId, id))
      await tx.insert(quoteItems).values(d.items.map(item => {
        const product = productBySku.get(item.sku)
        const lt = item.lineTotal != null
          ? String(item.lineTotal)
          : (item.unitPrice != null ? String(item.unitPrice * item.quantity) : null)
        return {
          quoteId:   id,
          productId: product?.id ?? null,
          sku:       item.sku,
          name:      item.name,
          quantity:  item.quantity,
          unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
          lineTotal: lt,
        }
      }))
    })

    return loadQuoteDetail(id)
  })

  fastify.post<{ Params: { id: string } }>('/api/quotes/:id/cancel', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const [existing] = await db.select().from(quotes).where(eq(quotes.id, id)).limit(1)
    if (!existing) return reply.status(404).send({ error: 'Quote not found' })
    if (existing.status !== 'open') {
      return reply.status(400).send({ error: 'Only open quotes can be cancelled', code: 'QUOTE_NOT_OPEN' })
    }
    await db.update(quotes).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(quotes.id, id))
    return loadQuoteDetail(id)
  })

  // Convert an open quote into a direct sale — same stock rules as POST /api/sales
  fastify.post<{ Params: { id: string } }>('/api/quotes/:id/convert', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const postUser = request.user as { role: string; warehouseIds: string[]; id?: string }

    const quote = await loadQuoteDetail(id)
    if (!quote) return reply.status(404).send({ error: 'Quote not found' })
    if (quote.status !== 'open') {
      return reply.status(400).send({ error: 'Only open quotes can be converted', code: 'QUOTE_NOT_OPEN' })
    }
    if (postUser.role === 'warehouse_admin' && !postUser.warehouseIds.includes(quote.warehouseId)) {
      return reply.status(403).send({ error: 'Access to this warehouse is not allowed', code: 'FORBIDDEN' })
    }
    if (quote.items.length === 0) {
      return reply.status(400).send({ error: 'Quote has no items', code: 'EMPTY_QUOTE' })
    }

    const skus = [...new Set(quote.items.map(i => i.sku))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.sku, skus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    const productIds = foundProducts.map(p => p.id)
    const stockRows = productIds.length > 0
      ? await db.select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(and(
            inArray(inventoryStock.productId, productIds),
            eq(inventoryStock.warehouseId, quote.warehouseId),
          ))
      : []
    const stockByProductId = new Map(stockRows.map(s => [s.productId, s.quantity]))

    const insufficientItems: { sku: string; requested: number; available: number }[] = []
    for (const item of quote.items) {
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

    const userId = await resolveCreatedBy(postUser.id)
    const convertNote = `Converted from quote #${quote.quoteNumber}`
    const saleNotes = [quote.notes?.trim(), convertNote].filter(Boolean).join('\n')

    const sale = await db.transaction(async (tx) => {
      const [row] = await tx.insert(sales).values({
        saleType:         'direct',
        status:           'completed',
        warehouseId:      quote.warehouseId,
        customerName:     quote.customerName,
        customerEmail:    quote.customerEmail,
        customerPhone:    quote.customerPhone,
        customerAddress:  quote.customerAddress,
        customerIdNumber: quote.customerIdNumber,
        totalPrice:       quote.totalPrice,
        currency:         quote.currency,
        notes:            saleNotes || null,
        saleDate:         new Date(),
        createdBy:        userId,
      }).returning()

      const itemsToInsert: typeof saleItems.$inferInsert[] = []
      for (const item of quote.items) {
        const product = productBySku.get(item.sku)
        itemsToInsert.push({
          saleId:    row.id,
          productId: product?.id ?? item.productId,
          sku:       item.sku,
          name:      item.name,
          quantity:  item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
        })

        if (product) {
          await tx.update(inventoryStock)
            .set({
              quantity:  sql`${inventoryStock.quantity} - ${item.quantity}`,
              updatedAt: sql`now()`,
            })
            .where(and(
              eq(inventoryStock.productId, product.id),
              eq(inventoryStock.warehouseId, quote.warehouseId),
            ))

          await tx.insert(inventoryLedger).values({
            productId:     product.id,
            warehouseId:   quote.warehouseId,
            actionType:    'sale',
            quantityDelta: -item.quantity,
            referenceId:   row.id,
            referenceType: 'sale',
            notes:         `Converted from quote #${quote.quoteNumber}${quote.customerName ? ` — ${quote.customerName}` : ''}`,
            createdBy:     userId,
          })
        }
      }

      await tx.insert(saleItems).values(itemsToInsert)
      await tx.update(quotes).set({
        status:          'converted',
        convertedSaleId: row.id,
        updatedAt:       new Date(),
      }).where(eq(quotes.id, id))

      return row
    })

    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, quote.warehouseId))
    if (wh?.type === 'main') {
      for (const item of quote.items) {
        const product = productBySku.get(item.sku)
        if (product) {
          try {
            await enqueueSyncWooStock(product.id)
          } catch (err) {
            request.log?.warn?.({ err, productId: product.id }, 'Failed to enqueue sync-woo-stock')
          }
        }
      }
    }

    await upsertCustomerFromSale({
      customerName:     quote.customerName,
      customerEmail:    quote.customerEmail,
      customerPhone:    quote.customerPhone,
      customerAddress:  quote.customerAddress,
      customerIdNumber: quote.customerIdNumber,
    }, { allowCreate: true })

    return {
      saleId: sale.id,
      quote:  await loadQuoteDetail(id),
    }
  })
}
