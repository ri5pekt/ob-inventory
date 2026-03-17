<template>
  <Dialog
    :visible="visible"
    modal
    header="Cardcom Documents"
    :style="{ width: '620px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @update:visible="$emit('update:visible', $event)"
  >
    <!-- Missing customer name warning -->
    <Message v-if="!sale?.customerName" severity="warn" :closable="false" class="warning-msg">
      Customer name is missing on this sale — required to create any document.
    </Message>

    <!-- Loading -->
    <div v-if="loading" class="doc-loading">
      <i class="pi pi-spin pi-spinner" />
    </div>

    <!-- Documents list -->
    <div v-else class="doc-list">
      <div v-if="documents.length === 0" class="doc-empty">
        No documents created yet.
      </div>

      <div v-for="doc in documents" :key="doc.id" class="doc-row">
        <div class="doc-row-left">
          <span class="doc-type-badge">{{ typeLabel(doc.documentType) }}</span>
          <span class="doc-number">#{{ doc.documentNumber }}</span>
          <span class="doc-date">{{ formatDate(doc.createdAt) }}</span>
        </div>
        <a
          v-if="doc.docUrl"
          :href="doc.docUrl"
          target="_blank"
          rel="noopener"
          class="doc-download"
        >
          <i class="pi pi-file-pdf" /> PDF
        </a>
        <span v-else class="doc-no-url">—</span>
      </div>
    </div>

    <!-- Create buttons -->
    <div class="doc-create-section">
      <p class="doc-create-label">Create New Document</p>
      <div class="doc-create-buttons">
        <Button
          v-for="type in ALL_DOCUMENT_TYPES"
          :key="type"
          :label="typeLabel(type)"
          size="small"
          outlined
          :disabled="!sale?.customerName || (isPaymentRequired(type) && !sale?.totalPrice)"
          v-tooltip.top="getDisabledReason(type)"
          @click="openConfirm(type)"
        />
      </div>
    </div>

    <template #footer>
      <Button label="Close" severity="secondary" outlined size="small" @click="$emit('update:visible', false)" />
    </template>
  </Dialog>

  <!-- Confirmation dialog -->
  <Dialog
    v-model:visible="showConfirm"
    modal
    header="Create Document"
    :style="{ width: editMode ? '680px' : '440px', maxWidth: '98vw', transition: 'width 0.2s' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 8px)' }"
    :closable="!creating"
  >
    <div class="confirm-body">
      <!-- Summary -->
      <div class="confirm-meta">
        <div class="confirm-row">
          <span class="confirm-label">Document</span>
          <span class="confirm-value doc-type-badge">{{ typeLabel(pendingType) }}</span>
        </div>
        <div class="confirm-row">
          <span class="confirm-label">Customer</span>
          <span class="confirm-value">{{ editCustomerName || '—' }}</span>
        </div>
        <div v-if="editCustomerEmail" class="confirm-row">
          <span class="confirm-label">Email</span>
          <span class="confirm-value">{{ editCustomerEmail }}</span>
        </div>
        <div v-if="editTotalPrice && isPaymentRequired(pendingType)" class="confirm-row">
          <span class="confirm-label">Total</span>
          <span class="confirm-value confirm-total">{{ parseFloat(editTotalPrice).toFixed(2) }} {{ sale?.currency }}</span>
        </div>
        <div class="confirm-row">
          <span class="confirm-label">Items</span>
          <span class="confirm-value">{{ editItems.length }} item{{ editItems.length !== 1 ? 's' : '' }}</span>
        </div>
      </div>

      <!-- Edit toggle -->
      <div class="edit-toggle-row">
        <button class="edit-toggle-btn" @click="editMode = !editMode">
          <i :class="editMode ? 'pi pi-chevron-up' : 'pi pi-pencil'" />
          {{ editMode ? 'Collapse' : 'Edit document data' }}
        </button>
      </div>

      <!-- Edit form -->
      <div v-if="editMode" class="edit-form">
        <div class="edit-two-col">
          <div class="edit-field">
            <label class="edit-field-label">Customer Name</label>
            <input v-model="editCustomerName" class="edit-input" placeholder="Customer name" />
          </div>
          <div class="edit-field">
            <label class="edit-field-label">Customer Email</label>
            <input v-model="editCustomerEmail" class="edit-input" type="email" placeholder="email@example.com" />
          </div>
        </div>

        <!-- Items table -->
        <div class="edit-field">
          <div class="edit-items-header">
            <label class="edit-field-label">Items</label>
            <button class="edit-add-btn" @click.prevent="addItem">
              <i class="pi pi-plus" /> Add row
            </button>
          </div>
          <div class="edit-items-table">
            <div class="edit-items-cols">
              <span>Name</span>
              <span>Qty</span>
              <span>Unit Price</span>
              <span></span>
            </div>
            <div v-for="(item, idx) in editItems" :key="idx" class="edit-item-row">
              <input v-model="item.name"               class="edit-input item-name"  placeholder="Item name" />
              <input v-model.number="item.quantity"    class="edit-input item-qty"   type="number" min="0" step="1"    placeholder="1" />
              <input v-model="item.unitPrice"          class="edit-input item-price" type="number" min="0" step="0.01" placeholder="0.00" />
              <button class="edit-remove-btn" @click.prevent="removeItem(idx)">
                <i class="pi pi-times" />
              </button>
            </div>
            <div v-if="editItems.length === 0" class="edit-items-empty">No items — click "Add row" to add.</div>
          </div>
        </div>

        <!-- Total (payment-required types only) -->
        <div v-if="isPaymentRequired(pendingType)" class="edit-field">
          <label class="edit-field-label">Total ({{ sale?.currency || '₪' }})</label>
          <div class="edit-total-row">
            <input v-model="editTotalPrice" class="edit-input edit-input-sm" type="number" min="0" step="0.01" placeholder="0.00" />
            <button class="edit-recalc-btn" @click.prevent="recalcTotal">
              <i class="pi pi-refresh" /> From items ({{ computedTotal }})
            </button>
          </div>
        </div>
      </div>

      <!-- Email checkbox -->
      <div class="confirm-email-row">
        <Checkbox v-model="sendEmail" :binary="true" inputId="sendEmailCheck" :disabled="!editCustomerEmail || creating" />
        <label for="sendEmailCheck" class="confirm-email-label">
          Send email to customer
          <span v-if="!editCustomerEmail" class="confirm-email-note">(no email on file)</span>
        </label>
      </div>

      <Message v-if="createError" severity="error" :closable="false" class="confirm-error">{{ createError }}</Message>
    </div>

    <template #footer>
      <div class="confirm-footer">
        <Button label="Cancel" severity="secondary" outlined :disabled="creating" @click="showConfirm = false" />
        <Button label="Create Document" icon="pi pi-file" :loading="creating" @click="confirmCreate" />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import type { SaleDetail } from '@/api/sales'
