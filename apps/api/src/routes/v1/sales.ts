import type { FastifyPluginAsync } from 'fastify'
import { eq, and, gte, lte, exists, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../../db.js'
import {
  sales, saleItems, warehouses, stores, saleTargets, saleInvoiceStatuses,
  salePaymentMethods, salePaymentMethodLinks, cardcomDocuments,
} from '@ob-inventory/db'
import { isValidUuid } from './_util.js'

const saleListColumns = {
  id:               sales.id,
  saleType:         sales.saleType,
  status:           sales.status,
  warehouseId:      sales.warehouseId,
  warehouseName:    warehouses.name,
  storeId:          sales.storeId,
  storeName:        stores.name,
  wooOrderId:       sales.wooOrderId,
  customerName:     sales.customerName,
  customerEmail:    sales.customerEmail,
  customerPhone:    sales.customerPhone,
  customerAddress:  sales.customerAddress,
  customerIdNumber: sales.customerIdNumber,
  totalPrice:       sales.totalPrice,
  currency:         sales.currency,
  notes:            sales.notes,
  targetId:         sales.targetId,
  targetName:       saleTargets.name,
  invoiceStatusId:  sales.invoiceStatusId,
  invoiceStatusName: saleInvoiceStatuses.name,
  saleDate:         sales.saleDate,
  createdAt:        sales.createdAt,
  updatedAt:        sales.updatedAt,
}

export const salesV1Routes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/api/v1/sales', async (request, reply) => {
    const qSchema = z.object({
      saleType:     z.enum(['direct', 'partner', 'woocommerce', 'merged']).optional(),
      status:       z.enum(['completed', 'cancelled', 'refunded', 'superseded']).optional(),
      warehouseId:  z.string().uuid().optional(),
      storeId:      z.string().uuid().optional(),
      productId:    z.string().uuid().optional(),
      sku:          z.string().optional(),
      dateFrom:     z.string().optional(),
      dateTo:       z.string().optional(),
      updatedSince: z.string().datetime().optional(),
      limit:        z.coerce.number().int().min(1).max(1000).default(100),
      offset:       z.coerce.number().int().min(0).default(0),
    })
    const q = qSchema.safeParse((request as { query: unknown }).query)
    if (!q.success) return reply.status(400).send({ error: 'Invalid query', code: 'VALIDATION_ERROR', details: q.error.flatten() })
    const f = q.data

    const filters: ReturnType<typeof eq>[] = []
    if (f.saleType)     filters.push(eq(sales.saleType, f.saleType))
    if (f.status)       filters.push(eq(sales.status, f.status))
    if (f.warehouseId)  filters.push(eq(sales.warehouseId, f.warehouseId))
    if (f.storeId)       filters.push(eq(sales.storeId, f.storeId))
    if (f.dateFrom)      filters.push(gte(sales.saleDate, new Date(f.dateFrom)) as ReturnType<typeof eq>)
    if (f.dateTo)        filters.push(lte(sales.saleDate, new Date(f.dateTo)) as ReturnType<typeof eq>)
    if (f.updatedSince)  filters.push(gte(sales.updatedAt, new Date(f.updatedSince)) as ReturnType<typeof eq>)
    if (f.productId || f.sku) {
      const itemConds = [eq(saleItems.saleId, sales.id)]
      if (f.productId) itemConds.push(eq(saleItems.productId, f.productId))
      if (f.sku)        itemConds.push(eq(saleItems.sku, f.sku))
      filters.push(exists(db.select({ one: sql`1` }).from(saleItems).where(and(...itemConds))) as ReturnType<typeof eq>)
    }
    const where = filters.length > 0 ? and(...filters) : undefined

    const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(sales).where(where)

    const rows = await db
      .select(saleListColumns)
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleTargets, eq(sales.targetId, saleTargets.id))
      .leftJoin(saleInvoiceStatuses, eq(sales.invoiceStatusId, saleInvoiceStatuses.id))
      .where(where)
      .orderBy(sql`${sales.saleDate} desc`)
      .limit(f.limit)
      .offset(f.offset)

    return { data: rows, pagination: { limit: f.limit, offset: f.offset, total: Number(total) } }
  })

  fastify.get<{ Params: { id: string } }>('/api/v1/sales/:id', async (request, reply) => {
    if (!isValidUuid(request.params.id)) return reply.status(400).send({ error: 'Invalid id', code: 'VALIDATION_ERROR' })

    const [sale] = await db
      .select(saleListColumns)
      .from(sales)
      .leftJoin(warehouses, eq(sales.warehouseId, warehouses.id))
      .leftJoin(stores, eq(sales.storeId, stores.id))
      .leftJoin(saleTargets, eq(sales.targetId, saleTargets.id))
      .leftJoin(saleInvoiceStatuses, eq(sales.invoiceStatusId, saleInvoiceStatuses.id))
      .where(eq(sales.id, request.params.id))
    if (!sale) return reply.status(404).send({ error: 'Sale not found', code: 'NOT_FOUND' })

    const [items, paymentMethodRows, documents] = await Promise.all([
      db.select().from(saleItems).where(eq(saleItems.saleId, sale.id)).orderBy(saleItems.sku),
      db.select({ id: salePaymentMethods.id, name: salePaymentMethods.name })
        .from(salePaymentMethodLinks)
        .leftJoin(salePaymentMethods, eq(salePaymentMethodLinks.paymentMethodId, salePaymentMethods.id))
        .where(eq(salePaymentMethodLinks.saleId, sale.id)),
      db.select().from(cardcomDocuments).where(eq(cardcomDocuments.saleId, sale.id)),
    ])

    return {
      data: {
        ...sale,
        paymentMethods: paymentMethodRows.filter((r): r is { id: string; name: string } => r.id != null && r.name != null),
        items,
        cardcomDocuments: documents,
      },
    }
  })
}
