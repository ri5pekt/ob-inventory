<template>
  <Dialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    modal
    :header="customer ? customer.name : 'Customer Details'"
    :style="{ width: '560px', maxWidth: '95vw' }"
  >
    <div v-if="customer" class="detail-body">
      <!-- Contact info grid -->
      <div class="info-card">
        <div class="info-grid">
          <div v-if="customer.company" class="info-item">
            <span class="info-label">Company</span>
            <span>{{ customer.company }}</span>
          </div>
          <div v-if="customer.email" class="info-item">
            <span class="info-label">Email</span>
            <a :href="`mailto:${customer.email}`" class="info-link">{{ customer.email }}</a>
          </div>
          <div v-if="customer.phone" class="info-item">
            <span class="info-label">Phone</span>
            <a :href="`tel:${customer.phone}`" class="info-link">{{ customer.phone }}</a>
          </div>
          <div v-if="customer.idNumber" class="info-item">
            <span class="info-label">ID / ח.פ.</span>
            <span class="id-text">{{ customer.idNumber }}</span>
          </div>
          <div v-if="customer.address" class="info-item info-item-full">
            <span class="info-label">Address</span>
            <span>{{ customer.address }}</span>
          </div>
          <div v-if="customer.notes" class="info-item info-item-full">
            <span class="info-label">Notes</span>
            <span class="notes-text">{{ customer.notes }}</span>
          </div>
          <div class="info-item">
            <span class="info-label">Added</span>
            <span class="date-text">{{ formatDate(customer.createdAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="loading-detail">
      <i class="pi pi-spin pi-spinner" />
    </div>

    <template #footer>
      <div class="detail-footer">
        <Button
          label="Delete"
          icon="pi pi-trash"
          severity="danger"
          outlined
          size="small"
          :disabled="!customer"
          @click="showConfirm = true"
        />
        <div class="footer-right">
          <Button label="Close" severity="secondary" outlined size="small" @click="$emit('update:visible', false)" />
          <Button
            label="Edit"
            icon="pi pi-pencil"
            size="small"
            :disabled="!customer"
            @click="$emit('edited', customer!)"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <!-- Delete confirmation -->
  <Dialog
    v-model:visible="showConfirm"
    modal
    header="Delete Customer"
    :style="{ width: '380px' }"
    :closable="!deleting"
  >
    <div class="confirm-body">
      <i class="pi pi-exclamation-triangle confirm-icon" />
      <p>Delete <strong>{{ customer?.name }}</strong>?</p>
      <p class="confirm-sub">This action cannot be undone.</p>
      <Message v-if="deleteError" severity="error" :closable="false" class="confirm-error">{{ deleteError }}</Message>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" outlined :disabled="deleting" @click="showConfirm = false" />
      <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deleting" @click="confirmDelete" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Customer } from '@/api/customers'
import { deleteCustomer } from '@/api/customers'

const props = defineProps<{
  visible:  boolean
  customer: Customer | null
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
  'deleted': []
  'edited': [customer: Customer]
}>()

const showConfirm = ref(false)
const deleting    = ref(false)
const deleteError = ref<string | null>(null)

async function confirmDelete() {
  if (!props.customer) return
  deleting.value = true
  deleteError.value = null
  try {
    await deleteCustomer(props.customer.id)
    showConfirm.value = false
    emit('update:visible', false)
    emit('deleted')
  } catch {
    deleteError.value = 'Failed to delete customer. Please try again.'
  } finally {
    deleting.value = false
  }
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.detail-body { display: flex; flex-direction: column; gap: 16px; }

.info-card {
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  padding: 16px;
}

.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 14px;
}

.info-item-full { grid-column: 1 / -1; }

.info-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.info-link {
  color: var(--p-primary-color);
  text-decoration: none;
  font-size: 14px;
}
.info-link:hover { text-decoration: underline; }

.id-text    { font-family: monospace; font-size: 13px; }
.date-text  { font-size: 13px; color: var(--p-text-muted-color); }
.notes-text { font-size: 13px; color: var(--p-text-muted-color); white-space: pre-wrap; }

.loading-detail { display: flex; justify-content: center; padding: 40px; font-size: 24px; color: var(--p-primary-color); }

.detail-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}
.footer-right { display: flex; gap: 8px; align-items: center; }

.confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  text-align: center;
}
.confirm-icon  { font-size: 36px; color: var(--p-red-500); }
.confirm-body p { margin: 0; font-size: 15px; }
.confirm-sub    { font-size: 13px; color: var(--p-text-muted-color); }
.confirm-error  { width: 100%; }
</style>
