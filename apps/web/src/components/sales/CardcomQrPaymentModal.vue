<template>
  <Dialog
    :visible="visible"
    modal
    header="Request Payment (QR)"
    :style="{ width: '460px', maxWidth: '96vw' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)' }"
    :closable="!busy"
    @update:visible="onDialogVisibleChange"
  >
    <!-- SUCCESS STATE -->
    <div v-if="result" class="qr-success">
      <div class="success-icon"><i class="pi pi-check-circle" /></div>
      <p class="success-title">Payment successful!</p>
      <div class="success-details">
        <div class="detail-row">
          <span class="detail-label">Card</span>
          <span>{{ result.cardBrand }} ****{{ result.last4Digits }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Document</span>
          <span>Tax Invoice &amp; Receipt #{{ result.documentNumber }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount</span>
          <span>{{ formatAmount(totalAmount) }} ₪</span>
        </div>
      </div>
      <a v-if="result.docUrl" :href="result.docUrl" target="_blank" rel="noopener" class="pdf-link">
        <i class="pi pi-file-pdf" /> Download Invoice PDF
      </a>
    </div>

    <!-- EXPIRED / FAILED / CANCELLED STATE -->
    <div v-else-if="terminalState" class="qr-terminal">
      <i :class="terminalIcon" class="terminal-icon" />
      <p class="terminal-title">{{ terminalTitle }}</p>
      <p class="terminal-sub">{{ terminalSub }}</p>
    </div>

    <!-- ERROR CREATING REQUEST -->
    <div v-else-if="error" class="qr-terminal">
      <i class="pi pi-exclamation-triangle terminal-icon terminal-icon-error" />
      <p class="terminal-title">Couldn't create QR code</p>
      <p class="terminal-sub">{{ error }}</p>
    </div>

    <!-- LOADING / QR STATE -->
    <div v-else class="qr-active">
      <div class="info-row">
        <span class="info-label">Amount to charge</span>
        <span class="info-value">{{ formatAmount(totalAmount) }} ₪</span>
      </div>

      <div v-if="loading" class="qr-loading">
        <i class="pi pi-spin pi-spinner" />
        <span>Generating QR code…</span>
      </div>

      <div v-else-if="qrDataUrl" class="qr-code-wrap">
        <img :src="qrDataUrl" alt="Scan to pay" class="qr-code-img" />
        <p class="qr-hint">Scan with a phone camera to pay securely on Cardcom's page</p>
      </div>
    </div>

    <template #footer>
      <div v-if="result" class="footer-done">
        <Button label="Close" @click="close" />
      </div>
      <div v-else-if="terminalState" class="footer-actions">
        <Button label="Close" severity="secondary" outlined @click="close" />
        <Button label="Generate new QR code" icon="pi pi-refresh" @click="createRequest" />
      </div>
      <div v-else-if="error" class="footer-actions">
        <Button label="Close" severity="secondary" outlined @click="close" />
        <Button label="Try again" icon="pi pi-refresh" @click="createRequest" />
      </div>
      <div v-else class="footer-actions">
        <Button label="Cancel" severity="secondary" outlined :disabled="cancelling" :loading="cancelling" @click="cancelRequest" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import QRCode from 'qrcode'
import {
  createQrPaymentRequest,
  getQrPaymentStatus,
  cancelQrPaymentRequest,
  type QrPaymentStatusResult,
} from '@/api/invoices'
import type { SaleDetail } from '@/api/sales'

const props = defineProps<{
  visible: boolean
  sale:    SaleDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'charged', result: QrPaymentStatusResult): void
}>()

// ── State ─────────────────────────────────────────────────────────────────────

const loading    = ref(false)
const busy       = ref(false) // creating or cancelling — blocks the dialog's own X button
const cancelling = ref(false)
const error      = ref<string | null>(null)
const qrDataUrl  = ref<string | null>(null)
const requestId  = ref<string | null>(null)
const result     = ref<QrPaymentStatusResult | null>(null)
const terminalState = ref<'expired' | 'failed' | 'cancelled' | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null
let localTimeoutTimer: ReturnType<typeof setTimeout> | null = null

const POLL_INTERVAL_MS = 2_500
const LOCAL_TIMEOUT_MS = 10 * 60 * 1000 // belt-and-suspenders — matches the backend's own 10-minute expiry

// ── Computed ─────────────────────────────────────────────────────────────────

const saleItems = computed(() =>
  (props.sale?.items ?? []).map(i => ({
    name:      i.name,
    quantity:  i.quantity,
    unitPrice: parseFloat(i.unitPrice ?? '0'),
  })),
)

const totalAmount = computed(() =>
  saleItems.value.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0),
)

const terminalIcon = computed(() => {
  if (terminalState.value === 'failed') return 'pi pi-times-circle terminal-icon-error'
  return 'pi pi-clock terminal-icon-muted'
})

const terminalTitle = computed(() => {
  if (terminalState.value === 'expired')   return 'QR code expired'
  if (terminalState.value === 'failed')    return 'Payment failed'
  if (terminalState.value === 'cancelled') return 'Request cancelled'
  return ''
})

