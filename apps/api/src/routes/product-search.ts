import type { FastifyPluginAsync } from 'fastify'
import { eq, and, ilike, or, gt, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import {
  products,
  brands,
  categories,
  productAttributes,
  attributeDefinitions,
  attributeOptions,
  inventoryStock,
} from '@ob-inventory/db'

export const productSearchRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── Product search (used by the transfer modal) ────────────────────────────
  //
  // GET /api/products/search?q=text&warehouseId=UUID&limit=20
  //
  // Returns products that have stock in the given warehouse, filtered by a
  // free-text query matched against SKU, name, brand and category.
  fastify.get('/api/products/search', auth, async (request) => {
    const qSchema = z.object({
      q:           z.string().default(''),
      warehouseId: z.string().uuid(),
      limit:       z.coerce.number().int().min(1).max(50).default(20),
    })
    const { q, warehouseId, limit } = qSchema.parse((request as { query: unknown }).query)

    const term = q.trim()
    const textFilter = term
      ? or(
          ilike(products.sku,      `%${term}%`),
          ilike(products.name,     `%${term}%`),
          ilike(brands.name,       `%${term}%`),
          ilike(categories.name,   `%${term}%`),
        )
      : undefined

    const rows = await db
      .select({
        productId:    products.id,
        sku:          products.sku,
        name:         products.name,
        brandName:    brands.name,
        categoryName: categories.name,
        availableQty: inventoryStock.quantity,
      })
      .from(inventoryStock)
      .innerJoin(products,    eq(inventoryStock.productId,   products.id))
      .leftJoin(brands,       eq(products.brandId,           brands.id))
      .leftJoin(categories,   eq(products.categoryId,        categories.id))
      .where(and(
        eq(inventoryStock.warehouseId, warehouseId),
        gt(inventoryStock.quantity, 0),
        textFilter,
      ))
      .orderBy(products.sku)
      .limit(limit)

    if (rows.length === 0) return rows

    // Fetch key attributes (model / size / color) for display context
    const productIds = rows.map(r => r.productId)
    const attrs = await db
      .select({
        productId: productAttributes.productId,
        defName:   attributeDefinitions.name,
        valueText: productAttributes.valueText,
        optLabel:  attributeOptions.label,
      })
      .from(productAttributes)
      .innerJoin(attributeDefinitions, eq(productAttributes.definitionId, attributeDefinitions.id))
      .leftJoin(attributeOptions,      eq(productAttributes.optionId,     attributeOptions.id))
      .where(and(
        inArray(productAttributes.productId, productIds),
        inArray(attributeDefinitions.name, ['Model', 'Size', 'Color']),
      ))

    const attrMap = new Map<string, Record<string, string>>()
    for (const a of attrs) {
      if (!attrMap.has(a.productId)) attrMap.set(a.productId, {})
      attrMap.get(a.productId)![a.defName.toLowerCase()] = a.optLabel ?? a.valueText ?? ''
    }

    return rows.map(r => ({
      ...r,
      model: attrMap.get(r.productId)?.model ?? null,
      size:  attrMap.get(r.productId)?.size  ?? null,
      color: attrMap.get(r.productId)?.color ?? null,
    }))
  })
}
