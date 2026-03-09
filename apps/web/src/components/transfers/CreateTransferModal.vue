<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="New Stock Transfer"
    class="create-transfer-dialog"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @hide="resetForm"
  >
    <div class="transfer-form">

      <!-- Warehouses row -->
      <div class="warehouse-row">
        <div class="field">
          <label>From Warehouse <span class="req">*</span></label>
          <Select
            v-model="form.fromWarehouseId"
            :options="warehouses"
            option-label="name"
            option-value="id"
            placeholder="Select source…"
            :loading="loadingWarehouses"
            fluid
            appendTo="body"
            @change="clearItems"
          />
        </div>

        <div class="transfer-arrow"><i class="pi pi-arrow-right" /></div>

        <div class="field">
          <label>To Warehouse <span class="req">*</span></label>
          <Select
            v-model="form.toWarehouseId"
            :options="toWarehouseOptions"
            option-label="name"
            option-value="id"
            placeholder="Select destination…"
            :loading="loadingWarehouses"
            fluid
            appendTo="body"
          />
        </div>

        <div class="field field-ref">
          <label>Reference</label>
          <InputText v-model="form.reference" placeholder="e.g. TR-2025-01" fluid />
        </div>
      </div>

      <!-- Product search -->
      <ProductSearchInput
        :warehouse-id="form.fromWarehouseId"
        :added-ids="addedIds"
        @select="addItem"
      />

      <!-- Items list -->
      <TransferItemsList
        :items="form.items"
        @remove="removeItem"
        @clamp="clampQty"
      />

      <!-- Notes -->
      <div class="field">
        <label>Notes</label>
        <Textarea v-model="form.notes" rows="2" placeholder="Optional…" fluid />
      </div>

      <!-- Errors -->
      <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

      <Message v-if="insufficientItems.length > 0" severity="warn" :closable="false">
        <strong>Insufficient stock in source warehouse:</strong>
        <ul class="stock-error-list">
          <li v-for="item in insufficientItems" :key="item.sku">
            {{ item.sku }} — requested {{ item.requested }}, available {{ item.available }}
          </li>
        </ul>
      </Message>
    </div>

    <template #footer>
      <div class="footer-row">
        <span v-if="form.items.length > 0" class="footer-summary">
          {{ form.items.length }} product{{ form.items.length !== 1 ? 's' : '' }},
          {{ totalQty }} units
        </span>
        <div class="footer-actions">
          <Button label="Cancel" severity="secondary" outlined @click="visible = false" />
          <Button
            label="Execute Transfer"
            icon="pi pi-arrow-right"
            :disabled="!canSubmit"
            @click="openConfirm"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <!-- Confirmation dialog -->
  <Dialog
    v-model:visible="showConfirm"
    modal
    header="Confirm Transfer"
    class="confirm-transfer-dialog"
    :style="{ width: '400px' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    :closable="!submitting"
  >
    <div class="confirm-body">
      <div class="confirm-route">
        <div class="confirm-warehouse">
          <span class="confirm-label">From</span>
          <strong>{{ fromWarehouseName }}</strong>
        </div>
        <i class="pi pi-arrow-right confirm-arrow-icon" />
        <div class="confirm-warehouse">
          <span class="confirm-label">To</span>
          <strong>{{ toWarehouseName }}</strong>
        </div>
      </div>

      <div class="confirm-stats">
        <span><strong>{{ form.items.length }}</strong> product{{ form.items.length !== 1 ? 's' : '' }}</span>
        <span class="confirm-dot">·</span>
        <span><strong>{{ totalQty }}</strong> units</span>
        <template v-if="form.reference.trim()">
          <span class="confirm-dot">·</span>
          <span>Ref: <strong>{{ form.reference.trim() }}</strong></span>
        </template>
      </div>

      <p class="confirm-question">Are you sure you want to proceed with this transfer?</p>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" outlined :disabled="submitting" @click="showConfirm = false" />
      <Button
        label="Confirm & Execute"
        icon="pi pi-check"
        :loading="submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { getWarehouses } from '@/api/warehouses'
import { createTransfer, type ProductSearchResult } from '@/api/transfers'
import type { WarehouseDTO } from '@ob-inventory/types'
import ProductSearchInput from './ProductSearchInput.vue'
import TransferItemsList from './TransferItemsList.vue'
import type { TransferItemRow } from './TransferItemsList.vue'

const props = defineProps<{ modelValue: boolean }>()
const emit  = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const queryClient = useQueryClient()

// ── Warehouses ────────────────────────────────────────────────────────────────
const warehouses        = ref<WarehouseDTO[]>([])
const loadingWarehouses = ref(false)

const toWarehouseOptions = computed(() =>
  warehouses.value.filter(w => w.id !== form.value.fromWarehouseId),
)

