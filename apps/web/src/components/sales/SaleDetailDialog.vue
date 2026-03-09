<template>
  <Dialog
    :visible="visible"
    modal
    :header="dialogHeader"
    :style="{ width: '680px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @update:visible="$emit('update:visible', $event)"
  >
    <div v-if="sale" class="detail-body">
      <div class="detail-meta">
        <div class="meta-row">
          <span class="meta-label">Type</span>
          <Tag :value="typeLabel(sale.saleType)" :severity="typeSeverity(sale.saleType)" />
        </div>
        <div class="meta-row">
          <span class="meta-label">Status</span>
          <Tag :value="sale.status" :severity="statusSeverity(sale.status)" />
        </div>
        <div v-if="sale.warehouseName" class="meta-row">
          <span class="meta-label">Warehouse</span>
          <span>{{ sale.warehouseName }}</span>
        </div>
        <div v-if="sale.wooOrderId" class="meta-row">
          <span class="meta-label">Woo Order</span>
          <span>#{{ sale.wooOrderId }}</span>
        </div>
        <div v-if="sale.customerName || sale.customerEmail" class="meta-row">
          <span class="meta-label">Customer</span>
          <span>{{ sale.customerName }}<span v-if="sale.customerEmail"> ({{ sale.customerEmail }})</span></span>
        </div>
        <div v-if="sale.customerPhone" class="meta-row">
          <span class="meta-label">Phone</span>
          <span>{{ sale.customerPhone }}</span>
        </div>
        <div v-if="sale.customerAddress" class="meta-row">
          <span class="meta-label">Address</span>
          <span>{{ sale.customerAddress }}</span>
        </div>
        <div v-if="sale.totalPrice" class="meta-row">
          <span class="meta-label">Total</span>
          <span class="detail-total">{{ parseFloat(sale.totalPrice).toFixed(2) }} {{ sale.currency }}</span>
        </div>
        <div class="meta-row">
          <span class="meta-label">Date</span>
          <span>{{ formatDate(sale.createdAt) }}</span>
        </div>
        <div v-if="sale.notes" class="meta-row">
          <span class="meta-label">Notes</span>
          <span>{{ sale.notes }}</span>
        </div>
      </div>

      <div class="detail-items">
        <h4>Items</h4>
        <DataTable :value="sale.items ?? []" size="small" striped-rows>
          <Column field="sku"       header="SKU"        style="width:110px" />
          <Column field="name"      header="Product" />
          <Column field="quantity"  header="Qty"        style="width:60px; text-align:right" />
          <Column field="unitPrice" header="Unit Price" style="width:100px; text-align:right">
            <template #body="{ data }">
              {{ data.unitPrice ? parseFloat(data.unitPrice).toFixed(2) : '—' }}
            </template>
          </Column>
          <Column field="lineTotal" header="Total"      style="width:100px; text-align:right">
            <template #body="{ data }">
              {{ data.lineTotal ? parseFloat(data.lineTotal).toFixed(2) : '—' }}
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <div v-else class="loading-detail">
      <i class="pi pi-spin pi-spinner" />
    </div>

    <template #footer>
      <div class="detail-footer">
        <Button
          label="Delete Sale"
          icon="pi pi-trash"
          severity="danger"
          outlined
          size="small"
          :disabled="!sale"
          @click="showConfirm = true"
        />
        <Button label="Close" severity="secondary" outlined size="small" @click="$emit('update:visible', false)" />
      </div>
    </template>
  </Dialog>

  <!-- Delete confirmation -->
  <Dialog
    v-model:visible="showConfirm"
    modal
    header="Delete Sale"
    :style="{ width: '400px' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    :closable="!deleting"
  >
    <div class="confirm-body">
      <i class="pi pi-exclamation-triangle confirm-icon" />
      <p>Are you sure you want to delete this sale?</p>
      <p class="confirm-sub">Stock will be restored for all matched products and a return entry will be added to the inventory log.</p>
      <div class="confirm-reason">
        <label class="reason-label">Reason <span class="reason-optional">(optional)</span></label>
        <Textarea
          v-model="deleteReason"
          rows="2"
          placeholder="e.g. Customer cancelled, duplicate entry…"
          fluid
          :disabled="deleting"
        />
      </div>
      <Message v-if="deleteError" severity="error" :closable="false" class="confirm-error">{{ deleteError }}</Message>
    </div>
    <template #footer>
      <div class="delete-confirm-footer">
        <Button label="Cancel" severity="secondary" outlined :disabled="deleting" @click="showConfirm = false" />
        <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deleting" @click="confirmDelete" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { SaleDetail, SaleType } from '@/api/sales'
import { deleteSale } from '@/api/sales'

const props = defineProps<{
  visible: boolean
  sale: SaleDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'deleted'): void
}>()

const showConfirm = ref(false)
const deleting    = ref(false)
const deleteError = ref<string | null>(null)
const deleteReason = ref('')

async function confirmDelete() {
  if (!props.sale) return
  deleting.value = true
  deleteError.value = null
  try {
    await deleteSale(props.sale.id, deleteReason.value.trim() || undefined)
    showConfirm.value = false
    deleteReason.value = ''
    emit('update:visible', false)
    emit('deleted')
  } catch {
    deleteError.value = 'Failed to delete sale. Please try again.'
  } finally {
    deleting.value = false
  }
}

const dialogHeader = computed<string>(() => {
  if (!props.sale) return 'Sale Details'
  const type = typeLabel(props.sale.saleType)
  const ref  = props.sale.wooOrderId ? ` — Order #${props.sale.wooOrderId}` : ''
  return `${type} Sale${ref}`
})

function typeLabel(type: SaleType) {
  return type === 'woocommerce' ? 'WooCommerce' : type === 'partner' ? 'Partner' : 'Direct'
}

function typeSeverity(type: SaleType) {
  if (type === 'woocommerce') return 'info'
  if (type === 'partner')     return 'warn'
  return 'success'
}

function statusSeverity(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'danger'
  return 'secondary'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.detail-body { display: flex; flex-direction: column; gap: 20px; }

.detail-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 14px 16px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}

.meta-label {
  width: 90px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.detail-total {
  font-weight: 700;
  font-size: 16px;
  color: var(--p-primary-color);
}

.detail-items h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.loading-detail {
  display: flex;
  justify-content: center;
  padding: 40px;
  font-size: 24px;
  color: var(--p-primary-color);
}

.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 768px) {
  .detail-footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .detail-footer .p-button {
    width: 100%;
    justify-content: center;
  }

  .detail-meta { padding: 12px; }
  .meta-row { font-size: 13px; }
  .meta-label { width: 80px; }

  .loading-detail { padding: 24px; font-size: 20px; }
}

.confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  text-align: center;
}

.confirm-icon {
  font-size: 36px;
  color: var(--p-red-500);
}

.confirm-body p { margin: 0; font-size: 15px; }

.confirm-sub {
  font-size: 13px;
  color: var(--p-text-muted-color);
}

.confirm-reason {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  text-align: left;
}

.reason-label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.reason-optional {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.confirm-error { width: 100%; }

.delete-confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

@media (max-width: 768px) {
  .delete-confirm-footer {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .delete-confirm-footer .p-button {
    width: 100%;
    justify-content: center;
  }
}
</style>
