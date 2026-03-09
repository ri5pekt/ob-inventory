#!/usr/bin/env tsx
/**
 * Woo sync diagnostic script.
 * Checks: warehouses (main), stores, woo_sync_log, Redis queue, worker process.
 *
 * Usage: pnpm exec tsx --env-file=.env scripts/woo-sync-diagnose.ts
 * Or:    tsx --env-file=.env scripts/woo-sync-diagnose.ts
 */
import { createDb, warehouses, stores, wooSyncLog, products } from '../packages/db/src/index.js'
import IORedis from 'ioredis'
import { eq, desc } from 'drizzle-orm'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://ob_user:changeme@localhost:5432/ob_inventory'
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

const db = createDb(DATABASE_URL)

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Woo Sync Diagnostic')
  console.log('═══════════════════════════════════════════════════════════\n')

  // 1. Warehouses (main)
  console.log('1. MAIN WAREHOUSE')
  const mainWh = await db.select().from(warehouses).where(eq(warehouses.type, 'main'))
  if (mainWh.length === 0) {
    console.log('   ❌ No warehouse with type="main" found.')
    console.log('   → Sync is only enqueued for main warehouse. Set one warehouse type to "main".\n')
  } else {
    console.log(`   ✓ Main warehouse: ${mainWh[0].name} (${mainWh[0].id})\n`)
  }

  // 2. Stores (WooCommerce)
  console.log('2. WOOCOMMERCE STORES')
  const allStores = await db.select({
    id: stores.id,
    name: stores.name,
    url: stores.url,
    secretToken: stores.secretToken,
    isActive: stores.isActive,
  }).from(stores)

  const activeStores = allStores.filter(s => s.isActive)
  const configuredStores = activeStores.filter(s => (s.url?.trim() ?? '').length > 0 && (s.secretToken?.trim() ?? '').length > 0)

  if (allStores.length === 0) {
    console.log('   ❌ No stores in database.')
    console.log('   → Add a store in Settings → WooCommerce.\n')
  } else {
    console.log(`   Total stores: ${allStores.length}`)
    console.log(`   Active: ${activeStores.length}`)
    console.log(`   Configured (url + secret token): ${configuredStores.length}`)
    if (configuredStores.length === 0) {
      console.log('   ❌ No store has both URL and Secret Token set.')
      console.log('   → Worker skips sync when no store is configured (no woo_sync_log written).\n')
    } else {
      configuredStores.forEach(s => {
        const tokenPreview = s.secretToken ? `${s.secretToken.slice(0, 8)}…` : '—'
        console.log(`   ✓ ${s.name}: ${s.url} (token: ${tokenPreview})\n`)
      })
    }
  }

  // 3. Recent woo_sync_log
  console.log('3. RECENT WOO SYNC LOGS')
  const recentLogs = await db
    .select({
      id: wooSyncLog.id,
      createdAt: wooSyncLog.createdAt,
      action: wooSyncLog.action,
      status: wooSyncLog.status,
      productId: wooSyncLog.productId,
      productSku: products.sku,
      error: wooSyncLog.error,
    })
    .from(wooSyncLog)
    .leftJoin(products, eq(wooSyncLog.productId, products.id))
    .orderBy(desc(wooSyncLog.createdAt))
    .limit(5)

  if (recentLogs.length === 0) {
    console.log('   No woo_sync_log entries yet.')
    console.log('   → Worker writes logs only when it pushes to a store. If no stores configured, no logs.\n')
  } else {
    recentLogs.forEach(l => {
      console.log(`   ${l.createdAt?.toISOString?.() ?? l.createdAt} | ${l.status} | ${l.productSku ?? l.productId} | ${l.error ?? '—'}`)
    })
    const has404 = recentLogs.some(l => l.error?.includes('rest_no_route') || l.error?.includes('404'))
    if (has404) {
      console.log('   ❌ HTTP 404 / rest_no_route: WordPress does not have the OB Inventory Sync plugin route.')
      console.log('   → Install and activate the ob-inventory-sync plugin on the WooCommerce site.')
      console.log('   → Flush permalinks: Settings → Permalinks → Save.\n')
    } else {
      console.log('')
    }
  }

  // 4. Redis / BullMQ queue
  console.log('4. REDIS / BULLMQ QUEUE (sync-woo-stock)')
  try {
    const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000 })
    await redis.ping()

    const prefix = 'bull:sync-woo-stock'
    const waitKey = `${prefix}:wait`
    const activeKey = `${prefix}:active`
    const completedKey = `${prefix}:completed`
    const failedKey = `${prefix}:failed`

    const [waitLen, activeLen, completedLen, failedLen] = await Promise.all([
      redis.llen(waitKey),
      redis.llen(activeKey),
      redis.zcard(completedKey),
      redis.zcard(failedKey),
    ])

    console.log(`   Redis: ✓ connected (${REDIS_URL})`)
    console.log(`   Jobs waiting:  ${waitLen}`)
    console.log(`   Jobs active:  ${activeLen}`)
    console.log(`   Jobs completed (recent): ${completedLen}`)
    console.log(`   Jobs failed:   ${failedLen}`)

    if (waitLen > 0) {
      console.log('   ⚠ Jobs are waiting — worker may not be running or is overloaded.')
    }
    if (activeLen > 0) {
      console.log('   → Worker is processing jobs.')
    }
    if (waitLen === 0 && activeLen === 0 && completedLen === 0 && recentLogs.length === 0 && configuredStores.length > 0) {
      console.log('   ⚠ No jobs in queue and no logs. Either no adjustment was made in main warehouse, or worker never ran.')
    }
    if (failedLen > 0) {
      console.log('   ℹ Failed jobs auto-removed after 1 day or when 500+ failed (queue policy).')
    }

    await redis.quit()
    console.log('')
  } catch (err) {
    console.log(`   ❌ Redis error: ${(err as Error).message}`)
    console.log(`   → Check REDIS_URL (${REDIS_URL}). API and worker must use same Redis.\n`)
  }

  // 5. Worker process (best-effort)
  console.log('5. WORKER PROCESS')
  console.log('   Run: pnpm dev:worker  (or ensure worker container is up in Docker)')
  console.log('   Worker logs: [sync-woo-stock] Job X completed | No WooCommerce stores configured\n')

  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Summary')
  console.log('═══════════════════════════════════════════════════════════')
  const ok = mainWh.length > 0 && configuredStores.length > 0
  if (ok) {
    console.log('  ✓ Main warehouse and stores configured. Sync should work if worker is running.')
  } else {
    const issues: string[] = []
    if (mainWh.length === 0) issues.push('No main warehouse')
    if (configuredStores.length === 0) issues.push('No store with URL + Secret Token')
    console.log(`  ❌ Issues: ${issues.join(', ')}`)
  }
  console.log('')
}

main().catch((err) => {
  console.error('Diagnostic failed:', err)
  process.exit(1)
})