const terminalSub = computed(() => {
  if (terminalState.value === 'expired')   return 'The customer didn\u2019t complete payment in time.'
  if (terminalState.value === 'failed')    return 'Cardcom reported the transaction did not go through.'
  if (terminalState.value === 'cancelled') return 'This payment request was cancelled.'
  return ''
})

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(() => props.visible, (open) => {
  if (open) {
    reset()
    createRequest()
  } else {
    stopPolling()
  }
})

onBeforeUnmount(() => stopPolling())

// ── Methods ───────────────────────────────────────────────────────────────────

function reset() {
  loading.value       = false
  busy.value          = false
  cancelling.value    = false
  error.value         = null
  qrDataUrl.value      = null
  requestId.value      = null
  result.value         = null
  terminalState.value  = null
  stopPolling()
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (localTimeoutTimer) { clearTimeout(localTimeoutTimer); localTimeoutTimer = null }
}

async function createRequest() {
  if (!props.sale) return
  error.value        = null
  terminalState.value = null
  result.value        = null
  qrDataUrl.value      = null
  loading.value       = true
  busy.value          = true

  try {
    const req = await createQrPaymentRequest(props.sale.id, { items: saleItems.value })
    requestId.value = req.requestId
    qrDataUrl.value  = await QRCode.toDataURL(req.url, { width: 260, margin: 1 })
    startPolling()
  } catch (err: unknown) {
    const responseMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    error.value = responseMsg ?? (err instanceof Error ? err.message : 'Failed to create QR payment request')
    busy.value  = false
  } finally {
    loading.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(checkStatus, POLL_INTERVAL_MS)
  localTimeoutTimer = setTimeout(() => {
    if (!result.value && !terminalState.value) {
      terminalState.value = 'expired'
      busy.value = false
      stopPolling()
    }
  }, LOCAL_TIMEOUT_MS)
}

async function checkStatus() {
  if (!props.sale || !requestId.value) return
  try {
    const status = await getQrPaymentStatus(props.sale.id, requestId.value)
    if (status.status === 'pending') return

    stopPolling()
    busy.value = false

    if (status.status === 'paid' || status.status === 'paid_after_cancel') {
      result.value = status
      emit('charged', status)
    } else {
      terminalState.value = status.status === 'expired'   ? 'expired'
                          : status.status === 'cancelled'  ? 'cancelled'
                          : 'failed'
    }
  } catch {
    // Transient network hiccup — next poll tick will retry. Don't surface to the user.
  }
}

async function cancelRequest() {
  if (!props.sale || !requestId.value || cancelling.value) return
  cancelling.value = true
  try {
    await cancelQrPaymentRequest(props.sale.id, requestId.value)
    stopPolling()
    close()
  } catch {
    // If cancel fails (e.g. already paid), the next poll tick will reflect the real state.
  } finally {
    cancelling.value = false
  }
}

function formatAmount(n: number) {
  return n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function onDialogVisibleChange(v: boolean) {
  if (!v && busy.value && !result.value) return // ignore stray close while a request is in flight
  emit('update:visible', v)
}

function close() {
  emit('update:visible', false)
}
</script>

<style scoped>
.info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--p-surface-50, #f8f9fa);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  margin-bottom: 1rem;
}
.info-label { color: var(--p-text-muted-color, #6c757d); font-size: 0.875rem; }
.info-value { font-size: 1.1rem; font-weight: 700; color: var(--p-primary-color); }

.qr-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2.5rem 0;
  color: var(--p-text-muted-color, #6c757d);
}

.qr-code-wrap { display: flex; flex-direction: column; align-items: center; gap: 0.75rem; }
.qr-code-img { width: 260px; height: 260px; border-radius: 8px; }
.qr-hint { font-size: 0.85rem; color: var(--p-text-muted-color, #6c757d); text-align: center; margin: 0; }

.qr-terminal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.5rem 0;
  text-align: center;
}
.terminal-icon { font-size: 2.75rem; }
.terminal-icon-error  { color: var(--p-red-500, #ef4444); }
.terminal-icon-muted  { color: var(--p-orange-500, #f59e0b); }
.terminal-title { font-size: 1.05rem; font-weight: 700; margin: 0; }
.terminal-sub   { font-size: 0.875rem; color: var(--p-text-muted-color, #6c757d); margin: 0; }

/* Success — same layout convention as CardcomTerminalModal.vue */
.qr-success {
  display: flex; flex-direction: column; align-items: center;
  gap: 1rem; padding: 1rem 0;
}
.success-icon { font-size: 3rem; color: var(--p-green-500, #22c55e); }
.success-title { font-size: 1.2rem; font-weight: 700; margin: 0; }
.success-details {
  width: 100%;
  background: var(--p-surface-50, #f8f9fa);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  display: flex; flex-direction: column; gap: 0.4rem;
}
.detail-row { display: flex; justify-content: space-between; }
.detail-label { color: var(--p-text-muted-color, #6c757d); font-size: 0.875rem; }
.pdf-link {
  display: flex; align-items: center; gap: 0.4rem;
  color: var(--p-primary-color); text-decoration: none; font-weight: 500;
}
.pdf-link:hover { text-decoration: underline; }

/* Footer */
.footer-actions { display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%; }
.footer-done    { display: flex; justify-content: flex-end; width: 100%; }
</style>
