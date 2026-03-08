import type { FastifyPluginAsync } from 'fastify'
import { eq, and, sql } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import sharp from 'sharp'
import { db } from '../db.js'
import {
  products, brands, categories, inventoryStock, inventoryLedger,
  productAttributes, attributeDefinitions, attributeOptions, warehouses,
} from '@ob-inventory/db'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

// __dirname here is dist/routes/ — go up two levels to reach apps/api/,
// then into uploads/products, which aligns with the fastify-static root in index.ts
const UPLOADS_DIR = join(__dirname, '../../uploads/products')
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })

// ─── In-memory job store ────────────────────────────────────────────────────

interface ErrorDetail    { sku: string; row: number; reason: string }
interface DuplicateDetail { sku: string; rows: number[] }
interface BlankDetail     { row: number }
interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: ErrorDetail[]
  duplicates: DuplicateDetail[]
  blanks: BlankDetail[]
  imagesFailed: number
}
interface ImportJob {
  status: 'pending' | 'running' | 'done' | 'error'
  total: number
  current: number
  currentSku: string
  result?: ImportResult
  errorMessage?: string
  clients: Set<(payload: string) => void>
}

const jobs = new Map<string, ImportJob>()

// Purge finished jobs after 15 minutes
setInterval(() => {
  for (const [id, job] of jobs) {
    if (job.status === 'done' || job.status === 'error') jobs.delete(id)
  }
}, 15 * 60 * 1000)

function emit(job: ImportJob, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const send of job.clients) {
    try { send(payload) } catch { /* client gone */ }
  }
}

// ─── Image download + resize ────────────────────────────────────────────────