import {
  getSaleDocuments,
  createSaleDocument,
  ALL_DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  type CardcomDocument,
} from '@/api/invoices'

const PAYMENT_REQUIRED = ['TaxInvoiceAndReceipt', 'Receipt']

const props = defineProps<{
  visible: boolean
  sale:    SaleDetail | null
}>()

defineEmits<{
  (e: 'update:visible', v: boolean): void
}>()

const toast     = useToast()
const loading   = ref(false)
const documents = ref<CardcomDocument[]>([])

// Confirm dialog state
const showConfirm = ref(false)
const pendingType = ref('')
const sendEmail   = ref(true)
const creating    = ref(false)
const createError = ref<string | null>(null)

// Edit mode state
interface EditItem { name: string; quantity: number; unitPrice: string }

const editMode          = ref(false)
const editCustomerName  = ref('')
const editCustomerEmail = ref('')
const editTotalPrice    = ref('')
const editItems         = ref<EditItem[]>([])

const computedTotal = computed(() => {
  const sum = editItems.value.reduce((acc, item) => {
    return acc + (parseFloat(item.unitPrice || '0') * (item.quantity || 0))
  }, 0)
  return sum.toFixed(2)
})

watch(
  () => props.visible,
  (v) => { if (v && props.sale) fetchDocuments() },
)

