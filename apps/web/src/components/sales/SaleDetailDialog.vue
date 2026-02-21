<template>
  <Dialog
    :visible="visible"
    modal
    :header="dialogHeader"
    :style="{ width: '680px', maxWidth: '95vw' }"
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
        <div v-if="sale.customerName" class="meta-row">
          <span class="meta-label">Customer</span>
          <span>{{ sale.customerName }}<span v-if="sale.customerEmail"> ({{ sale.customerEmail }})</span></span>
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
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SaleDetail, SaleType } from '@/api/sales'

const props = defineProps<{
  visible: boolean
  sale: SaleDetail | null
}>()

defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const dialogHeader = computed(() => {
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
</style>
