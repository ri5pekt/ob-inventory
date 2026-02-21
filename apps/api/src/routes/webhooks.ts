import type { FastifyPluginAsync } from 'fastify'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import {
  stores,
  warehouses,
  products,
  inventoryStock,
  inventoryLedger,
  sales,
  saleItems,
} from '@ob-inventory/db'

// ── Payload schema from the WooCommerce plugin ────────────────────────────────

const wooOrderSchema = z.object({
  woo_order_id: z.number().int().positive(),
  status:       z.string(),
  customer: z.object({
    name:  z.string().optional().default(''),
    email: z.string().optional().default(''),
    phone: z.string().optional().default(''),
  }).optional().default({}),
  total:    z.union([z.number(), z.string()]).transform(v => String(v)),
  currency: z.string().optional().default('ILS'),
  items: z.array(z.object({
    woo_product_id:   z.number().optional(),
    woo_variation_id: z.number().nullable().optional(),
    sku:        z.string(),
    name:       z.string(),
    quantity:   z.number().int().positive(),
    price_each: z.union([z.number(), z.string()]).nullable().optional().transform(v => v != null ? String(v) : null),
    line_total: z.union([z.number(), z.string()]).nullable().optional().transform(v => v != null ? String(v) : null),
  })),
})

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/webhooks/woo/order
   *
   * Called by the WooCommerce plugin when an order moves to "processing" status.
   * Auth: Bearer token matched against stores.secret_token.
   *
   * Creates a sale record, reduces inventory from the main warehouse (best-effort
   * per SKU — items not found in OB Inventory are recorded but not deducted).
   */
  fastify.post('/api/webhooks/woo/order', async (request, reply) => {
    // ── Authenticate via Bearer token ─────────────────────────────────────────
    const authHeader = request.headers.authorization
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing Authorization header' })
    }
    const token = authHeader.slice(7)

    const [store] = await db.select().from(stores).where(eq(stores.secretToken, token))
    if (!store) {
      return reply.status(403).send({ error: 'Invalid token' })
    }

    // ── Validate payload ──────────────────────────────────────────────────────
    const parsed = wooOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid payload',
        code: 'VALIDATION_ERROR',
        details: parsed.error.flatten(),
      })
    }
    const order = parsed.data

    // ── Idempotency — skip already-processed orders ───────────────────────────
    const wooOrderIdStr = String(order.woo_order_id)
    const [existing] = await db.select({ id: sales.id }).from(sales).where(
      and(eq(sales.wooOrderId, wooOrderIdStr), eq(sales.storeId, store.id)),
    )
    if (existing) {
      return reply.status(200).send({ message: 'Order already processed', saleId: existing.id })
    }

    // ── Find main warehouse ───────────────────────────────────────────────────
    const [mainWarehouse] = await db.select().from(warehouses).where(eq(warehouses.type, 'main'))
    if (!mainWarehouse) {
      return reply.status(500).send({ error: 'No main warehouse configured' })
    }

    // ── Resolve products by SKU (bulk) ────────────────────────────────────────
    const skus = [...new Set(order.items.map(i => i.sku).filter(Boolean))]
    const foundProducts = skus.length > 0
      ? await db.select({ id: products.id, sku: products.sku, name: products.name })
          .from(products)
          .where(sql`${products.sku} = ANY(ARRAY[${sql.join(skus.map(s => sql`${s}`), sql`, `)}])`)
      : []

    const productBySku = new Map(foundProducts.map(p => [p.sku, p]))

    // ── Pre-check stock for items that exist in OB Inventory ─────────────────
    const stockChecks = foundProducts.length > 0
      ? await db.select({ productId: inventoryStock.productId, quantity: inventoryStock.quantity })
          .from(inventoryStock)
          .where(
            and(
              sql`${inventoryStock.productId} = ANY(ARRAY[${sql.join(foundProducts.map(p => sql`${p.id}::uuid`), sql`, `)}])`,
              eq(inventoryStock.warehouseId, mainWarehouse.id),
            ),
          )
      : []

    const stockByProductId = new Map(stockChecks.map(s => [s.productId, s.quantity]))

    // ── Execute everything in a transaction ───────────────────────────────────
    const result = await db.transaction(async (tx) => {
      // Create sale record
      const [sale] = await tx.insert(sales).values({
        saleType: 'woocommerce',
        status: 'completed',
        warehouseId: mainWarehouse.id,
        storeId: store.id,
        wooOrderId: wooOrderIdStr,
        customerName: order.customer.name || null,
        customerEmail: order.customer.email || null,
        totalPrice: order.total,
        currency: order.currency,
      }).returning()

      // Create sale items + reduce inventory
      const itemsToInsert: typeof saleItems.$inferInsert[] = []
      const unresolved: string[] = []

      for (const item of order.items) {
        if (!item.sku) continue
        const product = productBySku.get(item.sku)

        itemsToInsert.push({
          saleId:    sale.id,
          productId: product?.id ?? null,
          sku:       item.sku,
          name:      item.name,
          quantity:  item.quantity,
          unitPrice: item.price_each ?? null,
          lineTotal: item.line_total ?? null,
        })

        if (product) {
          const currentQty = stockByProductId.get(product.id) ?? 0
          const newQty     = currentQty - item.quantity

          if (newQty < 0) {
            // Allow below-zero for WooCommerce orders (may have oversold), but log
            unresolved.push(`${item.sku} (would go to ${newQty})`)
          }

          // Reduce stock
          await tx.update(inventoryStock)
            .set({
              quantity:  sql`GREATEST(0, ${inventoryStock.quantity} - ${item.quantity})`,
              updatedAt: sql`now()`,
            })
            .where(and(
              eq(inventoryStock.productId, product.id),
              eq(inventoryStock.warehouseId, mainWarehouse.id),
            ))

          // Ledger entry
          await tx.insert(inventoryLedger).values({
            productId:      product.id,
            warehouseId:    mainWarehouse.id,
            actionType:     'sale',
            quantityDelta:  -item.quantity,
            referenceId:    sale.id,
            referenceType:  'sale',
            notes: `WooCommerce order #${order.woo_order_id}`,
          })
        } else {
          unresolved.push(item.sku)
        }
      }

      if (itemsToInsert.length > 0) {
        await tx.insert(saleItems).values(itemsToInsert)
      }

      return { sale, unresolvedSkus: unresolved }
    })

    return reply.status(201).send({
      saleId:        result.sale.id,
      itemsCreated:  order.items.length,
      unresolvedSkus: result.unresolvedSkus,
    })
  })
}