async function downloadImage(url: string, sku: string): Promise<string | null> {
  try {
    const safeSku = sku.replace(/[^a-zA-Z0-9_-]/g, '_')
    const ctrl    = new AbortController()
    const timer   = setTimeout(() => ctrl.abort(), 12_000)

    let res: Response
    try {
      res = await fetch(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null

    const buf = Buffer.from(await res.arrayBuffer())

    // Full-size (max 1200 px on longest side)
    await sharp(buf)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(join(UPLOADS_DIR, `${safeSku}.jpg`))

    // Thumbnail 240×240 for list view
    await sharp(buf)
      .resize(240, 240, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toFile(join(UPLOADS_DIR, `${safeSku}-thumb.jpg`))

    return `/uploads/products/${safeSku}-thumb.jpg`
  } catch {
    return null
  }
}

// ─── Safe date parser ────────────────────────────────────────────────────────
// Returns YYYY-MM-DD or null for anything it can't parse with a valid year

function parseDate(raw: string): string {
  if (raw && raw.toLowerCase() !== 'bc') {
    try {
      const d = new Date(raw)
      if (!isNaN(d.getTime())) {
        const year = d.getFullYear()
        if (year >= 2000 && year <= 2100) return d.toISOString().slice(0, 10)
      }
    } catch { /* fall through */ }
  }
  return '2001-01-01'
}

// ─── Header-based column resolver ───────────────────────────────────────────

function buildColMap(headerRow: string[]): (names: string[]) => number {
  const norm = headerRow.map(h => h?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '')
  return (candidates: string[]) => {
    for (const c of candidates) {
      const idx = norm.indexOf(c.toLowerCase())
      if (idx !== -1) return idx
    }
    return -1
  }
}

// ─── Import processor ────────────────────────────────────────────────────────

async function runImport(job: ImportJob, csvBuffer: Buffer, warehouseId: string) {
  job.status = 'running'

  // Parse CSV ----------------------------------------------------------------
  let rows: string[][]
  try {
    rows = parse(csvBuffer, {
      relax_column_count: true,
      skip_empty_lines: false,
      bom: true,
    }) as string[][]
  } catch (e) {
    job.status = 'error'
    job.errorMessage = `CSV parse error: ${e}`
    emit(job, 'error', { message: job.errorMessage })
    return
  }

  if (rows.length < 2) {
    job.status = 'error'
    job.errorMessage = 'CSV has no data rows'
    emit(job, 'error', { message: job.errorMessage })
    return
  }

  // Resolve columns by header name (handles any column order / format) -------
  const col = buildColMap(rows[0])

  const C = {
    sku:       col(['sku']),
    title:     col(['title', 'name', 'שם']),
    brand:     col(['brand']),
    category:  col(['class', 'category', 'catagory', 'קטגוריות']),
    model:     col(['model', 'type/ model', 'type/model']),
    size:      col(['size', 'size ']),
    color:     col(['color', 'colour']),
    qty:       col(['qty', 'quantity', 'מלאי']),
    price:     col(['price', 'מחיר רגיל', 'base price']),
    image:     col(['image', 'images', 'picture']),
    box:       col(['box#', 'box']),
    dateAdded: col(['date added', 'date']),
    unit:      col(['unit']),
    rowType:   col(['סוג', 'type']),   // WooCommerce format only
  }

  if (C.sku === -1) {
    job.status = 'error'
    job.errorMessage = 'CSV is missing a "SKU" column'
    emit(job, 'error', { message: job.errorMessage })
    return
  }

  // Build importable list keeping original CSV row number (row 1 = header, row 2 = first data row)
  // Also collect blank-SKU rows up front so they appear in the report
  const blanksEarly: BlankDetail[] = []
  const importable: Array<{ row: string[]; csvRow: number }> = []

  rows.slice(1).forEach((row, idx) => {
    const csvRow = idx + 2 // 1-indexed; +1 for header, +1 for 0-base
    const sku    = row[C.sku]?.trim()
    const type   = C.rowType !== -1 ? row[C.rowType]?.trim().toLowerCase() : ''
    if (type === 'variable') return          // WooCommerce parent – skip silently
    if (!sku) { blanksEarly.push({ row: csvRow }); return }
    importable.push({ row, csvRow })
  })

  job.total = importable.length
  emit(job, 'start', { total: importable.length })

  // ── Lookup caches ──────────────────────────────────────────────────────────
  const brandCache = new Map<string, string>()
  const catCache   = new Map<string, string>()
  const defCache   = new Map<string, string>()
  const optCache   = new Map<string, string>()

  async function getOrCreateBrand(name: string): Promise<string> {
    const n = name.trim()
    if (brandCache.has(n)) return brandCache.get(n)!
    const [row] = await db.select({ id: brands.id }).from(brands).where(eq(brands.name, n))
    if (row) { brandCache.set(n, row.id); return row.id }
    const [ins] = await db.insert(brands).values({ name: n })
      .onConflictDoUpdate({ target: brands.name, set: { name: n } }).returning()
    brandCache.set(n, ins.id)
    return ins.id
  }

  async function getOrCreateCategory(name: string): Promise<string> {
    const n = name.trim()
    if (catCache.has(n)) return catCache.get(n)!
    const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.name, n))
    if (row) { catCache.set(n, row.id); return row.id }
    const [ins] = await db.insert(categories).values({ name: n })
      .onConflictDoUpdate({ target: categories.name, set: { name: n } }).returning()
    catCache.set(n, ins.id)
    return ins.id
  }

  async function getOrCreateDef(name: string): Promise<string> {
    const key = name.toLowerCase().trim()
    if (defCache.has(key)) return defCache.get(key)!
    // Case-insensitive lookup so "size" and "Size" resolve to the same definition
    const [row] = await db.select({ id: attributeDefinitions.id, name: attributeDefinitions.name })
      .from(attributeDefinitions)
      .where(sql`lower(${attributeDefinitions.name}) = ${key}`)
    if (row) { defCache.set(key, row.id); return row.id }
    // Normalise to title-case when inserting a brand-new definition
    const titleName = key.charAt(0).toUpperCase() + key.slice(1)
    const [ins] = await db.insert(attributeDefinitions)
      .values({ name: titleName, inputType: 'select', sortOrder: 0 })
      .onConflictDoUpdate({ target: attributeDefinitions.name, set: { name: titleName } }).returning()
    defCache.set(key, ins.id)
    return ins.id
  }

  async function getOrCreateOpt(defId: string, code: string): Promise<string> {
    const key = `${defId}:${code}`
    if (optCache.has(key)) return optCache.get(key)!
    const [row] = await db.select({ id: attributeOptions.id }).from(attributeOptions)
      .where(and(eq(attributeOptions.definitionId, defId), eq(attributeOptions.code, code)))
    if (row) { optCache.set(key, row.id); return row.id }
    const [ins] = await db.insert(attributeOptions)
      .values({ definitionId: defId, code, label: code, sortOrder: 0 })
      .onConflictDoNothing().returning()
    if (!ins) {
      const [fetched] = await db.select({ id: attributeOptions.id }).from(attributeOptions)
        .where(and(eq(attributeOptions.definitionId, defId), eq(attributeOptions.code, code)))
      optCache.set(key, fetched.id)
      return fetched.id
    }
    optCache.set(key, ins.id)
    return ins.id
  }

  // ── Process rows ───────────────────────────────────────────────────────────
  const result: ImportResult = {
    imported: 0, updated: 0, skipped: blanksEarly.length,
    errors: [], duplicates: [], blanks: blanksEarly, imagesFailed: 0,
  }
  const seenSkus = new Map<string, number[]>() // sku → csvRow[]

  function cell(row: string[], idx: number): string {
    return idx !== -1 ? (row[idx]?.trim() ?? '') : ''
  }

  for (let i = 0; i < importable.length; i++) {
    const { row, csvRow } = importable[i]
    const sku = cell(row, C.sku).toUpperCase()

    job.current    = i + 1
    job.currentSku = sku

    if (i === 0 || i === importable.length - 1 || (i + 1) % 5 === 0) {
      emit(job, 'progress', { current: i + 1, total: importable.length, sku })
    }

    // Track duplicates
    if (seenSkus.has(sku)) {
      seenSkus.get(sku)!.push(csvRow)
    } else {
      seenSkus.set(sku, [csvRow])
    }

    try {
      const rawName  = cell(row, C.title)
      // Strip Hebrew if mixed (take English part before first comma)
      const name     = /[\u0590-\u05FF]/.test(rawName)
        ? (rawName.split(',')[0].trim() || sku)
        : (rawName || sku)

      const brandRaw = cell(row, C.brand)
      const catRaw   = cell(row, C.category)
      const modelVal = cell(row, C.model)
      const sizeVal  = cell(row, C.size)
      const colorVal = cell(row, C.color)
      const qty      = Math.max(0, parseInt(cell(row, C.qty) || '0', 10) || 0)
      const price    = parseFloat(cell(row, C.price)) || null
      const imageUrl = cell(row, C.image)
      const boxNum   = cell(row, C.box) || null
      const dateAdded = parseDate(cell(row, C.dateAdded))
      const unitVal   = cell(row, C.unit)

      // Brand / category
      let brandId:    string | null = null
      let categoryId: string | null = null
      if (brandRaw) brandId    = await getOrCreateBrand(brandRaw)
      if (catRaw)   categoryId = await getOrCreateCategory(catRaw)

      // Image
      let picturePath: string | null = null
      if (imageUrl) {
        picturePath = await downloadImage(imageUrl, sku)
        if (!picturePath) result.imagesFailed++
      }

      // Upsert product — only overwrite picture if a new image was successfully fetched
      const updateSet: Record<string, unknown> = {
        name, brandId, categoryId,
        basePrice: price != null ? String(price) : null,
        dateAdded,
      }
      if (picturePath !== null) updateSet.picture = picturePath

      const [product] = await db.insert(products)
        .values({ sku, name, brandId, categoryId, basePrice: price != null ? String(price) : null, picture: picturePath, dateAdded })
        .onConflictDoUpdate({ target: products.sku, set: updateSet })
        .returning()

      // Attributes: color, size, model, unit
      for (const [defName, value] of [['color', colorVal], ['size', sizeVal], ['model', modelVal], ['unit', unitVal]] as const) {
        if (!value) continue
        const defId = await getOrCreateDef(defName)
        const optId = await getOrCreateOpt(defId, value)
        await db.insert(productAttributes)
          .values({ productId: product.id, definitionId: defId, optionId: optId })
          .onConflictDoNothing()
      }

      // Stock (always create a row, even qty=0, so product appears in warehouse)
      await db.insert(inventoryStock)
        .values({ productId: product.id, warehouseId, quantity: qty, boxNumber: boxNum })
        .onConflictDoUpdate({
          target: [inventoryStock.productId, inventoryStock.warehouseId],
          set: { quantity: qty, boxNumber: boxNum },
        })

      if (qty > 0) {
        await db.insert(inventoryLedger).values({
          productId: product.id,
          warehouseId,
          actionType: 'receive',
          quantityDelta: qty,
          reason: 'CSV import',
          notes: 'Opening stock imported from CSV',
        })
      }

      const isDup = (seenSkus.get(sku)?.length ?? 0) > 1
      if (isDup) {
        result.updated++
      } else {
        result.imported++
      }
    } catch (err: unknown) {
      result.errors.push({ sku, row: csvRow, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // Build duplicate summary (skus that appeared more than once)
  for (const [sku, rows] of seenSkus) {
    if (rows.length > 1) result.duplicates.push({ sku, rows })
  }

  job.status = 'done'
  job.result = result
  emit(job, 'done', result)
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const importRoutes: FastifyPluginAsync = async (fastify) => {

  // POST /api/import/start ───────────────────────────────────────────────────
  fastify.post(
    '/api/import/start',
    { onRequest: [fastify.authenticate] },
    async (request, reply) => {
      let csvBuffer: Buffer | null = null
      let warehouseId: string | null = null

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          csvBuffer = Buffer.concat(chunks)
        } else {
          if (part.fieldname === 'warehouseId') warehouseId = part.value as string
        }
      }

      if (!csvBuffer)   return reply.status(400).send({ error: 'No CSV file uploaded' })
      if (!warehouseId) return reply.status(400).send({ error: 'warehouseId is required' })

      const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, warehouseId))
      if (!wh) return reply.status(404).send({ error: 'Warehouse not found' })

      const jobId = randomUUID()
      const job: ImportJob = {
        status: 'pending', total: 0, current: 0, currentSku: '', clients: new Set(),
      }
      jobs.set(jobId, job)

      // Start async – do NOT await
      runImport(job, csvBuffer, warehouseId).catch(err => {
        job.status = 'error'
        job.errorMessage = String(err)
        emit(job, 'error', { message: job.errorMessage })
      })

      return reply.status(202).send({ jobId })
    },
  )

  // GET /api/import/:jobId/events ────────────────────────────────────────────
  fastify.get<{ Params: { jobId: string }; Querystring: { token?: string } }>(
    '/api/import/:jobId/events',
    async (request, reply) => {
      const token = request.query.token
      if (!token) return reply.status(401).send({ error: 'token query param required' })
      try {
        fastify.jwt.verify(token)
      } catch {
        return reply.status(401).send({ error: 'Invalid token' })
      }

      const job = jobs.get(request.params.jobId)
      if (!job) return reply.status(404).send({ error: 'Job not found' })

      const raw = reply.raw
      raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      raw.setHeader('Cache-Control', 'no-cache, no-transform')
      raw.setHeader('Connection', 'keep-alive')
      raw.setHeader('X-Accel-Buffering', 'no')
      raw.flushHeaders()

      // If already finished, send final event and close immediately
      if (job.status === 'done') {
        raw.write(`event: done\ndata: ${JSON.stringify(job.result)}\n\n`)
        raw.end()
        reply.hijack()
        return
      }
      if (job.status === 'error') {
        raw.write(`event: error\ndata: ${JSON.stringify({ message: job.errorMessage })}\n\n`)
        raw.end()
        reply.hijack()
        return
      }

      // Send heartbeat so the connection stays alive
      const heartbeat = setInterval(() => {
        try { raw.write(': ping\n\n') } catch { clearInterval(heartbeat) }
      }, 20_000)

      const send = (payload: string) => raw.write(payload)
      job.clients.add(send)

      raw.on('close', () => {
        clearInterval(heartbeat)
        job.clients.delete(send)
      })

      reply.hijack()
    },
  )

  // DELETE /api/import/clear-all ─────────────────────────────────────────────
  fastify.delete(
    '/api/import/clear-all',
    { onRequest: [fastify.authenticate] },
    async (_request, reply) => {
      await db.execute(
        `TRUNCATE TABLE
          sale_items, sales,
          transfer_items, transfers,
          inventory_ledger, inventory_stock,
          product_attributes, products,
          brands, categories
         CASCADE`
      )
      return reply.send({ ok: true })
    },
  )
}