watch(visible, async (open) => {
  if (!open || warehouses.value.length > 0) return
  loadingWarehouses.value = true
  try { warehouses.value = await getWarehouses() }
  finally { loadingWarehouses.value = false }
})

// ── Form state ────────────────────────────────────────────────────────────────
const defaultForm = () => ({
  fromWarehouseId: null as string | null,
  toWarehouseId:   null as string | null,
  reference:       '',
  notes:           '',
  items:           [] as TransferItemRow[],
})

const form              = ref(defaultForm())
const submitting        = ref(false)
const errorMsg          = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])
const showConfirm       = ref(false)

const fromWarehouseName = computed(() => warehouses.value.find(w => w.id === form.value.fromWarehouseId)?.name ?? '')
const toWarehouseName   = computed(() => warehouses.value.find(w => w.id === form.value.toWarehouseId)?.name ?? '')

function openConfirm() {
  if (!canSubmit.value) return
  errorMsg.value = null
  insufficientItems.value = []
  showConfirm.value = true
}

const addedIds  = computed(() => form.value.items.map(i => i.productId))
const totalQty  = computed(() => form.value.items.reduce((s, i) => s + i.quantity, 0))
const canSubmit = computed(() =>
  !!form.value.fromWarehouseId &&
  !!form.value.toWarehouseId   &&
  form.value.fromWarehouseId !== form.value.toWarehouseId &&
  form.value.items.length > 0,
)

function clearItems() {
  form.value.items = []
  form.value.toWarehouseId = null
}

function addItem(result: ProductSearchResult) {
  if (addedIds.value.includes(result.productId)) return
  form.value.items.unshift({ ...result, quantity: 1 })
}

function removeItem(idx: number) {
  form.value.items.splice(idx, 1)
}

function clampQty(idx: number) {
  const item = form.value.items[idx]
  if (item.quantity < 1) item.quantity = 1
  if (item.quantity > item.availableQty) item.quantity = item.availableQty
}

function resetForm() {
  form.value = defaultForm()
  errorMsg.value = null
  insufficientItems.value = []
}

// ── Submit ────────────────────────────────────────────────────────────────────
async function submit() {
  if (!canSubmit.value) return
  submitting.value = true

  try {
    await createTransfer({
      fromWarehouseId: form.value.fromWarehouseId!,
      toWarehouseId:   form.value.toWarehouseId!,
      reference:       form.value.reference.trim() || undefined,
      notes:           form.value.notes.trim()     || undefined,
      items:           form.value.items.map(i => ({ productId: i.productId, quantity: i.quantity })),
    })
    showConfirm.value = false
    visible.value = false
    emit('created')
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string; code?: string; items?: typeof insufficientItems.value } } }
    showConfirm.value = false
    if (e.response?.data?.code === 'INSUFFICIENT_STOCK') {
      insufficientItems.value = e.response.data.items ?? []
    } else {
      errorMsg.value = e.response?.data?.error ?? 'An unexpected error occurred'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.transfer-form { display: flex; flex-direction: column; gap: 20px; padding-top: 4px; }

.warehouse-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr 160px;
  gap: 12px;
  align-items: end;
}

.transfer-arrow {
  padding-bottom: 10px;
  color: var(--p-primary-color);
  font-size: 18px;
  display: flex;
  align-items: center;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field-ref { max-width: 160px; }

label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.req { color: var(--p-red-500); }

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.footer-summary { font-size: 13px; color: var(--p-text-muted-color); font-weight: 500; }
.footer-actions { display: flex; gap: 8px; }

.stock-error-list { margin: 4px 0 0; padding-left: 18px; }

/* ── Confirmation dialog ── */
.confirm-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 4px 0 8px;
}

.confirm-route {
  display: flex;
  align-items: center;
  gap: 14px;
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 10px;
  padding: 14px 18px;
}

.confirm-warehouse {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.confirm-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color, #94a3b8);
}

.confirm-warehouse strong {
  font-size: 15px;
  color: var(--p-text-color, #0f172a);
}

.confirm-arrow-icon {
  font-size: 16px;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.confirm-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--p-text-muted-color, #64748b);
}

.confirm-dot { color: var(--p-surface-300, #cbd5e1); }

.confirm-question {
  margin: 0;
  font-size: 14px;
  color: var(--p-text-color, #0f172a);
}

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .transfer-form { gap: 16px; }

  .warehouse-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .transfer-arrow {
    padding: 0;
    justify-content: center;
    transform: rotate(90deg);
  }

  .field-ref { max-width: none; }

  .footer-row {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }

  .footer-actions {
    flex-direction: column-reverse;
    gap: 8px;
  }

  .footer-actions .p-button {
    width: 100%;
    justify-content: center;
  }
}

@media (max-width: 768px) {
  .confirm-route {
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
  }

  .confirm-arrow-icon {
    transform: rotate(90deg);
  }

  .confirm-stats {
    flex-wrap: wrap;
  }
}
</style>
