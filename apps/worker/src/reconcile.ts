import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'
import { eq, and, gt, sql } from 'drizzle-orm'
import { env } from './env.js'
import { db } from './db.js'
import { inventoryLedger, warehouses, wooSyncLog } from '@ob-inventory/db'

const SYNC_QUEUE_NAME      = 'sync-woo-stock'
const RECONCILE_QUEUE_NAME = 'woo-reconcile'
const RECONCILE_EVERY_MS   = 30 * 60 * 1000 // every 30 minutes

const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null })

// Producer for the existing sync-woo-stock queue — this is the same queue the
// API enqueues onto after sales/transfers/adjustments; reconciliation just
// re-enqueues it for anything that looks like it fell through the cracks.
const syncWooStockQueue = new Queue<{ productId: string }>(SYNC_QUEUE_NAME, {
  connection: connection as never,
})

const reconcileQueue = new Queue(RECONCILE_QUEUE_NAME, { connection: connection as never })

/**
 * Finds products whose Main-warehouse stock changed (per inventory_ledger)
 * more recently than their last *successful* Woo push — i.e. a real OB-side
 * stock change that never made it out to WooCommerce. Catches jobs that were
 * silently dropped (e.g. a Redis blip during enqueue) with no other trace.
 */
async function findDriftedProductIds(): Promise<string[]> {
  const [mainWarehouse] = await db
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(eq(warehouses.type, 'main'))

  if (!mainWarehouse) return []

  // How far back to look for "drifted" products. This is a generous safety
  // margin (the reconcile loop itself runs every 30 min) — it exists only to
  // avoid resurrecting very old/irrelevant history on first deploy, not
  // because gaps older than this are expected.
  const ledgerRows = await db
    .select({
      productId:    inventoryLedger.productId,
      lastLedgerAt: sql<string>`max(${inventoryLedger.createdAt})`,
    })
    .from(inventoryLedger)
    .where(and(
      eq(inventoryLedger.warehouseId, mainWarehouse.id),
      gt(inventoryLedger.createdAt, sql`now() - interval '7 days'`),
    ))
    .groupBy(inventoryLedger.productId)

  if (ledgerRows.length === 0) return []

  const syncRows = await db
    .select({
      productId:     wooSyncLog.productId,
      lastSuccessAt: sql<string>`max(${wooSyncLog.createdAt})`,
    })
    .from(wooSyncLog)
    .where(eq(wooSyncLog.status, 'success'))
    .groupBy(wooSyncLog.productId)

  const lastSuccessByProduct = new Map(
    syncRows.filter(r => r.productId).map(r => [r.productId as string, new Date(r.lastSuccessAt)]),
  )

  return ledgerRows
    .filter((r) => {
      const lastSuccess = lastSuccessByProduct.get(r.productId)
      return !lastSuccess || new Date(r.lastLedgerAt) > lastSuccess
    })
    .map((r) => r.productId)
}

async function runReconciliation(): Promise<void> {
  const productIds = await findDriftedProductIds()

  if (productIds.length === 0) {
    console.log('[woo-reconcile] No drifted products found — everything in sync.')
    return
  }

  console.log(`[woo-reconcile] Found ${productIds.length} drifted product(s) — re-enqueuing sync-woo-stock jobs.`)
  for (const productId of productIds) {
    try {
      await syncWooStockQueue.add('sync', { productId })
    } catch (err) {
      console.error(`[woo-reconcile] Failed to enqueue sync for product ${productId}:`, err)
    }
  }
}

/**
 * Registers the repeatable reconciliation job + its worker. Safe to call on
 * every process start — BullMQ recognizes an identical repeat config already
 * exists and won't create a duplicate schedule.
 */
export async function startReconciliationSchedule(): Promise<void> {
  await reconcileQueue.add('run', {}, {
    repeat: { every: RECONCILE_EVERY_MS },
    jobId:  'woo-reconcile-schedule',
  })

  const reconcileWorker = new Worker(
    RECONCILE_QUEUE_NAME,
    async () => {
      await runReconciliation()
    },
    { connection: connection as never },
  )

  reconcileWorker.on('failed', (job, err) => {
    console.error(`[woo-reconcile] Reconciliation run failed: jobId=${job?.id}`, err)
  })

  console.log(`[woo-reconcile] Scheduled — runs every ${RECONCILE_EVERY_MS / 60_000} minutes.`)

  // Also run once shortly after startup, so a fresh deploy/restart doesn't wait
  // a full interval before catching anything that drifted while it was down.
  setTimeout(() => {
    runReconciliation().catch((err) => console.error('[woo-reconcile] Initial run failed:', err))
  }, 30_000)
}
