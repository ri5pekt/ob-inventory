import type { FastifyPluginAsync } from 'fastify'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from 'csv-parse/sync'
import sharp from 'sharp'
import { db } from '../db.js'
import {
  products, categories, inventoryStock, inventoryLedger,
  productAttributes, attributeDefinitions, attributeOptions, warehouses,
} from '@ob-inventory/db'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

const UPLOADS_DIR = join(__dirname, '../../uploads/products')
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })

// ─── In-memory job store ────────────────────────────────────────────────────

interface ErrorDetail { sku: string; reason: string }
interface ImportResult {
  imported: number
  skipped: number
  errors: ErrorDetail[]
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

// ─── CSV column indices ──────────────────────────────────────────────────────
// 0  product  | 1 Color | 2 SIZE | 3 Type/Model | 4 (category data) | 5 catagory
// 6  SKU      | 7 type  | 8 name(he) | 9 desc | 10 in_stock | 11 qty | 12 price
// 13 categories(he) | 14 tags | 15 Images | 16 attr_name | 17 attr_val | 18 parent

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

  // Filter: skip "variable" parent rows and blank SKUs
  const importable = rows.slice(1).filter(r => {
    const sku  = r[6]?.trim()
    const type = r[7]?.trim().toLowerCase()
    return sku && type !== 'variable'
  })

  job.total = importable.length
  emit(job, 'start', { total: importable.length })

  // ── Caches to minimise round-trips ──────────────────────────────────────
  const catCache = new Map<string, string>()   // name  → id
  const defCache = new Map<string, string>()   // name  → id
  const optCache = new Map<string, string>()   // defId:code → id

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
    const n = name.toLowerCase().trim()
    if (defCache.has(n)) return defCache.get(n)!
    const [row] = await db.select({ id: attributeDefinitions.id }).from(attributeDefinitions).where(eq(attributeDefinitions.name, n))
    if (row) { defCache.set(n, row.id); return row.id }
    const [ins] = await db.insert(attributeDefinitions).values({ name: n, inputType: 'select', sortOrder: 0 })
      .onConflictDoUpdate({ target: attributeDefinitions.name, set: { name: n } }).returning()
    defCache.set(n, ins.id)
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
      // Race / conflict – fetch again
      const [fetched] = await db.select({ id: attributeOptions.id }).from(attributeOptions)
        .where(and(eq(attributeOptions.definitionId, defId), eq(attributeOptions.code, code)))
      optCache.set(key, fetched.id)
      return fetched.id
    }
    optCache.set(key, ins.id)
    return ins.id
  }

  // ── Process rows ──────────────────────────────────────────────────────────
  const result: ImportResult = { imported: 0, skipped: 0, errors: [], imagesFailed: 0 }

  for (let i = 0; i < importable.length; i++) {
    const row = importable[i]
    const sku = row[6]?.trim().toUpperCase()

    job.current   = i + 1
    job.currentSku = sku

    // Emit progress every 5 rows (plus first and last)
    if (i === 0 || i === importable.length - 1 || (i + 1) % 5 === 0) {
      emit(job, 'progress', { current: i + 1, total: importable.length, sku })
    }

    try {
      // Name: strip Hebrew when mixed (take the English part before the first comma)
      const rawName = row[8]?.trim() ?? ''
      const name = /[\u0590-\u05FF]/.test(rawName)
        ? (rawName.split(',')[0].trim() || sku)
        : (rawName || sku)

      // Category: col 4 (data field under empty header) or col 5 (catagory)
      const catRaw   = row[4]?.trim() || row[5]?.trim()
      const qty      = Math.max(0, parseInt(row[11] ?? '0', 10) || 0)
      const price    = parseFloat(row[12] ?? '') || null
      const imageUrl = row[15]?.trim()
      const colorCode = row[1]?.trim()
      const sizeVal   = row[2]?.trim()
      const modelVal  = row[3]?.trim()

      let categoryId: string | null = null
      if (catRaw) categoryId = await getOrCreateCategory(catRaw)

      // Image
      let picturePath: string | null = null
      if (imageUrl) {
        picturePath = await downloadImage(imageUrl, sku)
        if (!picturePath) result.imagesFailed++
      }

      // Upsert product
      const [product] = await db.insert(products)
        .values({
          sku,
          name,
          categoryId,
          basePrice: price != null ? String(price) : null,
          picture: picturePath,
        })
        .onConflictDoUpdate({
          target: products.sku,
          set: { name, categoryId, basePrice: price != null ? String(price) : null, picture: picturePath },
        })
        .returning()

      // Attributes (color, size, model)
      for (const [defName, value] of [['color', colorCode], ['size', sizeVal], ['model', modelVal]] as const) {
        if (!value) continue
        const defId = await getOrCreateDef(defName)
        const optId = await getOrCreateOpt(defId, value)
        await db.insert(productAttributes)
          .values({ productId: product.id, definitionId: defId, optionId: optId })
          .onConflictDoNothing()
      }

      // Stock row (always, even qty=0 so product appears in warehouse view)
      await db.insert(inventoryStock)
        .values({ productId: product.id, warehouseId, quantity: qty })
        .onConflictDoUpdate({
          target: [inventoryStock.productId, inventoryStock.warehouseId],
          set: { quantity: qty },
        })

      // Ledger entry only when there is stock to receive
      if (qty > 0) {
        await db.insert(inventoryLedger).values({
          productId: product.id,
          warehouseId,
          actionType: 'receive',
          quantityDelta: qty,
          reason: 'CSV import',
          notes: `Opening stock imported from CSV`,
        })
      }

      result.imported++
    } catch (err: unknown) {
      result.errors.push({ sku, reason: err instanceof Error ? err.message : String(err) })
    }
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
}
