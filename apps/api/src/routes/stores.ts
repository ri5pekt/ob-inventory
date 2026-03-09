import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { stores, products, inventoryStock, warehouses } from '@ob-inventory/db'

// Shape returned by the WooCommerce plugin /products endpoint
interface WooProduct {
  woo_id:       number
  parent_id:    number | null
  type:         string
  sku:          string
  name:         string
  attrs:        string | null
  quantity:     number | null
  manage_stock: boolean
}

const createStoreSchema = z.object({
  name: z.string().min(1),
  url: z.string().url().optional(),
  platform: z.enum(['woocommerce', 'direct', 'other']).default('woocommerce'),
  notes: z.string().optional(),
})

const updateStoreSchema = z.object({
  name: z.string().min(1).optional(),
  url: z.string().url().nullable().optional(),
  secretToken: z.string().optional(),   // empty string = clear token
  notes: z.string().nullable().optional(),
})

/** Strip secret from list responses — never expose the raw token in bulk. */
function publicStore(s: typeof stores.$inferSelect) {
  const { secretToken, ...rest } = s
  return { ...rest, hasToken: !!secretToken }
}

export const storeRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── List stores (no secret) ───────────────────────────────────────────────
  fastify.get('/api/stores', auth, async () => {
    const rows = await db.select().from(stores).where(eq(stores.isActive, true)).orderBy(stores.name)
    return rows.map(publicStore)
  })

  // ── Get single store (includes hasToken but not raw token) ────────────────
  fastify.get<{ Params: { id: string } }>('/api/stores/:id', auth, async (request, reply) => {
    const [store] = await db.select().from(stores).where(eq(stores.id, request.params.id))
    if (!store) return reply.status(404).send({ error: 'Store not found' })
    return publicStore(store)
  })

  // ── Update store settings ─────────────────────────────────────────────────
  fastify.put<{ Params: { id: string } }>('/api/stores/:id', auth, async (request, reply) => {
    const body = updateStoreSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    }

    const updates: Partial<typeof stores.$inferInsert> = {}
    if (body.data.name        !== undefined) updates.name        = body.data.name
    if (body.data.url         !== undefined) updates.url         = body.data.url
    if (body.data.notes       !== undefined) updates.notes       = body.data.notes
    // Only update token when the caller explicitly sends it (non-empty string)
    if (body.data.secretToken !== undefined && body.data.secretToken !== '') {
      updates.secretToken = body.data.secretToken
    }

    const [store] = await db.update(stores).set(updates).where(eq(stores.id, request.params.id)).returning()
    if (!store) return reply.status(404).send({ error: 'Store not found' })
    return publicStore(store)
  })

  // ── Test WooCommerce connection (both directions) ─────────────────────────
  fastify.post<{ Params: { id: string } }>('/api/stores/:id/woo/test', auth, async (request, reply) => {
    const [store] = await db.select().from(stores).where(eq(stores.id, request.params.id))
    if (!store) return reply.status(404).send({ error: 'Store not found' })

    if (!store.url) {
      return reply.status(400).send({ error: 'Store URL is not set', code: 'NO_URL' })
    }
    if (!store.secretToken) {
      return reply.status(400).send({ error: 'Secret token is not set', code: 'NO_TOKEN' })
    }

    const base    = store.url.replace(/\/$/, '')
    const headers = { Authorization: `Bearer ${store.secretToken}` }

    async function fetchWithTimeout(url: string, timeoutMs = 8000) {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), timeoutMs)
      try {
        return await fetch(url, { headers, signal: ctrl.signal })
      } finally {
        clearTimeout(t)
      }
    }

    // ── Direction 1: Inventory → WooCommerce ──────────────────────────────────
    type ForwardResult = { success: boolean; error?: string; data?: Record<string, unknown> }
    let forward: ForwardResult

    try {
      const res = await fetchWithTimeout(`${base}/wp-json/ob-inventory/v1/ping`)
      if (res.status === 401 || res.status === 403) {
        forward = { success: false, error: 'Authentication failed — check your secret token' }
      } else if (!res.ok) {
        forward = { success: false, error: `Unexpected response: HTTP ${res.status}` }
      } else {
        const data = await res.json() as Record<string, unknown>
        forward = { success: true, data }
      }
    } catch (err: unknown) {
      forward = {
        success: false,
        error: (err as { name?: string })?.name === 'AbortError'
          ? 'Connection timed out (8 s)'
          : `Cannot connect — ${(err as Error).message}`,
      }
    }

    // ── Direction 2: WooCommerce → Inventory (ping-back) ─────────────────────
    type ReverseResult = { success: boolean; error?: string; data?: Record<string, unknown> }
    let reverse: ReverseResult

    // Only attempt if forward succeeded (plugin must be reachable)
    if (!forward.success) {
      reverse = { success: false, error: 'Skipped — forward connection failed first' }
    } else {
      try {
        const res = await fetchWithTimeout(`${base}/wp-json/ob-inventory/v1/ping-back`)
        if (!res.ok) {
          reverse = { success: false, error: `Plugin ping-back returned HTTP ${res.status}` }
        } else {
          const data = await res.json() as Record<string, unknown>
          reverse = { success: data['status'] === 'ok', data, error: data['error'] as string | undefined }
        }
      } catch (err: unknown) {
        reverse = {
          success: false,
          error: (err as { name?: string })?.name === 'AbortError'
            ? 'Ping-back timed out (8 s)'
            : `Ping-back failed — ${(err as Error).message}`,
        }
      }
    }

    return { forward, reverse }
  })

  // ── Sync preview (read-only comparison) ──────────────────────────────────
  fastify.get<{ Params: { id: string } }>('/api/stores/:id/woo/sync-preview', auth, async (request, reply) => {
    const [store] = await db.select().from(stores).where(eq(stores.id, request.params.id))
    if (!store) return reply.status(404).send({ error: 'Store not found' })

    if (!store.url || !store.secretToken) {
      return reply.status(400).send({ error: 'Store URL and secret token must be configured first', code: 'NOT_CONFIGURED' })
    }

    // ── Fetch all pages from WooCommerce plugin ─────────────────────────────
    const baseUrl = store.url.replace(/\/$/, '')
    const headers = { Authorization: `Bearer ${store.secretToken}` }

    async function fetchPage(page: number): Promise<{ products: WooProduct[]; totalPages: number }> {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30_000)
      try {
        const res = await fetch(
          `${baseUrl}/wp-json/ob-inventory/v1/products?per_page=100&page=${page}`,
          { headers, signal: controller.signal },
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json() as { products: WooProduct[]; total_pages: number }
        return { products: data.products, totalPages: data.total_pages ?? 1 }
      } finally {
        clearTimeout(timeout)
      }
    }

    let wooProducts: WooProduct[] = []
    try {
      const first = await fetchPage(1)
      wooProducts = first.products
      // Fetch remaining pages in parallel (most stores fit in 1-2 pages)
      if (first.totalPages > 1) {
        const rest = await Promise.all(
          Array.from({ length: first.totalPages - 1 }, (_, i) => fetchPage(i + 2)),
        )
        for (const p of rest) wooProducts = wooProducts.concat(p.products)
      }
    } catch (err: unknown) {
      const msg = (err as { name?: string })?.name === 'AbortError'
        ? 'Timed out fetching products from WooCommerce (30s)'
        : `Cannot reach WooCommerce: ${(err as Error).message}`
      return reply.status(502).send({ error: msg })
    }

    // ── Load main warehouse stock from DB ───────────────────────────────────
    const obStock = await db
      .select({ productId: products.id, sku: products.sku, name: products.name, quantity: inventoryStock.quantity })
      .from(inventoryStock)
      .innerJoin(products,   eq(inventoryStock.productId,   products.id))
      .innerJoin(warehouses, eq(inventoryStock.warehouseId, warehouses.id))
      .where(eq(warehouses.type, 'main'))

    // ── Match by SKU (case-insensitive, trimmed) ─────────────────────────────
    // WooCommerce SKUs sometimes differ in casing or have extra whitespace
    const norm = (sku: string) => sku.trim().toLowerCase()

    // Filter out products with blank SKUs (e.g. WooCommerce parent-level records)
    const obFiltered  = obStock.filter(s => s.sku?.trim())
    const wooFiltered = wooProducts.filter(p => p.sku?.trim())

    const obMap  = new Map(obFiltered.map(s => [norm(s.sku!), s]))
    const wooMap = new Map(wooFiltered.map(p => [norm(p.sku), p]))

    type SyncStatus = 'synced' | 'qty_mismatch' | 'ob_only' | 'woo_only' | 'untracked'

    const allKeys = new Set([...obMap.keys(), ...wooMap.keys()])

    const items = [...allKeys].map(key => {
      const ob  = obMap.get(key)
      const woo = wooMap.get(key)

      // Prefer the canonical casing from OB; fall back to WooCommerce as-is
      const sku = ob?.sku ?? woo?.sku ?? key

      let status: SyncStatus
      if (ob && woo) {
        if (!woo.manage_stock)                 status = 'untracked'
        else if (ob.quantity === woo.quantity)  status = 'synced'
        else                                   status = 'qty_mismatch'
      } else if (ob) {
        status = 'ob_only'
      } else {
        status = 'woo_only'
      }

      return {
        sku,
        obProductId: ob?.productId ?? null,
        obName:      ob?.name   ?? null,
        wooName:     woo?.name  ?? null,
        wooAttrs:    woo?.attrs ?? null,
        obQty:       ob  ? ob.quantity  : null,
        wooQty:      woo ? woo.quantity : null,
        wooId:       woo?.woo_id               ?? null,
        wooParentId: woo?.parent_id || null,   // non-zero parent = variation
        wooType:     woo?.type                 ?? null,
        status,
      }
    }).sort((a, b) => a.sku.localeCompare(b.sku))

    const count = (s: SyncStatus) => items.filter(i => i.status === s).length

    return {
      items,
      summary: {
        total:      items.length,
        synced:     count('synced'),
        mismatch:   count('qty_mismatch'),
        obOnly:     count('ob_only'),
        wooOnly:    count('woo_only'),
        untracked:  count('untracked'),
      },
      meta: { wooTotal: wooFiltered.length, obTotal: obFiltered.length },
    }
  })

  // ── Create store ──────────────────────────────────────────────────────────
  fastify.post('/api/stores', auth, async (request, reply) => {
    const body = createStoreSchema.safeParse(request.body)
    if (!body.success) {
      return reply.status(400).send({ error: 'Invalid input', code: 'VALIDATION_ERROR', details: body.error.flatten() })
    }
    const [store] = await db.insert(stores).values(body.data).returning()
    return reply.status(201).send(publicStore(store))
  })
}
