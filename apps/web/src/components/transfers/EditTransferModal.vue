<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="Edit Transfer"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @hide="resetForm"
  >
    <div class="edit-transfer-form">

      <!-- Route (read-only) -->
      <div class="route-row">
        <div class="field">
          <label>From Warehouse</label>
          <div class="wh-badge wh-from">{{ transfer?.fromWarehouseName ?? '—' }}</div>
        </div>
        <div class="route-arrow"><i class="pi pi-arrow-right" /></div>
        <div class="field">
          <label>To Warehouse</label>
          <div class="wh-badge wh-to">{{ transfer?.toWarehouseName ?? '—' }}</div>
        </div>
        <div class="field field-ref">
          <label>Reference</label>
          <InputText v-model="form.reference" placeholder="e.g. TR-2025-01" fluid />
        </div>
        <div class="field field-date">
          <label>Transfer Date</label>
          <DatePicker
            v-model="form.transferDate"
            date-format="dd/mm/yy"
            :show-icon="true"
            :show-button-bar="true"
            fluid
            append-to="body"
          />
        </div>
      </div>

      <!-- Product search (scoped to fromWarehouse) -->
      <ProductSearchInput
        :warehouse-id="transfer?.fromWarehouseId ?? null"
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
            label="Save Changes"
            icon="pi pi-check"
            :disabled="!canSubmit"
            :loading="submitting"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { updateTransfer, type TransferDetail, type ProductSearchResult } from '@/api/transfers'
import ProductSearchInput from './ProductSearchInput.vue'
import TransferItemsList from './TransferItemsList.vue'
import type { TransferItemRow } from './TransferItemsList.vue'

const props = defineProps<{ modelValue: boolean; transfer: TransferDetail | null }>()
const emit  = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'updated'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

// ── Form ──────────────────────────────────────────────────────────────────────

const defaultForm = () => ({
  reference:    '',
  notes:        '',
  transferDate: new Date() as Date,
  items:        [] as TransferItemRow[],
})

const form              = ref(defaultForm())
const submitting        = ref(false)
const errorMsg          = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])

// Pre-fill when a transfer is provided
watch(() => props.transfer, (transfer) => {
  if (!transfer) return
  form.value.reference    = transfer.reference    ?? ''
  form.value.notes        = transfer.notes        ?? ''
  form.value.transferDate = transfer.transferDate ? new Date(transfer.transferDate) : new Date()
  form.value.items     = (transfer.items ?? []).map(item => ({
    productId:    item.productId,
    sku:          item.sku,
    name:         item.name,
    brandName:    null,
    categoryName: null,
    model:        null,
    size:         null,
    color:        null,
    // availableQty set high so stepper has no artificial cap; backend validates
    availableQty: item.quantity + 9999,
    quantity:     item.quantity,
  }))
}, { immediate: true })

const addedIds = computed(() => form.value.items.map(i => i.productId))
const totalQty = computed(() => form.value.items.reduce((s, i) => s + i.quantity, 0))
const canSubmit = computed(() => form.value.items.length > 0)

function addItem(result: ProductSearchResult) {
  if (addedIds.value.includes(result.productId)) return
  form.value.items.unshift({ ...result, quantity: 1 })
}

function removeItem(idx: number) {
  form.value.items.splice(idx, 1)
}

function clampQty(idx: number) {
  const item = form.value.items[idx]
  if (!item) return
  if (item.quantity < 1) item.quantity = 1
  if (item.quantity > item.availableQty) item.quantity = item.availableQty
}

function resetForm() {
  form.value = defaultForm()
  errorMsg.value = null
  insufficientItems.value = []
  submitting.value = false
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submit() {
  if (!props.transfer || !canSubmit.value) return
  errorMsg.value = null
  insufficientItems.value = []
  submitting.value = true
  try {
    await updateTransfer(props.transfer.id, {
      reference:    form.value.reference.trim() || undefined,
      notes:        form.value.notes.trim()     || undefined,
      transferDate: form.value.transferDate.toISOString(),
      items:        form.value.items.map(i => ({ productId: i.productId, quantity: i.quantity })),
    })
    visible.value = false
    emit('updated')
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string; code?: string; items?: typeof insufficientItems.value } } }
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
.edit-transfer-form { display: flex; flex-direction: column; gap: 20px; padding-top: 4px; }

.route-row {
  display: grid;
  grid-template-columns: 1fr auto 1fr 150px 160px;
  gap: 12px;
  align-items: end;
}

.route-arrow {
  padding-bottom: 10px;
  color: var(--p-primary-color);
  font-size: 18px;
  display: flex;
  align-items: center;
}

.field { display: flex; flex-direction: column; gap: 6px; }
.field-ref  { max-width: 150px; }
.field-date { max-width: 160px; }

label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.wh-badge {
  display: inline-flex;
  align-items: center;
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  width: fit-content;
}

.wh-from { background: var(--p-orange-50, #fff7ed); color: var(--p-orange-700, #c2410c); }
.wh-to   { background: var(--p-green-50,  #f0fdf4); color: var(--p-green-700,  #15803d); }

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.footer-summary { font-size: 13px; color: var(--p-text-muted-color); font-weight: 500; }
.footer-actions { display: flex; gap: 8px; }
.stock-error-list { margin: 4px 0 0; padding-left: 18px; }

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .edit-transfer-form { gap: 16px; }

  .route-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .route-arrow {
    padding: 0;
    justify-content: center;
    transform: rotate(90deg);
  }

  .field-ref  { max-width: none; }
  .field-date { max-width: none; }

  .footer-row { flex-direction: column; align-items: stretch; gap: 12px; }
  .footer-actions { flex-direction: column-reverse; gap: 8px; }
  .footer-actions .p-button { width: 100%; justify-content: center; }
}
</style>
