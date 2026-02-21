import type { FastifyPluginAsync } from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db.js'
import {
  warehouses,
  inventoryStock,
  products,
  brands,
  categories,
  productAttributes,
  attributeDefinitions,
  attributeOptions,
} from '@ob-inventory/db'

export const warehouseStockRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string } }>(
    '/api/warehouses/:id/stock',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      const { id } = request.params

      const [warehouse] = await db.select().from(warehouses).where(eq(warehouses.id, id))
      if (!warehouse) return reply.status(404).send({ error: 'Warehouse not found', code: 'NOT_FOUND' })

      const stock = await db
        .select({
          productId:    inventoryStock.productId,
          quantity:     inventoryStock.quantity,
          updatedAt:    inventoryStock.updatedAt,
          boxNumber:    inventoryStock.boxNumber,
          sku:          products.sku,
          name:         products.name,
          wooTitle:     products.wooTitle,
          dateAdded:    products.dateAdded,
          brandId:      products.brandId,
          categoryId:   products.categoryId,
          image:        products.picture,
          brandName:    brands.name,
          categoryName: categories.name,
        })
        .from(inventoryStock)
        .innerJoin(products,    eq(inventoryStock.productId, products.id))
        .leftJoin(brands,       eq(products.brandId,         brands.id))
        .leftJoin(categories,   eq(products.categoryId,      categories.id))
        .where(eq(inventoryStock.warehouseId, id))
        .orderBy(products.sku)

      if (stock.length === 0) return []

      const productIds = stock.map(s => s.productId)
      const attrs = await db
        .select({
          productId:   productAttributes.productId,
          defName:     attributeDefinitions.name,
          valueText:   productAttributes.valueText,
          optionId:    productAttributes.optionId,
          optionLabel: attributeOptions.label,
        })
        .from(productAttributes)
        .innerJoin(attributeDefinitions, eq(productAttributes.definitionId, attributeDefinitions.id))
        .leftJoin(attributeOptions,      eq(productAttributes.optionId,     attributeOptions.id))
        .where(inArray(productAttributes.productId, productIds))

      type AttrEntry = { label: string; optionId: string | null }
      const attrMap = new Map<string, Record<string, AttrEntry>>()
      for (const attr of attrs) {
        if (!attrMap.has(attr.productId)) attrMap.set(attr.productId, {})
        attrMap.get(attr.productId)![attr.defName.toLowerCase()] = {
          label:    attr.optionLabel ?? attr.valueText ?? '',
          optionId: attr.optionId,
        }
      }

      return stock.map(s => {
        const a = attrMap.get(s.productId) ?? {}
        return {
          productId:     s.productId,
          sku:           s.sku,
          name:          s.name,
          wooTitle:      s.wooTitle     ?? null,
          boxNumber:     s.boxNumber,
          dateAdded:     s.dateAdded,
          brand:         s.brandName    ?? null,
          category:      s.categoryName ?? null,
          brandId:       s.brandId      ?? null,
          categoryId:    s.categoryId   ?? null,
          image:         s.image        ?? null,
          model:         a['model']?.label    ?? null,
          size:          a['size']?.label     ?? null,
          color:         a['color']?.label    ?? null,
          unit:          a['unit']?.label     ?? null,
          sizeOptionId:  a['size']?.optionId  ?? null,
          colorOptionId: a['color']?.optionId ?? null,
          unitOptionId:  a['unit']?.optionId  ?? null,
          quantity:      s.quantity,
          updatedAt:     s.updatedAt,
        }
      })
    },
  )
}
