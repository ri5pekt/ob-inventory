<template>
  <Dialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    modal
    :header="dialogHeader"
    :style="{ width: '640px', maxWidth: '95vw' }"
  >
    <div v-if="transfer" class="detail-body">
      <div class="detail-meta">
        <div class="route-display">
          <span class="wh-badge wh-from lg">{{ transfer.fromWarehouseName ?? '—' }}</span>
          <i class="pi pi-arrow-right route-arrow lg" />
          <span class="wh-badge wh-to lg">{{ transfer.toWarehouseName ?? '—' }}</span>
        </div>
        <div class="meta-grid">
          <div class="meta-item">
            <span class="meta-label">Date</span>
            <span>{{ formatDate(transfer.createdAt) }}</span>
          </div>
          <div v-if="transfer.reference" class="meta-item">
            <span class="meta-label">Reference</span>
            <span class="ref-text">{{ transfer.reference }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">Status</span>
            <Tag :value="transfer.status" :severity="transfer.status === 'completed' ? 'success' : 'danger'" />
          </div>
          <div v-if="transfer.notes" class="meta-item">
            <span class="meta-label">Notes</span>
            <span>{{ transfer.notes }}</span>
          </div>
        </div>
      </div>

      <div class="detail-items">
        <h4>Transferred Items</h4>
        <DataTable :value="transfer.items" size="small" striped-rows>
          <Column field="sku"      header="SKU"     style="width: 120px" />
          <Column field="name"     header="Product" />
          <Column field="quantity" header="Qty"     style="width: 70px; text-align:right">
            <template #body="{ data }">
              <span class="qty-badge">{{ data.quantity }}</span>
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
          label="Delete Transfer"
          icon="pi pi-trash"
          severity="danger"
          outlined
          size="small"
          :disabled="!transfer"
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
    header="Delete Transfer"
    :style="{ width: '400px' }"
    :closable="!deleting"
  >
    <div class="confirm-body">
      <i class="pi pi-exclamation-triangle confirm-icon" />
      <p>Are you sure you want to delete this transfer?</p>
      <p class="confirm-sub">Stock will be reversed — quantities returned to the source warehouse and removed from the destination. Ledger entries will be added.</p>
      <div class="confirm-reason">
        <label class="reason-label">Reason <span class="reason-optional">(optional)</span></label>
        <Textarea
          v-model="deleteReason"
          rows="2"
          placeholder="e.g. Transfer created by mistake…"
          fluid
          :disabled="deleting"
        />
      </div>
      <Message v-if="deleteError" severity="error" :closable="false" class="confirm-error">{{ deleteError }}</Message>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" outlined :disabled="deleting" @click="showConfirm = false" />
      <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deleting" @click="confirmDelete" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Dialog    from 'primevue/dialog'
import DataTable from 'primevue/datatable'
import Column    from 'primevue/column'
import type { TransferDetail } from '@/api/transfers'
import { deleteTransfer } from '@/api/transfers'

const props = defineProps<{
  visible:  boolean
  transfer: TransferDetail | null
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
  'deleted': []
}>()

const showConfirm  = ref(false)
const deleting     = ref(false)
const deleteError  = ref<string | null>(null)
const deleteReason = ref('')

async function confirmDelete() {
  if (!props.transfer) return
  deleting.value = true
  deleteError.value = null
  try {
    await deleteTransfer(props.transfer.id, deleteReason.value.trim() || undefined)
    showConfirm.value = false
    deleteReason.value = ''
    emit('update:visible', false)
    emit('deleted')
  } catch {
    deleteError.value = 'Failed to delete transfer. Please try again.'
  } finally {
    deleting.value = false
  }
}

const dialogHeader = computed(() => {
  if (!props.transfer) return 'Transfer Details'
  const ref = props.transfer.reference ? ` — ${props.transfer.reference}` : ''
  return `${props.transfer.fromWarehouseName} → ${props.transfer.toWarehouseName}${ref}`
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.detail-body { display: flex; flex-direction: column; gap: 18px; }

.detail-meta {
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px; padding: 16px;
  display: flex; flex-direction: column; gap: 14px;
}

.route-display { display: flex; align-items: center; gap: 10px; }

.meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.meta-item { display: flex; flex-direction: column; gap: 3px; font-size: 14px; }
.meta-label {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.4px; color: var(--p-text-muted-color);
}

.wh-badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 6px; white-space: nowrap; }
.wh-badge.lg { font-size: 14px; padding: 5px 14px; }
.wh-from { background: var(--p-orange-50, #fff7ed); color: var(--p-orange-700, #c2410c); }
.wh-to   { background: var(--p-green-50,  #f0fdf4); color: var(--p-green-700,  #15803d); }
.route-arrow    { color: var(--p-text-muted-color); font-size: 12px; }
.route-arrow.lg { font-size: 16px; color: var(--p-primary-color); }

.ref-text { font-family: monospace; font-size: 12px; color: var(--p-primary-color); }

.detail-items h4 {
  margin: 0 0 10px; font-size: 12px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.4px; color: var(--p-text-muted-color);
}
.qty-badge { font-weight: 700; color: var(--p-primary-color); }

.loading-detail { display: flex; justify-content: center; padding: 40px; font-size: 24px; color: var(--p-primary-color); }

.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  text-align: center;
}

.confirm-icon { font-size: 36px; color: var(--p-red-500); }
.confirm-body p { margin: 0; font-size: 15px; }
.confirm-sub { font-size: 13px; color: var(--p-text-muted-color); }

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

.reason-optional { font-weight: 400; text-transform: none; letter-spacing: 0; }
.confirm-error { width: 100%; }
</style>
