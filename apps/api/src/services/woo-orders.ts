import { db } from '../db.js'
import { wooSyncLog } from '@ob-inventory/db'

export interface WooCancelResult {
  ok:     boolean
  status: 'success' | 'failed'
  error:  string | null
}

/**
 * Cancels a WooCommerce order via the "OB Inventory Sync" plugin's
 * PUT /wp-json/ob-inventory/v1/orders/{id}/cancel endpoint.
 *
 * Best-effort: callers should treat failures as non-fatal warnings, not
 * roll back local state. Every attempt is logged to woo_sync_log for audit.
 */
export async function cancelWooOrder(
  store:      { id: string; url: string; secretToken: string },
  wooOrderId: string,
  reason?:    string,
): Promise<WooCancelResult> {
  const baseUrl = store.url.replace(/\/$/, '')
  const url = `${baseUrl}/wp-json/ob-inventory/v1/orders/${encodeURIComponent(wooOrderId)}/cancel`
  const payload = { reason: reason ?? 'Converted to stock transfer in OB Inventory' }

  let responseBody: unknown = null
  let error: string | null = null

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${store.secretToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    })

    const text = await res.text()
    try {
      responseBody = text ? JSON.parse(text) : null
    } catch {
      responseBody = { status: res.status, body: text }
    }

    if (!res.ok) {
      const body = responseBody as { error?: unknown; message?: unknown } | null
      const errMsg = body?.error ?? body?.message
      error = errMsg
        ? `HTTP ${res.status}: ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`
        : `HTTP ${res.status}: ${text}`
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const status = error ? 'failed' : 'success'

  await db.insert(wooSyncLog).values({
    productId: null,
    action:    'cancel_order',
    status,
    payload:   { ...payload, wooOrderId, storeId: store.id },
    response:  responseBody,
    error,
    attempts:  1,
    completedAt: new Date(),
  })

  return { ok: !error, status, error }
}