// Auto-toggle sendEmail when email field changes in edit mode
watch(editCustomerEmail, (val) => {
  if (val && !sendEmail.value) sendEmail.value = true
  if (!val) sendEmail.value = false
})

async function fetchDocuments() {
  if (!props.sale) return
  loading.value = true
  try {
    documents.value = await getSaleDocuments(props.sale.id)
  } catch {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Failed to load documents', life: 4000 })
  } finally {
    loading.value = false
  }
}

function openConfirm(type: string) {
  pendingType.value = type
  createError.value = null
  editMode.value    = false

  // Pre-populate edit state from sale
  editCustomerName.value  = props.sale?.customerName  ?? ''
  editCustomerEmail.value = props.sale?.customerEmail ?? ''
  editTotalPrice.value    = props.sale?.totalPrice    ?? ''
  editItems.value = (props.sale?.items ?? []).map(i => ({
    name:      i.name,
    quantity:  i.quantity,
    unitPrice: i.unitPrice ?? '',
  }))

  sendEmail.value   = !!props.sale?.customerEmail
  showConfirm.value = true
}

function addItem() {
  editItems.value.push({ name: '', quantity: 1, unitPrice: '' })
}

function removeItem(idx: number) {
  editItems.value.splice(idx, 1)
}

function recalcTotal() {
  editTotalPrice.value = computedTotal.value
}

