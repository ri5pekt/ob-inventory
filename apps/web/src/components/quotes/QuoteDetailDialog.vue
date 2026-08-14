<template>
  <Dialog
    :visible="visible"
    modal
    :header="quote ? `Quote #${quote.quoteNumber}` : 'Quote'"
    :style="{ width: '680px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @update:visible="$emit('update:visible', $event)"
  >
    <div v-if="quote" class="detail-body">
      <div class="detail-meta">
        <div class="meta-row">
          <span class="meta-label">Status</span>
          <Tag :value="statusLabel(quote.status)" :severity="statusSeverity(quote.status)" />
        </div>
        <div v-if="quote.warehouseName" class="meta-row">
          <span class="meta-label">Warehouse</span>
          <span>{{ quote.warehouseName }}</span>
        </div>
        <div v-if="quote.customerName || quote.customerEmail" class="meta-row">
          <span class="meta-label">Customer</span>
          <span>{{ quote.customerName }}<span v-if="quote.customerEmail"> ({{ quote.customerEmail }})</span></span>
        </div>
        <div v-if="quote.customerPhone" class="meta-row">
          <span class="meta-label">Phone</span>
          <span>{{ quote.customerPhone }}</span>
        </div>
        <div v-if="quote.customerIdNumber" class="meta-row">
          <span class="meta-label">ID / ח.פ.</span>
          <span>{{ quote.customerIdNumber }}</span>
        </div>
        <div v-if="quote.customerAddress" class="meta-row">
          <span class="meta-label">Address</span>
          <span>{{ quote.customerAddress }}</span>
        </div>
        <div v-if="quote.totalPrice" class="meta-row">
          <span class="meta-label">Total</span>
          <span class="detail-total">{{ parseFloat(quote.totalPrice).toFixed(2) }} {{ quote.currency }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Date</span>
          <span>{{ formatDate(quote.quoteDate) }}</span>
        </div>
        <div v-if="quote.createdByName" class="meta-row">
          <span class="meta-label">Created by</span>
          <span>{{ quote.createdByName }}</span>
        </div>
        <div v-if="quote.convertedSaleId" class="meta-row">
          <span class="meta-label">Sale</span>
          <button class="sale-link" @click="$emit('open-sale', quote.convertedSaleId!)">
            Open converted sale
          </button>
        </div>
        <div v-if="quote.notes" class="meta-row meta-row-notes">
          <span class="meta-label">Notes</span>
          <span class="notes-text">{{ quote.notes }}</span>
        </div>
      </div>

      <div class="detail-items">
        <h4>Items</h4>
        <DataTable :value="quote.items ?? []" size="small" striped-rows>
          <Column field="sku" header="SKU" style="width:90px">
            <template #body="{ data }"><span class="cell-sku">{{ data.sku }}</span></template>
          </Column>
          <Column field="name" header="Product">
            <template #body="{ data }"><span class="cell-name">{{ data.name }}</span></template>
          </Column>
          <Column field="quantity" header="Qty" style="width:60px; text-align:right" />
          <Column field="unitPrice" header="Unit Price" style="width:100px; text-align:right">
            <template #body="{ data }">{{ data.unitPrice ? parseFloat(data.unitPrice).toFixed(2) : '—' }}</template>
          </Column>
          <Column field="lineTotal" header="Total" style="width:100px; text-align:right">
            <template #body="{ data }">{{ data.lineTotal ? parseFloat(data.lineTotal).toFixed(2) : '—' }}</template>
          </Column>
        </DataTable>
      </div>
    </div>
    <div v-else class="loading-detail"><i class="pi pi-spin pi-spinner" /></div>

    <template #footer>
      <div class="detail-footer">
        <Button
          v-if="quote?.status === 'open'"
          label="Cancel quote"
          icon="pi pi-times"
          severity="danger"
          outlined
          size="small"
          :disabled="busy"
          @click="showCancel = true"
        />
        <div class="footer-right">
          <Button
            label="PDF"
            icon="pi pi-file-pdf"
            severity="danger"
            outlined
            size="small"
            :disabled="!quote"
            :loading="pdfLoading"
            @click="downloadPdf"
          />
          <Button
            v-if="quote?.status === 'open'"
            label="Edit"
            icon="pi pi-pencil"
            size="small"
            outlined
            :disabled="busy"
            @click="$emit('edit', quote!)"
          />
          <Button
            v-if="quote?.status === 'open'"
            label="Convert to Sale"
            icon="pi pi-shopping-cart"
            size="small"
            :disabled="busy"
            @click="showConvert = true"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <Dialog v-model:visible="showCancel" modal header="Cancel Quote" :style="{ width: '400px' }" :closable="!busy">
    <p>Cancel quote #{{ quote?.quoteNumber }}? It will stay in the list as cancelled. Stock is unchanged.</p>
    <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>
    <template #footer>
      <Button label="Keep" severity="secondary" outlined :disabled="busy" @click="showCancel = false" />
      <Button label="Cancel quote" severity="danger" :loading="busy" @click="doCancel" />
    </template>
  </Dialog>

  <Dialog v-model:visible="showConvert" modal header="Convert to Sale" :style="{ width: '440px' }" :closable="!busy">
    <p>Create a direct sale from quote #{{ quote?.quoteNumber }}? Stock will be reduced the same way as a normal sale.</p>
    <Message v-if="insufficientItems.length" severity="warn" :closable="false">
      <strong>Insufficient stock:</strong>
      <ul>
        <li v-for="it in insufficientItems" :key="it.sku">
          {{ it.sku }} — requested {{ it.requested }}, available {{ it.available }}
        </li>
      </ul>
    </Message>
    <Message v-if="actionError" severity="error" :closable="false">{{ actionError }}</Message>
    <template #footer>
      <Button label="Back" severity="secondary" outlined :disabled="busy" @click="showConvert = false" />
      <Button label="Convert & reduce stock" icon="pi pi-check" :loading="busy" @click="doConvert" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { QuoteDetail, QuoteStatus } from '@/api/quotes'
import { cancelQuote, convertQuote } from '@/api/quotes'
import { downloadQuotePdf } from '@/utils/quotePdf'

const props = defineProps<{
  visible: boolean
  quote: QuoteDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'edit', quote: QuoteDetail): void
  (e: 'changed'): void
  (e: 'converted', saleId: string): void
  (e: 'open-sale', saleId: string): void
}>()

