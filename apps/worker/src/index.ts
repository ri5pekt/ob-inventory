import { Worker, UnrecoverableError } from 'bullmq'
import { eq, and } from 'drizzle-orm'
import { env } from './env.js'
import IORedis from 'ioredis'
import { db } from './db.js'
import { products, inventoryStock, warehouses, stores, wooSyncLog } from '@ob-inventory/db'

const QUEUE_NAME = 'sync-woo-stock'

const connection = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

connection.on('connect', () => {
  console.log('[worker] Redis connected')
})
connection.on('error', (err) => {
  console.error('[worker] Redis error:', err.message)
})

/** HTTP 4xx = permanent (plugin/auth/config). 5xx/network = transient (retry). */
function isPermanentFailure(httpStatus: number | null): boolean {
  if (httpStatus == null) return false // network error = transient
  return httpStatus >= 400 && httpStatus < 500
}

async function pushStockToStore(
  store: { id: string; url: string; secretToken: string },
  productId: string,
  sku: string,
  quantity: number,
  jobAttempts: number,
): Promise<{ status: 'success' | 'failed'; error: string | null; httpStatus: number | null }> {
  const baseUrl = store.url.replace(/\/$/, '')
  const url = `${baseUrl}/wp-json/ob-inventory/v1/stock`
  const payload = { sku, quantity, storeId: store.id, storeUrl: baseUrl }

  console.log(`[sync-woo-stock] Woo request sent: store=${store.id} sku=${sku} qty=${quantity}`)

  let responseBody: unknown = null
  let error: string | null = null
  let httpStatus: number | null = null

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${store.secretToken}`,
      },
      body: JSON.stringify({ sku, quantity }),
    })

    httpStatus = res.status
    const text = await res.text()
    try {
      responseBody = text ? JSON.parse(text) : null
    } catch {
      responseBody = { status: res.status, body: text }
    }

    if (!res.ok) {
      error = `HTTP ${res.status}: ${text}`
      console.log(`[sync-woo-stock] Woo failure: store=${store.id} sku=${sku} status=${res.status} error=${error.slice(0, 80)}`)
    } else {
      console.log(`[sync-woo-stock] Woo success: store=${store.id} sku=${sku} qty=${quantity}`)
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    responseBody = null
    console.log(`[sync-woo-stock] Woo failure: store=${store.id} sku=${sku} network=${error}`)
  }

  const status = error ? 'failed' : 'success'
  await db.insert(wooSyncLog).values({
    productId,
    action: 'push_stock',
    status,
    payload,
    response: responseBody,
    error,
    attempts: jobAttempts,
    completedAt: new Date(),
  })

  return { status, error, httpStatus }
}

const worker = new Worker<{ productId: string }>(
  QUEUE_NAME,
  async (job) => {
    const { productId } = job.data
    console.log(`[sync-woo-stock] Job started: jobId=${job.id} productId=${productId}`)

    const [mainWarehouse] = await db.select().from(warehouses).where(eq(warehouses.type, 'main'))
    if (!mainWarehouse) {
      throw new UnrecoverableError('No main warehouse configured')
    }

    const [product] = await db.select({ sku: products.sku }).from(products).where(eq(products.id, productId))
    if (!product?.sku?.trim()) {
      throw new UnrecoverableError(`Product ${productId} has no SKU`)
    }

    const [stock] = await db
      .select({ quantity: inventoryStock.quantity })
      .from(inventoryStock)
      .where(and(
        eq(inventoryStock.productId, productId),
        eq(inventoryStock.warehouseId, mainWarehouse.id),
      ))

    const quantity = stock?.quantity ?? 0

    const wooStores = await db
      .select({ id: stores.id, url: stores.url, secretToken: stores.secretToken })
      .from(stores)
      .where(eq(stores.isActive, true))

    const storesToPush = wooStores.filter(s => s.url?.trim() && s.secretToken?.trim())
    if (storesToPush.length === 0) {
      throw new UnrecoverableError('No WooCommerce stores configured (url + secret token)')
    }

    let anyFailed = false
    let anyPermanent = false
    let lastError = ''
    for (const store of storesToPush) {
      const result = await pushStockToStore(
        { id: store.id, url: store.url!, secretToken: store.secretToken! },
        productId,
        product.sku,
        quantity,
        job.attemptsMade + 1,
      )
      if (result.status === 'failed') {
        anyFailed = true
        lastError = result.error ?? 'Unknown error'
        if (isPermanentFailure(result.httpStatus)) anyPermanent = true
      }
    }

    if (anyFailed) {
      if (anyPermanent) {
        throw new UnrecoverableError(`Woo sync failed: ${lastError}`)
      }
      throw new Error(`Woo sync failed: ${lastError}`)
    }
  },
  {
    connection: connection as never,
    concurrency: 5,
    lockDuration: 30_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
)

worker.on('completed', (job) => {
  console.log(`[sync-woo-stock] Job completed: jobId=${job.id} productId=${job.data.productId}`)
})

worker.on('failed', (job, err) => {
  console.error(`[sync-woo-stock] Job failed: jobId=${job?.id} productId=${job?.data?.productId} error=${err.message}`)
})

worker.on('stalled', (jobId) => {
  console.warn(`[sync-woo-stock] Stalled job detected: jobId=${jobId}`)
})

// Log store count on startup (after a short delay so DB is ready)
setTimeout(async () => {
  try {
    const storeRows = await db.select({ id: stores.id, url: stores.url, secretToken: stores.secretToken })
      .from(stores)
      .where(eq(stores.isActive, true))
    const configured = storeRows.filter(s => s.url?.trim() && s.secretToken?.trim()).length
    console.log(`[worker] Ready. ${configured} WooCommerce store(s) configured for sync.`)
  } catch (err) {
    console.warn('[worker] Could not check stores:', (err as Error).message)
  }
}, 2000)