async function confirmCreate() {
  if (!props.sale) return
  creating.value    = true
  createError.value = null
  try {
    const doc = await createSaleDocument(
      props.sale.id,
      pendingType.value,
      sendEmail.value,
      {
        customerName:  editCustomerName.value  || undefined,
        customerEmail: editCustomerEmail.value || null,
        totalPrice:    editTotalPrice.value    || null,
        items: editItems.value.map(i => ({
          name:      i.name,
          quantity:  i.quantity,
          unitPrice: i.unitPrice || null,
        })),
      },
    )
    documents.value.push(doc)
    showConfirm.value = false
    toast.add({
      severity: 'success',
      summary:  'Document Created',
      detail:   `${typeLabel(doc.documentType)} #${doc.documentNumber} created successfully`,
      life:     5000,
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to create document'
    createError.value = msg
  } finally {
    creating.value = false
  }
}

function typeLabel(type: string) {
  return DOCUMENT_TYPE_LABELS[type] ?? type
}

function isPaymentRequired(type: string) {
  return PAYMENT_REQUIRED.includes(type)
}

function getDisabledReason(type: string): string {
  if (!props.sale?.customerName) return 'Customer name is required'
  if (isPaymentRequired(type) && !props.sale?.totalPrice) return 'Total price is required for this document type'
  return ''
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.warning-msg { margin-bottom: 16px; }

.doc-loading {
  display: flex;
  justify-content: center;
  padding: 32px;
  font-size: 22px;
  color: var(--p-primary-color);
}

.doc-empty {
  text-align: center;
  padding: 24px 0;
  color: var(--p-text-muted-color);
  font-size: 14px;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 40px;
}

.doc-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  gap: 8px;
}

.doc-row-left {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.doc-type-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
  background: var(--p-primary-50, #eff6ff);
  color: var(--p-primary-700, #1d4ed8);
  direction: rtl;
}

.doc-number {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
}

.doc-date {
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.doc-download {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-primary-color);
  text-decoration: none;
  padding: 4px 10px;
  border: 1px solid var(--p-primary-color);
  border-radius: 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.doc-download:hover { background: var(--p-primary-50, #eff6ff); }

.doc-no-url {
  font-size: 12px;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.doc-create-section {
  margin-top: 20px;
  border-top: 1px solid var(--p-content-border-color);
  padding-top: 16px;
}

.doc-create-label {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.doc-create-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* ── Confirm dialog ─────────────────────────────────────────── */
.confirm-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 4px 0;
}

.confirm-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 12px 14px;
}

.confirm-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.confirm-label {
  width: 80px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.confirm-value { font-size: 14px; }

.confirm-total {
  font-weight: 700;
  color: var(--p-primary-color);
}

/* Edit toggle */
.edit-toggle-row {
  display: flex;
  justify-content: flex-end;
}

.edit-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-primary-color);
  background: transparent;
  border: 1px solid var(--p-primary-color);
  border-radius: 6px;
  padding: 4px 12px;
  cursor: pointer;
  transition: background 0.15s;
}

.edit-toggle-btn:hover { background: var(--p-primary-50, #eff6ff); }

/* Edit form */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  padding: 14px;
}

.edit-two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.edit-field-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.edit-input {
  width: 100%;
  padding: 6px 10px;
  font-size: 13px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-surface-0);
  color: var(--p-text-color);
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}

.edit-input:focus { border-color: var(--p-primary-color); }

.edit-input-sm { width: 100%; }

/* Items table */
.edit-items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.edit-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-primary-color);
  background: transparent;
  border: 1px solid var(--p-primary-color);
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
}

.edit-add-btn:hover { background: var(--p-primary-50, #eff6ff); }

.edit-items-table {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.edit-items-cols {
  display: grid;
  grid-template-columns: 1fr 72px 100px 28px;
  gap: 6px;
  padding: 0 2px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.edit-item-row {
  display: grid;
  grid-template-columns: 1fr 72px 100px 28px;
  gap: 6px;
  align-items: center;
}

.edit-remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--p-text-muted-color);
  cursor: pointer;
  border-radius: 4px;
  font-size: 11px;
  padding: 0;
  flex-shrink: 0;
}

.edit-remove-btn:hover {
  background: var(--p-red-50, #fef2f2);
  color: var(--p-red-500, #ef4444);
}

.edit-items-empty {
  font-size: 12px;
  color: var(--p-text-muted-color);
  padding: 8px 2px;
}

/* Total row */
.edit-total-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.edit-total-row .edit-input-sm { width: 110px; flex-shrink: 0; }

.edit-recalc-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  background: transparent;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  white-space: nowrap;
}

.edit-recalc-btn:hover {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
}

/* Email row */
.confirm-email-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.confirm-email-label {
  font-size: 14px;
  cursor: pointer;
}

.confirm-email-note {
  font-size: 12px;
  color: var(--p-text-muted-color);
  margin-left: 4px;
}

.confirm-error { width: 100%; }

.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* ── Mobile ─────────────────────────────────────────────────── */
@media (max-width: 600px) {
  .edit-two-col { grid-template-columns: 1fr; }
  .doc-create-buttons { flex-direction: column; }
}

@media (max-width: 520px) {
  /* Confirm footer: stack buttons */
  .confirm-footer {
    flex-direction: column-reverse;
    gap: 6px;
  }
  .confirm-footer :deep(.p-button) { width: 100%; justify-content: center; }

  /* Edit form tighter padding */
  .edit-form { padding: 10px; gap: 12px; }

  /* Total row: stack on very small screens */
  .edit-total-row { flex-wrap: wrap; }
  .edit-total-row .edit-input-sm { width: 100%; }
  .edit-recalc-btn { width: 100%; justify-content: center; }

  /* Items: switch to card-per-row layout */
  .edit-items-cols { display: none; }

  .edit-items-table { gap: 8px; }

  .edit-item-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    background: var(--p-surface-0);
    border: 1px solid var(--p-content-border-color);
    border-radius: 8px;
  }

  .item-name  { flex: 0 0 100%; width: 100%; }
  .item-qty   { width: 80px; flex-shrink: 0; }
  .item-price { flex: 1; min-width: 80px; }
  .edit-remove-btn { align-self: center; margin-left: auto; }
}
</style>
