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
  salePaymentMethodLinks,
  users,
  customers,
} from '@ob-inventory/db'

// ── Shared helper: upsert customer from sale data ─────────────────────────────
// If a customer with this email already exists, only backfills a blank ID
// number (never overwrites existing data). If no customer exists, creates one
// — unless `allowCreate` is false (e.g. the "save as new customer" checkbox
// was left unchecked and this customer wasn't picked from the lookup either).
export async function upsertCustomerFromSale(
  data: {
    customerName?:     string | null
    customerEmail?:    string | null
    customerPhone?:    string | null
    customerAddress?:  string | null
    customerIdNumber?: string | null
  },
  opts: { allowCreate?: boolean } = {},
) {
  if (!data.customerEmail) return
  const email    = data.customerEmail.toLowerCase().trim()
  const idNumber = data.customerIdNumber?.trim() || null

  const [existing] = await db
    .select({ id: customers.id, idNumber: customers.idNumber })
    .from(customers)
    .where(eq(sql`lower(${customers.email})`, email))

  if (existing) {
    if (idNumber && !existing.idNumber) {
      await db.update(customers).set({ idNumber }).where(eq(customers.id, existing.id))
    }
    return
  }

  if (opts.allowCreate === false) return

  await db.insert(customers).values({
    name:     data.customerName || data.customerEmail,
    email:    data.customerEmail.trim(),
    phone:    data.customerPhone   ?? null,
    address:  data.customerAddress ?? null,
    idNumber,
  })
}

/** Resolve createdBy only if the JWT user still exists (avoids FK errors after a DB re-import). */
async function resolveCreatedBy(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId))
  return row?.id ?? null
}

