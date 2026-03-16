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

  // ── Global catalog search (used by Add Product to Warehouse modal) ────────────
  //
  // GET /api/products/catalog-search?q=text&limit=20
  //
  // Returns products from the full catalog (no warehouse filter), with all IDs
  // needed to autofill the form: brandId, categoryId, sizeOptionId, etc.
  fastify.get('/api/products/catalog-search', auth, async (request) => {
    const qSchema = z.object({
      q:     z.string().default(''),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    const { q, limit } = qSchema.parse((request as { query: unknown }).query)

    const term = q.trim()
    const textFilter = term
      ? or(
          ilike(products.sku,    `%${term}%`),
          ilike(products.name,   `%${term}%`),
          ilike(brands.name,     `%${term}%`),
          ilike(categories.name, `%${term}%`),
        )
      : undefined

    const rows = await db
      .select({
        productId:    products.id,
        sku:          products.sku,
        name:         products.name,
        wooTitle:     products.wooTitle,
        brandId:      products.brandId,
        brandName:    brands.name,
        categoryId:   products.categoryId,
        categoryName: categories.name,
        costPrice:    products.costPrice,
        retailPrice:  products.retailPrice,
      })
      .from(products)
      .leftJoin(brands,      eq(products.brandId,    brands.id))
      .leftJoin(categories,  eq(products.categoryId, categories.id))
      .where(textFilter)
      .orderBy(products.sku)
      .limit(limit)

    if (rows.length === 0) return rows

    const productIds = rows.map(r => r.productId)
    const attrs = await db
      .select({
        productId:  productAttributes.productId,
        defName:    attributeDefinitions.name,
        optionId:   productAttributes.optionId,
        valueText:  productAttributes.valueText,
        optLabel:   attributeOptions.label,
      })
      .from(productAttributes)
      .innerJoin(attributeDefinitions, eq(productAttributes.definitionId, attributeDefinitions.id))
      .leftJoin(attributeOptions,      eq(productAttributes.optionId,     attributeOptions.id))
      .where(and(
        inArray(productAttributes.productId, productIds),
        inArray(attributeDefinitions.name, ['Model', 'Size', 'Color', 'Unit']),
      ))

    const attrMap = new Map<string, {
      model?:         string | null
      sizeOptionId?:  string | null
      sizeLabel?:     string | null
      colorOptionId?: string | null
      colorLabel?:    string | null
      unitOptionId?:  string | null
      unitLabel?:     string | null
    }>()

    for (const a of attrs) {
      if (!attrMap.has(a.productId)) attrMap.set(a.productId, {})
      const entry = attrMap.get(a.productId)!
      const defLower = a.defName.toLowerCase()
      if (defLower === 'model') {
        entry.model = a.valueText ?? null
      } else if (defLower === 'size') {
        entry.sizeOptionId = a.optionId
        entry.sizeLabel    = a.optLabel
      } else if (defLower === 'color') {
        entry.colorOptionId = a.optionId
        entry.colorLabel    = a.optLabel
      } else if (defLower === 'unit') {
        entry.unitOptionId = a.optionId
        entry.unitLabel    = a.optLabel
      }
    }

    return rows.map(r => ({
      ...r,
      model:         attrMap.get(r.productId)?.model         ?? null,
      sizeOptionId:  attrMap.get(r.productId)?.sizeOptionId  ?? null,
      sizeLabel:     attrMap.get(r.productId)?.sizeLabel      ?? null,
      colorOptionId: attrMap.get(r.productId)?.colorOptionId ?? null,
      colorLabel:    attrMap.get(r.productId)?.colorLabel     ?? null,
      unitOptionId:  attrMap.get(r.productId)?.unitOptionId  ?? null,
      unitLabel:     attrMap.get(r.productId)?.unitLabel      ?? null,
    }))
  })

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
        retailPrice:  products.retailPrice,
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
