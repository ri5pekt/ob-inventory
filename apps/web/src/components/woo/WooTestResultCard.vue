<template>
  <div>
    <!-- Idle -->
    <div v-if="testState === 'idle'" class="status-idle">
      <div class="status-dot dot-grey"></div>
      <span class="status-text">Not tested yet</span>
    </div>

    <!-- Loading -->
    <div v-else-if="testState === 'loading'" class="status-idle">
      <i class="pi pi-spin pi-spinner status-spinner"></i>
      <span class="status-text">Testing both directions…</span>
    </div>

    <!-- Results -->
    <div v-else class="directions-grid">

      <!-- Inventory → WooCommerce -->
      <div class="direction-card" :class="result?.forward.success ? 'dir-ok' : 'dir-fail'">
        <div class="dir-header">
          <div class="dir-dot" :class="result?.forward.success ? 'dot-green' : 'dot-red'"></div>
          <div class="dir-title">
            <span class="dir-label">OB Inventory → WooCommerce</span>
            <span class="dir-status" :class="result?.forward.success ? 'txt-green' : 'txt-red'">
              {{ result?.forward.success ? 'Connected' : 'Failed' }}
            </span>
          </div>
        </div>
        <div v-if="result?.forward.success && result.forward.data" class="info-grid">
          <div class="info-row"><span class="info-label">Site</span><span class="info-value">{{ result.forward.data.site }}</span></div>
          <div class="info-row"><span class="info-label">WooCommerce</span><span class="info-value">v{{ result.forward.data.wc_version ?? 'N/A' }}</span></div>
          <div class="info-row"><span class="info-label">WordPress</span><span class="info-value">v{{ result.forward.data.wp_version }}</span></div>
          <div class="info-row"><span class="info-label">Plugin</span><span class="info-value">{{ result.forward.data.plugin }} v{{ result.forward.data.version }}</span></div>
          <div class="info-row"><span class="info-label">Checked at</span><span class="info-value">{{ formatTime(result.forward.data.timestamp) }}</span></div>
        </div>
        <div v-else-if="result?.forward.error" class="dir-error-msg">{{ result.forward.error }}</div>
      </div>

      <!-- WooCommerce → Inventory -->
      <div class="direction-card" :class="result?.reverse.success ? 'dir-ok' : 'dir-fail'">
        <div class="dir-header">
          <div class="dir-dot" :class="result?.reverse.success ? 'dot-green' : 'dot-red'"></div>
          <div class="dir-title">
            <span class="dir-label">WooCommerce → OB Inventory</span>
            <span class="dir-status" :class="result?.reverse.success ? 'txt-green' : 'txt-red'">
              {{ result?.reverse.success ? 'Connected' : 'Failed' }}
            </span>
          </div>
        </div>
        <div v-if="result?.reverse.success && result.reverse.data" class="info-grid">
          <div class="info-row"><span class="info-label">Reached URL</span><span class="info-value url-value">{{ result.reverse.data.ob_url }}</span></div>
          <div class="info-row">
            <span class="info-label">Database</span>
            <span class="info-value" :class="result.reverse.data.ob_db === 'ok' ? 'txt-green' : 'txt-red'">{{ result.reverse.data.ob_db ?? '—' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Redis</span>
            <span class="info-value" :class="result.reverse.data.ob_redis === 'ok' ? 'txt-green' : 'txt-red'">{{ result.reverse.data.ob_redis ?? '—' }}</span>
          </div>
          <div class="info-row"><span class="info-label">Checked at</span><span class="info-value">{{ formatTime(result.reverse.data.reached_at) }}</span></div>
        </div>
        <div v-else-if="result?.reverse.error" class="dir-error-msg">{{ result.reverse.error }}</div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import type { WooTestResult } from '@/api/stores'

defineProps<{
  testState: 'idle' | 'loading' | 'success' | 'error'
  result:    WooTestResult | null
}>()

function formatTime(iso?: string): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString() } catch { return iso }
}
</script>

<style scoped>
.status-idle { display: flex; align-items: flex-start; gap: 12px; }
.status-spinner { font-size: 16px; color: #0891b2; margin-top: 2px; }
.status-text    { font-size: 14px; font-weight: 500; color: #475569; }

.directions-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
@media (max-width: 640px) { .directions-grid { grid-template-columns: 1fr; } }

.direction-card { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
.direction-card.dir-ok   { border-color: #bbf7d0; }
.direction-card.dir-fail { border-color: #fecaca; }

.dir-header { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; background: #f8fafc; }
.direction-card.dir-ok   .dir-header { background: #f0fdf4; }
.direction-card.dir-fail .dir-header { background: #fff5f5; }

.dir-dot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; margin-top: 4px; }
.dot-grey  { background: #cbd5e1; }
.dot-green { background: #22c55e; box-shadow: 0 0 0 3px #dcfce7; }
.dot-red   { background: #ef4444; box-shadow: 0 0 0 3px #fee2e2; }

.dir-title  { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dir-label  { font-size: 12px; font-weight: 600; color: #374151; }
.dir-status { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.txt-green  { color: #15803d; }
.txt-red    { color: #b91c1c; }

.info-grid  { display: flex; flex-direction: column; gap: 3px; padding: 10px 14px; }
.info-row   { display: flex; gap: 10px; font-size: 12px; }
.info-label { color: #94a3b8; min-width: 90px; font-weight: 500; flex-shrink: 0; }
.info-value { color: #334155; word-break: break-all; }
.url-value  { font-size: 11px; color: #0891b2; }

.dir-error-msg { font-size: 12px; color: #b91c1c; padding: 8px 14px 12px; line-height: 1.5; }
</style>
