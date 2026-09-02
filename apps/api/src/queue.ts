import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { env } from './env.js'
import { db } from './db.js'
import { wooSyncLog } from '@ob-inventory/db'

const QUEUE_NAME = 'sync-woo-stock'

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })

export const syncWooStockQueue = new Queue<{ productId: string }>(QUEUE_NAME, {
  connection: connection as never,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      age: 3600,   // keep 1 hour
      count: 1000, // or last 1000 completed jobs
    },
    removeOnFail: {
      age: 86400,  // keep failed jobs for 1 day for debugging
      count: 500,  // or last 500 failed jobs
    },
  },
})

/**
 * Enqueue a job to sync product stock to WooCommerce.
 * Before adding, removes older waiting/delayed jobs for the same product so only
 * the latest pending update remains. No jobId — queue policy handles retries and cleanup.
 *
 * This never throws — if the enqueue itself fails (e.g. a brief Redis blip), the
 * failure is recorded directly in woo_sync_log so it's visible in the Woo product
 * comparison tool instead of vanishing into an ephemeral container log line that
 * nobody sees until the numbers have silently drifted apart for weeks.
 */
export async function enqueueSyncWooStock(productId: string): Promise<string | undefined> {
  try {
    const [waiting, delayed] = await Promise.all([
      syncWooStockQueue.getJobs(['wait']),
      syncWooStockQueue.getJobs(['delayed']),
    ])
    const obsolete = [...waiting, ...delayed].filter((j) => j.data.productId === productId)
    for (const job of obsolete) {
      await job.remove()
    }
    const job = await syncWooStockQueue.add('sync', { productId })
    return job.id
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[sync-woo-stock] Enqueue failed for product ${productId}: ${error}`)
    try {
      await db.insert(wooSyncLog).values({
        productId,
        action:      'push_stock',
        status:      'failed',
        payload:     { productId, stage: 'enqueue' },
        response:    null,
        error:       `Enqueue failed: ${error}`,
        attempts:    0,
        completedAt: new Date(),
      })
    } catch (logErr) {
      // If even the DB write fails, there's nothing more we can do here — swallow
      // so a logging failure never blocks the caller's own request.
      console.error(`[sync-woo-stock] Also failed to record enqueue failure in woo_sync_log:`, logErr)
    }
    return undefined
  }
}
