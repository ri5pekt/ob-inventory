<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="New Stock Transfer"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
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
            :loading="submitting"
            :disabled="!canSubmit"
            @click="submit"
          />
        </div>
      </div>
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
const emit  = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

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
  form.value.items.push({ ...result, quantity: 1 })
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
  errorMsg.value = null
  insufficientItems.value = []
  submitting.value = true

  try {
    await createTransfer({
      fromWarehouseId: form.value.fromWarehouseId!,
      toWarehouseId:   form.value.toWarehouseId!,
      reference:       form.value.reference.trim() || undefined,
      notes:           form.value.notes.trim()     || undefined,
      items:           form.value.items.map(i => ({ productId: i.productId, quantity: i.quantity })),
    })
    queryClient.invalidateQueries({ queryKey: ['transfers'] })
    queryClient.invalidateQueries({ queryKey: ['warehouses'] })
    visible.value = false
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
</style>
