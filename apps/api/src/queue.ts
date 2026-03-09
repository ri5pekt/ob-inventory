import { Queue } from 'bullmq'
import IORedis from 'ioredis'
import { env } from './env.js'

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
 */
export async function enqueueSyncWooStock(productId: string): Promise<string | undefined> {
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
}
