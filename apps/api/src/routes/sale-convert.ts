import type { FastifyPluginAsync } from 'fastify'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { enqueueSyncWooStock } from '../queue.js'
import { cancelWooOrder } from '../services/woo-orders.js'
import {
  sales,
  saleItems,
  warehouses,
  transfers,
  transferItems,
  inventoryStock,
  inventoryLedger,
  stores,
} from '@ob-inventory/db'

export const saleConvertRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Convert a sale into a stock transfer ───────────────────────────────────
  // Removes the sale, creates a transfer to the chosen destination warehouse
  // (net stock effect on the source warehouse is zero — the sale already
  // deducted it), and — if the sale came from WooCommerce — best-effort
  // cancels the corresponding Woo order so it isn't re-imported.
  fastify.post<{ Params: { id: string } }>('/api/sales/:id/convert-to-transfer', auth, async (request, reply) => {
    const paramsSchema = z.object({ id: z.string().uuid() })
    const parsedParams = paramsSchema.safeParse(request.params)
    if (!parsedParams.success) {
      return reply.status(400).send({ error: 'Invalid sale id', code: 'VALIDATION_ERROR' })
    }
    const { id } = parsedParams.data

    const bodySchema = z.object({
      toWarehouseId: z.string().uuid(),
      reference:     z.string().optional(),
      notes:         z.string().optional(),
    })
    const parsed = bodySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: parsed.error.flatten() })
    }
    const d = parsed.data
    const userId = (request.user as { id?: string })?.id ?? null
    const scopedUser = request.user as { role: string; warehouseIds: string[] }

    const [sale] = await db.select().from(sales).where(eq(sales.id, id))
    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    if (sale.status !== 'completed') {
      return reply.status(409).send({ error: `Sale cannot be converted (status: ${sale.status})`, code: 'INVALID_STATUS' })
    }

    if (d.toWarehouseId === sale.warehouseId) {
      return reply.status(400).send({ error: 'Source and destination warehouses must be different', code: 'SAME_WAREHOUSE' })
    }

    // Warehouse admins can only convert sales they can already see, into warehouses they can access
    if (scopedUser.role === 'warehouse_admin') {
      const allowed = scopedUser.warehouseIds
      if (!allowed.includes(sale.warehouseId) || !allowed.includes(d.toWarehouseId)) {
        return reply.status(403).send({ error: 'Access to one or both warehouses is not allowed', code: 'FORBIDDEN' })
      }
    }

    const [fromWh, toWh] = await Promise.all([
      db.select().from(warehouses).where(eq(warehouses.id, sale.warehouseId)).then(r => r[0]),
      db.select().from(warehouses).where(eq(warehouses.id, d.toWarehouseId)).then(r => r[0]),
    ])
    if (!fromWh) return reply.status(404).send({ error: 'Sale warehouse not found' })
    if (!toWh)   return reply.status(404).send({ error: 'Destination warehouse not found' })

    const items = await db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, id))

    if (items.length === 0) {
      return reply.status(400).send({ error: 'Sale has no items', code: 'EMPTY_SALE' })
    }

    const unresolved = items.filter(i => !i.productId).map(i => i.sku)
    if (unresolved.length > 0) {
      return reply.status(422).send({
        error: 'Cannot convert — sale has unresolved items (no matching product in inventory)',
        code: 'UNRESOLVED_ITEMS',
        unresolvedSkus: unresolved,
      })
    }

    const result = await db.transaction(async (tx) => {
      const [transfer] = await tx.insert(transfers).values({
        fromWarehouseId:      sale.warehouseId,
        toWarehouseId:        d.toWarehouseId,
        status:               'completed',
        reference:            d.reference ?? `Converted from sale ${sale.id}`,
        notes:                d.notes ?? null,
        convertedFromSaleId:  sale.id,
        createdBy:            userId,
      }).returning()

      for (const item of items) {
        const productId = item.productId!

        await tx.insert(transferItems).values({
          transferId: transfer.id,
          productId,
          sku:        item.sku,
          name:       item.name,
          quantity:   item.quantity,
        })

        // Step 1 — reverse the sale's original deduction on the source warehouse
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`${inventoryStock.quantity} + ${item.quantity}`, updatedAt: sql`now()` })
          .where(and(eq(inventoryStock.productId, productId), eq(inventoryStock.warehouseId, sale.warehouseId)))

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   sale.warehouseId,
          actionType:    'return',
          quantityDelta: item.quantity,
          referenceId:   sale.id,
          referenceType: 'sale',
          notes:         'Sale converted to stock transfer — stock reclassified',
          createdBy:     userId,
        })

        // Step 2 — transfer out of the source warehouse (net zero vs. step 1)
        await tx
          .update(inventoryStock)
          .set({ quantity: sql`${inventoryStock.quantity} - ${item.quantity}`, updatedAt: sql`now()` })
          .where(and(eq(inventoryStock.productId, productId), eq(inventoryStock.warehouseId, sale.warehouseId)))

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   sale.warehouseId,
          actionType:    'transfer_out',
          quantityDelta: -item.quantity,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `Transfer to ${toWh.name} (converted sale)`,
          createdBy:     userId,
        })

        // Step 3 — transfer into the destination warehouse
        await tx
          .insert(inventoryStock)
          .values({ productId, warehouseId: d.toWarehouseId, quantity: item.quantity, dateAdded: sql`CURRENT_DATE` })
          .onConflictDoUpdate({
            target: [inventoryStock.productId, inventoryStock.warehouseId],
            set: {
              quantity:  sql`${inventoryStock.quantity} + ${item.quantity}`,
              updatedAt: sql`now()`,
            },
          })

        await tx.insert(inventoryLedger).values({
          productId,
          warehouseId:   d.toWarehouseId,
          actionType:    'transfer_in',
          quantityDelta: item.quantity,
          referenceId:   transfer.id,
          referenceType: 'transfer',
          notes:         `Transfer from ${fromWh.name} (converted sale)`,
          createdBy:     userId,
        })
      }

      // Delete the sale — cascades sale_items, sale_payment_method_links, cardcom_documents
      await tx.delete(sales).where(eq(sales.id, id))

      return transfer
    })

    // ── Best-effort follow-up: sync-woo-stock for affected products ───────────
    const [mainWh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.type, 'main'))
    if (mainWh && (sale.warehouseId === mainWh.id || d.toWarehouseId === mainWh.id)) {
      for (const item of items) {
        try {
          await enqueueSyncWooStock(item.productId!)
        } catch (err) {
          request.log.warn({ err, productId: item.productId }, 'Failed to enqueue sync-woo-stock after sale conversion')
        }
      }
    }

    // ── Best-effort follow-up: cancel the WooCommerce order ────────────────────
    let wooOrderCancelled: boolean | null = null
    let wooCancelWarning: string | undefined

    if (sale.wooOrderId) {
      wooOrderCancelled = false
      if (sale.storeId) {
        const [store] = await db.select().from(stores).where(eq(stores.id, sale.storeId))
        if (store?.url?.trim() && store.secretToken?.trim()) {
          try {
            const res = await cancelWooOrder(
              { id: store.id, url: store.url, secretToken: store.secretToken },
              sale.wooOrderId,
              'Converted to stock transfer in OB Inventory',
            )
            wooOrderCancelled = res.ok
            if (!res.ok) wooCancelWarning = `Woo order #${sale.wooOrderId} could not be cancelled: ${res.error}`
          } catch (err) {
            wooCancelWarning = `Woo order #${sale.wooOrderId} could not be cancelled: ${err instanceof Error ? err.message : String(err)}`
          }
        } else {
          wooCancelWarning = `Woo order #${sale.wooOrderId} could not be cancelled: store is not configured with a URL/secret token`
        }
      } else {
        wooCancelWarning = `Woo order #${sale.wooOrderId} could not be cancelled: no store linked to this sale`
      }
    }

    return reply.status(200).send({
      transferId:        result.id,
      saleDeleted:        true,
      wooOrderCancelled,
      wooCancelWarning,
    })
  })
}