const pdfLoading = ref(false)
const busy = ref(false)
const showCancel = ref(false)
const showConvert = ref(false)
const actionError = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])

function statusLabel(status: QuoteStatus) {
  if (status === 'converted') return 'Converted'
  if (status === 'cancelled') return 'Cancelled'
  return 'Open'
}
function statusSeverity(status: QuoteStatus) {
  if (status === 'converted') return 'success'
  if (status === 'cancelled') return 'secondary'
  return 'info'
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

async function downloadPdf() {
  if (!props.quote) return
  pdfLoading.value = true
  try { await downloadQuotePdf(props.quote) }
  finally { pdfLoading.value = false }
}

async function doCancel() {
  if (!props.quote) return
  busy.value = true
  actionError.value = null
  try {
    await cancelQuote(props.quote.id)
    showCancel.value = false
    emit('changed')
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } } }
    actionError.value = axiosErr.response?.data?.error ?? 'Failed to cancel quote'
  } finally {
    busy.value = false
  }
}

async function doConvert() {
  if (!props.quote) return
  busy.value = true
  actionError.value = null
  insufficientItems.value = []
  try {
    const result = await convertQuote(props.quote.id)
    showConvert.value = false
    emit('converted', result.saleId)
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string; code?: string; items?: typeof insufficientItems.value } } }
    if (axiosErr.response?.data?.code === 'INSUFFICIENT_STOCK') {
      insufficientItems.value = axiosErr.response.data.items ?? []
    } else {
      actionError.value = axiosErr.response?.data?.error ?? 'Failed to convert quote'
    }
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.detail-body { display: flex; flex-direction: column; gap: 18px; }
.detail-meta { display: flex; flex-direction: column; gap: 8px; }
.meta-row { display: flex; gap: 12px; font-size: 14px; align-items: baseline; }
.meta-label {
  width: 88px;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}
.detail-total { font-weight: 700; color: var(--p-primary-color); }
.notes-text { white-space: pre-wrap; }
.sale-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--p-primary-color);
  font-weight: 600;
  cursor: pointer;
}
.sale-link:hover { text-decoration: underline; }
.detail-items h4 { margin: 0 0 8px; font-size: 13px; }
.cell-sku { font-family: ui-monospace, monospace; font-size: 12px; font-weight: 600; }
.loading-detail { display: flex; justify-content: center; padding: 32px; }
.detail-footer { display: flex; justify-content: space-between; width: 100%; gap: 8px; }
.footer-right { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 600px) {
  .meta-row { flex-direction: column; gap: 2px; }
  .meta-label { width: auto; }
  .detail-footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  .footer-right {
    width: 100%;
    flex-direction: column-reverse;
  }
  .detail-footer :deep(.p-button) {
    width: 100%;
    justify-content: center;
  }
}
</style>