export const salesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List sales ─────────────────────────────────────────────────────────────
  fastify.get('/api/sales', auth, async (request) => {
    const qSchema = z.object({
      type:     z.enum(['direct', 'partner', 'woocommerce', 'merged']).optional(),
      dateFrom: z.string().optional(),
      dateTo:   z.string().optional(),
      limit:    z.coerce.number().int().min(1).max(1000).default(100),
      offset:   z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.parse((request as { query: unknown }).query)

    const user = request.user as { role: string; warehouseIds: string[] }
    const filters: ReturnType<typeof eq>[] = []
    if (q.type)     filters.push(eq(sales.saleType, q.type))
    if (q.dateFrom) filters.push(gte(sales.saleDate, new Date(q.dateFrom)) as ReturnType<typeof eq>)
    if (q.dateTo)   filters.push(lte(sales.saleDate, new Date(q.dateTo))   as ReturnType<typeof eq>)
    if (user.role === 'warehouse_admin') {
      if (user.warehouseIds.length === 0) return []
      filters.push(inArray(sales.warehouseId, user.warehouseIds) as ReturnType<typeof eq>)
    }

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
        customerIdNumber: sales.customerIdNumber,
        totalPrice:      sales.totalPrice,
        currency:        sales.currency,
        notes:           sales.notes,
        saleDate:        sales.saleDate,
        createdAt:       sales.createdAt,
        targetId:           sales.targetId,
        targetName:         saleTargets.name,
        invoiceStatusId:    sales.invoiceStatusId,
        invoiceStatusName:  saleInvoiceStatuses.name,
        createdByName:      users.name,
        itemCount:          sql<number>`coalesce(sum(${saleItems.quantity}), 0)`,
        costOfGoods:        sql<string>`coalesce(sum(${saleItems.quantity}::numeric * coalesce(${products.costPrice}, 0)), 0)`,
      })
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleItems, eq(sales.id, saleItems.saleId))
      .leftJoin(products, eq(saleItems.productId, products.id))
      .leftJoin(saleTargets, eq(sales.targetId, saleTargets.id))
      .leftJoin(saleInvoiceStatuses, eq(sales.invoiceStatusId, saleInvoiceStatuses.id))
      .leftJoin(users, eq(sales.createdBy, users.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .groupBy(sales.id, warehouses.name, stores.name, saleTargets.name, saleInvoiceStatuses.name, users.name)
      .orderBy(desc(sales.saleDate))
      .limit(q.limit)
      .offset(q.offset)

    const saleIds = rows.map(r => r.id)
    const paymentLinks = saleIds.length > 0
      ? await db
          .select({ saleId: salePaymentMethodLinks.saleId, id: salePaymentMethods.id, name: salePaymentMethods.name })
          .from(salePaymentMethodLinks)
          .leftJoin(salePaymentMethods, eq(salePaymentMethodLinks.paymentMethodId, salePaymentMethods.id))
          .where(inArray(salePaymentMethodLinks.saleId, saleIds))
      : []

    const paymentsBySaleId = new Map<string, { id: string; name: string }[]>()
    for (const link of paymentLinks) {
      if (!paymentsBySaleId.has(link.saleId)) paymentsBySaleId.set(link.saleId, [])
      if (link.id && link.name) paymentsBySaleId.get(link.saleId)!.push({ id: link.id, name: link.name })
    }

    return rows.map(r => ({ ...r, paymentMethods: paymentsBySaleId.get(r.id) ?? [] }))
  })

  // ── Merge preview ──────────────────────────────────────────────────────────
  // Loads selected sales in the given order, validates shared warehouse/currency,
  // and returns a prefilled form payload (header fields from the first sale,
  // items summed by SKU with carriedQty = sum of original quantities).
  fastify.get('/api/sales/merge-preview', auth, async (request, reply) => {
    const qSchema = z.object({
      ids: z.string().min(1),
    })
    const q = qSchema.parse((request as { query: unknown }).query)
    const ids = [...new Set(q.ids.split(',').map(s => s.trim()).filter(Boolean))]
    if (ids.length < 2) {
      return reply.status(400).send({ error: 'Select at least 2 sales to merge', code: 'VALIDATION_ERROR' })
    }

    const rows = await db
      .select({
        id:               sales.id,
        saleType:         sales.saleType,
        status:           sales.status,
        warehouseId:      sales.warehouseId,
        wooOrderId:       sales.wooOrderId,
        customerName:     sales.customerName,
        customerEmail:    sales.customerEmail,
        customerPhone:    sales.customerPhone,
        customerAddress:  sales.customerAddress,
        customerIdNumber: sales.customerIdNumber,
        totalPrice:       sales.totalPrice,
        currency:         sales.currency,
        notes:            sales.notes,
        saleDate:         sales.saleDate,
        targetId:         sales.targetId,
        invoiceStatusId:  sales.invoiceStatusId,
      })
      .from(sales)
      .where(inArray(sales.id, ids))

    if (rows.length !== ids.length) {
      return reply.status(404).send({ error: 'One or more sales were not found', code: 'NOT_FOUND' })
    }

    // Preserve selection order from the query string
    const byId = new Map(rows.map(r => [r.id, r]))
    const ordered = ids.map(id => byId.get(id)!)

    if (ordered.some(s => s.status === 'superseded')) {
      return reply.status(400).send({
        error: 'One or more selected sales were already merged into another sale',
        code: 'ALREADY_SUPERSEDED',
      })
    }

    const warehouseId = ordered[0].warehouseId
    const currency    = ordered[0].currency
    if (ordered.some(s => s.warehouseId !== warehouseId)) {
      return reply.status(400).send({
        error: 'All selected sales must be from the same warehouse',
        code: 'WAREHOUSE_MISMATCH',
      })
    }
    if (ordered.some(s => s.currency !== currency)) {
      return reply.status(400).send({
        error: 'All selected sales must share the same currency',
        code: 'CURRENCY_MISMATCH',
      })
    }

    const user = request.user as { role: string; warehouseIds: string[] }
    if (user.role === 'warehouse_admin' && !user.warehouseIds.includes(warehouseId)) {
      return reply.status(403).send({ error: 'Access to this warehouse is not allowed', code: 'FORBIDDEN' })
    }

    const allItems = await db
      .select({
        saleId:    saleItems.saleId,
        productId: saleItems.productId,
        sku:       saleItems.sku,
        name:      saleItems.name,
        quantity:  saleItems.quantity,
        unitPrice: saleItems.unitPrice,
      })
      .from(saleItems)
      .where(inArray(saleItems.saleId, ids))

    // Merge by SKU; keep name/unitPrice/productId from the earliest selected sale
    type MergedItem = {
      productId: string | null
      sku: string
      name: string
      quantity: number
      unitPrice: number | null
      firstIndex: number
    }
    const saleIndex = new Map(ids.map((id, i) => [id, i]))
    const mergedBySku = new Map<string, MergedItem>()
    for (const item of allItems) {
      const idx = saleIndex.get(item.saleId) ?? 999
      const existing = mergedBySku.get(item.sku)
      const unitPrice = item.unitPrice != null ? parseFloat(item.unitPrice) : null
      if (!existing) {
        mergedBySku.set(item.sku, {
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice,
          firstIndex: idx,
        })
      } else {
        existing.quantity += item.quantity
        if (idx < existing.firstIndex) {
          existing.productId = item.productId
          existing.name = item.name
          existing.unitPrice = unitPrice
          existing.firstIndex = idx
        } else if (existing.unitPrice == null && unitPrice != null) {
          existing.unitPrice = unitPrice
        }
        if (!existing.productId && item.productId) existing.productId = item.productId
      }
    }

    const mergedItems = [...mergedBySku.values()].sort((a, b) => a.sku.localeCompare(b.sku))

    // Current available stock for products that have a productId
    const productIds = mergedItems.map(i => i.productId).filter((id): id is string => !!id)
    const stockRows = productIds.length > 0
      ? await db
          .select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(and(
            inArray(inventoryStock.productId, productIds),
            eq(inventoryStock.warehouseId, warehouseId),
          ))
      : []
    const stockByProductId = new Map(stockRows.map(s => [s.productId, s.quantity]))

    // Payment methods from the first selected sale
    const firstId = ordered[0].id
    const paymentMethodRows = await db
      .select({ id: salePaymentMethods.id })
      .from(salePaymentMethodLinks)
      .leftJoin(salePaymentMethods, eq(salePaymentMethodLinks.paymentMethodId, salePaymentMethods.id))
      .where(eq(salePaymentMethodLinks.saleId, firstId))
    const paymentMethodIds = paymentMethodRows
      .map(r => r.id)
      .filter((id): id is string => !!id)

    const typeLabel = (t: string) =>
      t === 'woocommerce' ? 'WooCommerce'
        : t === 'partner' ? 'Partner'
          : t === 'merged' ? 'Merged'
            : 'Direct'

    const itemsBySaleId = new Map<string, typeof allItems>()
    for (const item of allItems) {
      if (!itemsBySaleId.has(item.saleId)) itemsBySaleId.set(item.saleId, [])
      itemsBySaleId.get(item.saleId)!.push(item)
    }

    const mergeBlocks = ordered.map(s => {
      const date = new Date(s.saleDate).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
      const headerParts = [
        `${typeLabel(s.saleType)} sale`,
        date,
        s.wooOrderId ? `order #${s.wooOrderId}` : null,
        s.totalPrice != null ? `${s.totalPrice} ${s.currency}` : null,
        s.customerName || null,
      ].filter(Boolean)

      const saleItemsList = (itemsBySaleId.get(s.id) ?? [])
        .slice()
        .sort((a, b) => a.sku.localeCompare(b.sku))
      const itemsLine = saleItemsList.length > 0
        ? saleItemsList.map(i => `${i.sku} ×${i.quantity}`).join(', ')
        : '(no items)'

      return `${headerParts.join(' · ')}\n${itemsLine}`
    })
    const mergeSummary = `Merged from ${ordered.length} sales:\n\n${mergeBlocks.join('\n--------------\n')}`

    const first = ordered[0]
    const existingNotes = first.notes?.trim() || ''
    const notes = existingNotes
      ? `${existingNotes}\n\n${mergeSummary}`
      : mergeSummary

    return {
      warehouseId,
      currency,
      customerName:     first.customerName,
      customerEmail:    first.customerEmail,
      customerPhone:    first.customerPhone,
      customerAddress:  first.customerAddress,
      customerIdNumber: first.customerIdNumber,
      targetId:         first.targetId,
      invoiceStatusId:  first.invoiceStatusId,
      paymentMethodIds,
      saleDate:         first.saleDate,
      notes,
      mergeSummary,
      items: mergedItems.map(i => ({
        productId:    i.productId,
        sku:          i.sku,
        name:         i.name,
        quantity:     i.quantity,
        carriedQty:   i.quantity,
        unitPrice:    i.unitPrice,
        availableQty: i.productId ? (stockByProductId.get(i.productId) ?? 0) : 0,
        model:        null as string | null,
        size:         null as string | null,
        color:        null as string | null,
      })),
    }
  })

  // ── Create merged sale ─────────────────────────────────────────────────────
  // Creates a sale of type "merged". Stock is adjusted only by the delta between
  // carried quantities (already deducted by the original sales) and the final
  // submitted quantities. Originals may be superseded: items cleared, status set,
  // records kept (preserves Woo order ids + Cardcom docs).
  fastify.post('/api/sales/merge', auth, async (request, reply) => {
    const bodySchema = z.object({
      saleIds:             z.array(z.string().uuid()).min(2),
      supersedeOriginals:  z.boolean().default(true),
      // Legacy alias from earlier UI wording
      deleteOriginals:     z.boolean().optional(),
      warehouseId:         z.string().uuid(),
      customerName:        z.string().optional(),
      customerEmail:       z.string().optional(),
      customerPhone:       z.string().optional(),
      customerAddress:     z.string().optional(),
      customerIdNumber:    z.string().optional(),
      currency:            z.string().default('ILS'),
      notes:               z.string().optional(),
      targetId:            z.string().uuid().optional(),
      invoiceStatusId:     z.string().uuid().optional(),
      paymentMethodIds:    z.array(z.string().uuid()).optional(),
      saleDate:            z.string().optional(),
      createCustomer:      z.boolean().default(true),
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
    const supersedeOriginals = d.supersedeOriginals ?? d.deleteOriginals ?? true
    const saleIds = [...new Set(d.saleIds)]
    const postUser = request.user as { role: string; warehouseIds: string[] }

    if (postUser.role === 'warehouse_admin' && !postUser.warehouseIds.includes(d.warehouseId)) {
      return reply.status(403).send({ error: 'Access to this warehouse is not allowed', code: 'FORBIDDEN' })
    }

    const originalSales = await db
      .select({
        id:          sales.id,
        warehouseId: sales.warehouseId,
        currency:    sales.currency,
        status:      sales.status,
        notes:       sales.notes,
      })
      .from(sales)
      .where(inArray(sales.id, saleIds))

    if (originalSales.length !== saleIds.length) {
      return reply.status(404).send({ error: 'One or more sales were not found', code: 'NOT_FOUND' })
    }
    if (originalSales.some(s => s.status === 'superseded')) {
      return reply.status(400).send({
        error: 'One or more selected sales were already merged into another sale',
        code: 'ALREADY_SUPERSEDED',
      })
    }
    if (originalSales.some(s => s.warehouseId !== d.warehouseId)) {
      return reply.status(400).send({
        error: 'All selected sales must be from the same warehouse',
        code: 'WAREHOUSE_MISMATCH',
      })
    }
    if (originalSales.some(s => s.currency !== d.currency)) {
      return reply.status(400).send({
        error: 'All selected sales must share the same currency',
        code: 'CURRENCY_MISMATCH',
      })
    }

    // Server-side carried quantities by productId (never trust the client)
    const originalItems = await db
      .select({
        productId: saleItems.productId,
        sku:       saleItems.sku,
        quantity:  saleItems.quantity,
      })
      .from(saleItems)
      .where(inArray(saleItems.saleId, saleIds))

    const carriedByProductId = new Map<string, number>()
    for (const item of originalItems) {
      if (item.productId) {
        carriedByProductId.set(item.productId, (carriedByProductId.get(item.productId) ?? 0) + item.quantity)
      }
    }

    // Resolve products by SKU
    const skus = [...new Set(d.items.map(i => i.sku))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku, name: products.name })
      .from(products)
      .where(inArray(products.sku, skus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    // Final quantities by productId
    const finalByProductId = new Map<string, number>()
    for (const item of d.items) {
      const product = productBySku.get(item.sku)
      if (!product) continue
      finalByProductId.set(product.id, (finalByProductId.get(product.id) ?? 0) + item.quantity)
    }

    // Deltas: positive = extra stock to deduct; negative = restore
    const allProductIds = new Set([...carriedByProductId.keys(), ...finalByProductId.keys()])
    const deltas = new Map<string, number>()
    for (const productId of allProductIds) {
      const carried = carriedByProductId.get(productId) ?? 0
      const final   = finalByProductId.get(productId) ?? 0
      const delta   = final - carried
      if (delta !== 0) deltas.set(productId, delta)
    }

    // Validate stock for positive deltas
    const deltaProductIds = [...deltas.keys()]
    const stockRows = deltaProductIds.length > 0
      ? await db
          .select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(and(
            inArray(inventoryStock.productId, deltaProductIds),
            eq(inventoryStock.warehouseId, d.warehouseId),
          ))
      : []
    const stockByProductId = new Map(stockRows.map(s => [s.productId, s.quantity]))

    const insufficientItems: { sku: string; requested: number; available: number }[] = []
    for (const [productId, delta] of deltas) {
      if (delta <= 0) continue
      const available = stockByProductId.get(productId) ?? 0
      if (delta > available) {
        const sku = foundProducts.find(p => p.id === productId)?.sku
          ?? [...productBySku.entries()].find(([, p]) => p.id === productId)?.[0]
          ?? productId
        insufficientItems.push({ sku, requested: delta, available })
      }
    }
    if (insufficientItems.length > 0) {
      return reply.status(422).send({
        error: 'Insufficient stock',
        code: 'INSUFFICIENT_STOCK',
        items: insufficientItems,
      })
    }

    const totalPrice = d.items.reduce((sum, item) => {
      const lt = item.lineTotal ?? (item.unitPrice != null ? item.unitPrice * item.quantity : null)
      return lt != null ? sum + lt : sum
    }, 0)

    const result = await db.transaction(async (tx) => {
      const userId = await resolveCreatedBy((request.user as { id?: string })?.id)

      const [sale] = await tx.insert(sales).values({
        saleType:         'merged',
        status:           'completed',
        warehouseId:      d.warehouseId,
        customerName:     d.customerName     ?? null,
        customerEmail:    d.customerEmail    ?? null,
        customerPhone:    d.customerPhone    ?? null,
        customerAddress:  d.customerAddress  ?? null,
        customerIdNumber: d.customerIdNumber ?? null,
        totalPrice:       totalPrice > 0 ? String(totalPrice) : null,
        currency:         d.currency,
        notes:            d.notes ?? null,
        targetId:         d.targetId        ?? null,
        invoiceStatusId:  d.invoiceStatusId ?? null,
        saleDate:         d.saleDate ? new Date(d.saleDate) : new Date(),
        createdBy:        userId,
      }).returning()

      if (d.paymentMethodIds?.length) {
        await tx.insert(salePaymentMethodLinks).values(
          d.paymentMethodIds.map(methodId => ({ saleId: sale.id, paymentMethodId: methodId })),
        )
      }

      const itemsToInsert: typeof saleItems.$inferInsert[] = []
      for (const item of d.items) {
        const product = productBySku.get(item.sku)
        const lt: string | null = item.lineTotal != null
          ? String(item.lineTotal)
          : (item.unitPrice != null ? String(item.unitPrice * item.quantity) : null)

        itemsToInsert.push({
          saleId:    sale.id,
          productId: product?.id ?? null,
          sku:       item.sku,
          name:      item.name,
          quantity:  item.quantity,
          unitPrice: item.unitPrice != null ? String(item.unitPrice) : null,
          lineTotal: lt,
        })
      }
      await tx.insert(saleItems).values(itemsToInsert)

      // Apply stock deltas only
      for (const [productId, delta] of deltas) {
        await tx
          .update(inventoryStock)
          .set({
            quantity:  sql`${inventoryStock.quantity} - ${delta}`,
            updatedAt: sql`now()`,
          })
          .where(and(
            eq(inventoryStock.productId, productId),
            eq(inventoryStock.warehouseId, d.warehouseId),
          ))

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   d.warehouseId,
          actionType:    delta > 0 ? 'sale' : 'return',
          quantityDelta: -delta,
          referenceId:   sale.id,
          referenceType: 'sale',
          notes:         `Merged sale — ${saleIds.length} originals${d.customerName ? ` — ${d.customerName}` : ''}`,
          createdBy:     userId,
        })
      }

      // Supersede originals: clear items, zero total, keep the sale row
      // (Woo order ids + Cardcom documents stay attached; no stock restore —
      // quantities already carried into the merged sale).
      if (supersedeOriginals) {
        await tx.delete(saleItems).where(inArray(saleItems.saleId, saleIds))

        const stamp = new Date().toLocaleString('en-GB', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
        const totalStr = totalPrice > 0 ? `${totalPrice.toFixed(2)} ${d.currency}` : null
        const mergeNote = [
          `Merged into sale on ${stamp}`,
          `Merged sale ID: ${sale.id}`,
          `${saleIds.length} sales combined`,
          totalStr ? `Merged total: ${totalStr}` : null,
          `${d.items.length} product line(s) moved to the merged sale`,
        ].filter(Boolean).join('\n')

        for (const orig of originalSales) {
          const prev = orig.notes?.trim()
          await tx.update(sales).set({
            status:     'superseded',
            totalPrice: null,
            notes:      prev ? `${prev}\n\n${mergeNote}` : mergeNote,
            updatedAt:  new Date(),
          }).where(eq(sales.id, orig.id))
        }
      }

      return sale
    })

    // Woo sync for products whose stock actually changed
    const [wh] = await db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, d.warehouseId))
    if (wh?.type === 'main') {
      for (const productId of deltas.keys()) {
        try {
          await enqueueSyncWooStock(productId)
        } catch (err) {
          (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.(
            { err, productId },
            'Failed to enqueue sync-woo-stock after merge',
          )
        }
      }
    }

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

    return reply.status(201).send(result)
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
        customerIdNumber: sales.customerIdNumber,
        totalPrice:      sales.totalPrice,
        currency:        sales.currency,
        notes:           sales.notes,
        saleDate:        sales.saleDate,
        createdAt:       sales.createdAt,
        updatedAt:       sales.updatedAt,
        targetId:          sales.targetId,
        targetName:        saleTargets.name,
        invoiceStatusId:   sales.invoiceStatusId,
        invoiceStatusName: saleInvoiceStatuses.name,
        createdByName:     users.name,
      })
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleTargets, eq(sales.targetId, saleTargets.id))
      .leftJoin(saleInvoiceStatuses, eq(sales.invoiceStatusId, saleInvoiceStatuses.id))
      .leftJoin(users, eq(sales.createdBy, users.id))
      .where(eq(sales.id, request.params.id))

    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    const paymentMethodRows = await db
      .select({ id: salePaymentMethods.id, name: salePaymentMethods.name })
      .from(salePaymentMethodLinks)
      .leftJoin(salePaymentMethods, eq(salePaymentMethodLinks.paymentMethodId, salePaymentMethods.id))
      .where(eq(salePaymentMethodLinks.saleId, sale.id))
    const paymentMethods = paymentMethodRows.filter((r): r is { id: string; name: string } => r.id != null && r.name != null)

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

    return { ...sale, paymentMethods, items }
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
      customerIdNumber: z.string().optional(),
      currency:        z.string().default('ILS'),
      notes:           z.string().optional(),
      targetId:          z.string().uuid().optional(),
      invoiceStatusId:   z.string().uuid().optional(),
      paymentMethodIds:  z.array(z.string().uuid()).optional(),
      saleDate:          z.string().optional(),
      createCustomer:    z.boolean().default(true),
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
    const postUser = request.user as { role: string; warehouseIds: string[] }

    // Resolve warehouse — if no warehouseId provided, fall back to main warehouse.
    // A provided warehouseId is used as-is for both direct and partner sales.
    let warehouseId = d.warehouseId
    if (!warehouseId) {
      const [main] = await db.select().from(warehouses).where(eq(warehouses.type, 'main'))
      if (!main) return reply.status(500).send({ error: 'No main warehouse configured' })
      warehouseId = main.id
    } else {
      const [wh] = await db.select().from(warehouses).where(eq(warehouses.id, warehouseId))
      if (!wh) return reply.status(404).send({ error: 'Warehouse not found' })
    }

    // Warehouse admins can only create sales in their assigned warehouses
    if (postUser.role === 'warehouse_admin' && !postUser.warehouseIds.includes(warehouseId)) {
      return reply.status(403).send({ error: 'Access to this warehouse is not allowed', code: 'FORBIDDEN' })
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
      const userId = (request.user as { id?: string })?.id ?? null

      const [sale] = await tx.insert(sales).values({
        saleType:      d.saleType,
        status:        'completed',
        warehouseId:   warehouseId!,
        customerName:    d.customerName    ?? null,
        customerEmail:   d.customerEmail   ?? null,
        customerPhone:   d.customerPhone   ?? null,
        customerAddress: d.customerAddress ?? null,
        customerIdNumber: d.customerIdNumber ?? null,
        totalPrice:    totalPrice > 0 ? String(totalPrice) : null,
        currency:      d.currency,
        notes:           d.notes            ?? null,
        targetId:        d.targetId         ?? null,
        invoiceStatusId: d.invoiceStatusId  ?? null,
        saleDate:        d.saleDate ? new Date(d.saleDate) : new Date(),
        createdBy:       userId,
      }).returning()

      if (d.paymentMethodIds?.length) {
        await tx.insert(salePaymentMethodLinks).values(
          d.paymentMethodIds.map(methodId => ({ saleId: sale.id, paymentMethodId: methodId })),
        )
      }

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
            notes:         `Manual sale — ${d.saleType}${d.customerName ? ` — ${d.customerName}` : ''}`,
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

    // Backfill/create the customer record — always fills a blank ID number on
    // an existing customer match; only creates a brand-new customer if the
    // "save as new customer" checkbox was checked (d.createCustomer).
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

    return reply.status(201).send(result)
  })

  // ── Edit sale ──────────────────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/sales/:id', auth, async (request, reply) => {
    const bodySchema = z.object({
      warehouseId:     z.string().uuid().optional(),
      customerName:    z.string().optional(),
      customerEmail:   z.string().optional(),
      customerPhone:   z.string().optional(),
      customerAddress: z.string().optional(),
      customerIdNumber: z.string().optional(),
      currency:        z.string().optional(),
      notes:           z.string().optional(),
      targetId:         z.string().uuid().nullable().optional(),
      invoiceStatusId:  z.string().uuid().nullable().optional(),
      paymentMethodIds: z.array(z.string().uuid()).nullable().optional(),
      saleDate:         z.string().optional(),
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
    if (sale.status === 'superseded') {
      return reply.status(400).send({
        error: 'This sale was merged into another sale and cannot be edited',
        code: 'SALE_SUPERSEDED',
      })
    }

    const userId = (request.user as { id?: string })?.id ?? null

    // Determine target warehouse (may differ from current)
    const targetWarehouseId   = d.warehouseId ?? sale.warehouseId
    const warehouseIsChanging = d.warehouseId != null && d.warehouseId !== sale.warehouseId

    if (warehouseIsChanging) {
      const [newWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, targetWarehouseId))
      if (!newWh) return reply.status(404).send({ error: 'Target warehouse not found' })
    }

    // Load current items
    const oldItems = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.id))

    // Resolve product IDs for new items by SKU
    const newSkus = [...new Set(d.items.map(i => i.sku))]
    const foundProducts = await db
      .select({ id: products.id, sku: products.sku })
      .from(products)
      .where(inArray(products.sku, newSkus))
    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    const totalPrice = d.items.reduce((sum, item) => {
      const lt = item.lineTotal ?? (item.unitPrice != null ? item.unitPrice * item.quantity : null)
      return lt != null ? sum + lt : sum
    }, 0)

    if (warehouseIsChanging) {
      // ── Warehouse migration path ─────────────────────────────────────────
      // Validate: new warehouse must have enough stock for ALL new items
      const newItemProductIds = d.items.map(i => productBySku.get(i.sku)?.id).filter((id): id is string => !!id)
      const newStockRows = newItemProductIds.length > 0
        ? await db
            .select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
            .from(inventoryStock)
            .where(and(inArray(inventoryStock.productId, newItemProductIds), eq(inventoryStock.warehouseId, targetWarehouseId)))
        : []
      const newStockByProductId = new Map(newStockRows.map(s => [s.productId, s.quantity]))

      const insufficientItems: { sku: string; requested: number; available: number }[] = []
      for (const item of d.items) {
        const product = productBySku.get(item.sku)
        if (product) {
          const available = newStockByProductId.get(product.id) ?? 0
          if (item.quantity > available) {
            insufficientItems.push({ sku: item.sku, requested: item.quantity, available })
          }
        }
      }
      if (insufficientItems.length > 0) {
        return reply.status(422).send({ error: 'Insufficient stock', code: 'INSUFFICIENT_STOCK', items: insufficientItems })
      }

      await db.transaction(async (tx) => {
        // 1. Restore all old items back to the old warehouse
        for (const old of oldItems) {
          if (!old.productId) continue
          await tx
            .update(inventoryStock)
            .set({ quantity: sql`${inventoryStock.quantity} + ${old.quantity}`, updatedAt: sql`now()` })
            .where(and(eq(inventoryStock.productId, old.productId), eq(inventoryStock.warehouseId, sale.warehouseId)))
          await tx.insert(inventoryLedger).values({
            productId:     old.productId,
            warehouseId:   sale.warehouseId,
            actionType:    'return',
            quantityDelta: old.quantity,
            referenceId:   sale.id,
            referenceType: 'sale',
            notes:         `Sale warehouse changed — stock restored to previous warehouse (${sale.saleType})${sale.customerName ? ` — ${sale.customerName}` : ''}`,
            createdBy:     userId,
          })
        }

        // 2. Deduct all new items from the new warehouse
        for (const item of d.items) {
          const product = productBySku.get(item.sku)
          if (!product) continue
          await tx
            .update(inventoryStock)
            .set({ quantity: sql`${inventoryStock.quantity} - ${item.quantity}`, updatedAt: sql`now()` })
            .where(and(eq(inventoryStock.productId, product.id), eq(inventoryStock.warehouseId, targetWarehouseId)))
          await tx.insert(inventoryLedger).values({
            productId:     product.id,
            warehouseId:   targetWarehouseId,
            actionType:    'sale',
            quantityDelta: -item.quantity,
            referenceId:   sale.id,
            referenceType: 'sale',
            notes:         `Sale warehouse changed — stock deducted from new warehouse (${sale.saleType})${sale.customerName ? ` — ${sale.customerName}` : ''}`,
            createdBy:     userId,
          })
        }

        // 3. Replace sale items
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

        // 4. Update sale metadata + new warehouseId
        await tx
          .update(sales)
          .set({
            warehouseId:     targetWarehouseId,
            customerName:    d.customerName    ?? null,
            customerEmail:   d.customerEmail   ?? null,
            customerPhone:   d.customerPhone   ?? null,
            customerAddress: d.customerAddress ?? null,
            customerIdNumber: d.customerIdNumber ?? null,
            currency:        d.currency        ?? sale.currency,
            notes:           d.notes           ?? null,
            totalPrice:      totalPrice > 0 ? String(totalPrice) : null,
            targetId:        d.targetId        !== undefined ? d.targetId        : sale.targetId,
            invoiceStatusId: d.invoiceStatusId !== undefined ? d.invoiceStatusId : sale.invoiceStatusId,
            saleDate:        d.saleDate ? new Date(d.saleDate) : sale.saleDate,
          })
          .where(eq(sales.id, sale.id))

        // 5. Replace payment method links if provided
        if (d.paymentMethodIds !== undefined) {
          await tx.delete(salePaymentMethodLinks).where(eq(salePaymentMethodLinks.saleId, sale.id))
          if (d.paymentMethodIds?.length) {
            await tx.insert(salePaymentMethodLinks).values(
              d.paymentMethodIds.map(methodId => ({ saleId: sale.id, paymentMethodId: methodId })),
            )
          }
        }
      })

      // Woo sync — trigger for affected products in both old and new warehouses if either is main
      const allAffectedIds = [
        ...new Set([
          ...oldItems.map(i => i.productId).filter(Boolean) as string[],
          ...d.items.map(i => productBySku.get(i.sku)?.id).filter((id): id is string => !!id),
        ]),
      ]
      const [oldWhInfo, newWhInfo] = await Promise.all([
        db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, sale.warehouseId)).then(r => r[0]),
        db.select({ type: warehouses.type }).from(warehouses).where(eq(warehouses.id, targetWarehouseId)).then(r => r[0]),
      ])
      if (oldWhInfo?.type === 'main' || newWhInfo?.type === 'main') {
        for (const productId of allAffectedIds) {
          try {
            await enqueueSyncWooStock(productId)
          } catch (err) {
            (request as { log?: { warn: (o: object, msg: string) => void } }).log?.warn?.({ err, productId }, 'Failed to enqueue sync-woo-stock after sale warehouse change')
          }
        }
      }
    } else {
      // ── Same warehouse path (existing delta logic) ───────────────────────
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
            notes:         `Sale edited — stock ${delta > 0 ? 'restored' : 'adjusted'} (${sale.saleType})${sale.customerName ? ` — ${sale.customerName}` : ''}`,
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
            customerIdNumber: d.customerIdNumber ?? null,
            currency:        d.currency        ?? sale.currency,
            notes:           d.notes           ?? null,
            totalPrice:      totalPrice > 0 ? String(totalPrice) : null,
            targetId:        d.targetId        !== undefined ? d.targetId        : sale.targetId,
            invoiceStatusId: d.invoiceStatusId !== undefined ? d.invoiceStatusId : sale.invoiceStatusId,
            saleDate:        d.saleDate ? new Date(d.saleDate) : sale.saleDate,
          })
          .where(eq(sales.id, sale.id))

        // Replace payment method links if provided
        if (d.paymentMethodIds !== undefined) {
          await tx.delete(salePaymentMethodLinks).where(eq(salePaymentMethodLinks.saleId, sale.id))
          if (d.paymentMethodIds?.length) {
            await tx.insert(salePaymentMethodLinks).values(
              d.paymentMethodIds.map(methodId => ({ saleId: sale.id, paymentMethodId: methodId })),
            )
          }
        }
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
    }

    return reply.status(200).send({ ok: true })
  })

  // ── Delete sale (restore stock + ledger) ───────────────────────────────────
  fastify.delete<{ Params: { id: string } }>('/api/sales/:id', auth, async (request, reply) => {
    const { id } = request.params
    const userId = (request.user as { id?: string })?.id ?? null

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
