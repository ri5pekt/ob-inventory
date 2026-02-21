<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="New Sale"
    :style="{ width: '760px', maxWidth: '95vw' }"
    @hide="resetForm"
  >
    <div class="create-sale-form">
      <!-- Type + Warehouse row -->
      <div class="form-row">
        <div class="field">
          <label>Sale Type</label>
          <div class="type-toggle">
            <Button
              v-for="opt in typeOptions"
              :key="opt.value"
              :label="opt.label"
              :icon="opt.icon"
              :severity="form.saleType === opt.value ? undefined : 'secondary'"
              :outlined="form.saleType !== opt.value"
              size="small"
              @click="form.saleType = opt.value"
            />
          </div>
        </div>

        <div v-if="form.saleType === 'partner'" class="field">
          <label>Partner Warehouse <span class="required">*</span></label>
          <Select
            v-model="form.warehouseId"
            :options="partnerWarehouses"
            option-label="name"
            option-value="id"
            placeholder="Select warehouse"
            :loading="loadingWarehouses"
            fluid
          />
        </div>
      </div>

      <!-- Customer row -->
      <div class="form-row">
        <div class="field">
          <label>Customer Name</label>
          <InputText v-model="form.customerName" placeholder="Optional" fluid />
        </div>
        <div class="field">
          <label>Customer Email</label>
          <InputText v-model="form.customerEmail" type="email" placeholder="Optional" fluid />
        </div>
        <div class="field field-sm">
          <label>Currency</label>
          <InputText v-model="form.currency" placeholder="ILS" fluid />
        </div>
      </div>

      <!-- Items table -->
      <div class="items-section">
        <div class="items-header">
          <span class="items-title">Items</span>
          <Button label="Add Item" icon="pi pi-plus" size="small" text @click="addItem" />
        </div>

        <div class="items-table-wrap">
          <table class="items-table">
            <thead>
              <tr>
                <th style="width:110px">SKU</th>
                <th>Product Name</th>
                <th style="width:70px">Qty</th>
                <th style="width:90px">Unit Price</th>
                <th style="width:90px">Total</th>
                <th style="width:36px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="form.items.length === 0">
                <td colspan="6" class="empty-row">No items yet — click "Add Item" to start</td>
              </tr>
              <tr v-for="(item, idx) in form.items" :key="idx">
                <td>
                  <InputText
                    v-model="item.sku"
                    placeholder="SKU"
                    size="small"
                    fluid
                  />
                </td>
                <td>
                  <InputText
                    v-model="item.name"
                    placeholder="Product name"
                    size="small"
                    fluid
                  />
                </td>
                <td>
                  <InputNumber
                    v-model="item.quantity"
                    :min="1"
                    :max="99999"
                    size="small"
                    fluid
                    :use-grouping="false"
                  />
                </td>
                <td>
                  <InputNumber
                    v-model="item.unitPrice"
                    :min-fraction-digits="2"
                    :max-fraction-digits="2"
                    :min="0"
                    size="small"
                    fluid
                    placeholder="0.00"
                  />
                </td>
                <td class="line-total">
                  {{ lineTotal(item) !== null ? lineTotal(item)!.toFixed(2) : '—' }}
                </td>
                <td>
                  <Button
                    icon="pi pi-trash"
                    text
                    rounded
                    severity="danger"
                    size="small"
                    @click="removeItem(idx)"
                  />
                </td>
              </tr>
            </tbody>
            <tfoot v-if="form.items.length > 0">
              <tr>
                <td colspan="4" class="total-label">Grand Total</td>
                <td class="grand-total">{{ grandTotal.toFixed(2) }} {{ form.currency }}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <!-- Notes -->
      <div class="field">
        <label>Notes</label>
        <Textarea v-model="form.notes" rows="2" placeholder="Optional notes…" fluid />
      </div>

      <!-- Errors -->
      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <template v-if="insufficientItems.length > 0">
        <Message severity="warn" :closable="false">
          <strong>Insufficient stock:</strong>
          <ul class="stock-error-list">
            <li v-for="item in insufficientItems" :key="item.sku">
              {{ item.sku }} — requested {{ item.requested }}, available {{ item.available }}
            </li>
          </ul>
        </Message>
      </template>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" outlined @click="visible = false" />
      <Button
        label="Create Sale"
        icon="pi pi-check"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { getWarehouses } from '@/api/warehouses'
import { createSale, type CreateSaleItemInput } from '@/api/sales'
import type { WarehouseDTO } from '@ob-inventory/types'

const props = defineProps<{ modelValue: boolean }>()
const emit  = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const queryClient = useQueryClient()

// ── Warehouse list (for partner type) ────────────────────────────────────────

const warehouses         = ref<WarehouseDTO[]>([])
const loadingWarehouses  = ref(false)

const partnerWarehouses = computed(() =>
  warehouses.value.filter(w => w.type !== 'main'),
)

watch(visible, async (open) => {
  if (!open) return
  if (warehouses.value.length > 0) return
  loadingWarehouses.value = true
  try {
    warehouses.value = await getWarehouses()
  } finally {
    loadingWarehouses.value = false
  }
}, { immediate: false })

// ── Form state ────────────────────────────────────────────────────────────────

interface ItemRow {
  sku:        string
  name:       string
  quantity:   number | null
  unitPrice:  number | null
}

const defaultForm = () => ({
  saleType:      'direct' as 'direct' | 'partner',
  warehouseId:   null as string | null,
  customerName:  '',
  customerEmail: '',
  currency:      'ILS',
  notes:         '',
  items:         [] as ItemRow[],
})

const form              = ref(defaultForm())
const submitting        = ref(false)
const error             = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])

const typeOptions = [
  { value: 'direct',  label: 'Direct Sale',  icon: 'pi pi-user' },
  { value: 'partner', label: 'Partner Sale',  icon: 'pi pi-building' },
]

function addItem() {
  form.value.items.push({ sku: '', name: '', quantity: 1, unitPrice: null })
}

function removeItem(idx: number) {
  form.value.items.splice(idx, 1)
}

function lineTotal(item: ItemRow): number | null {
  if (item.unitPrice == null || item.quantity == null) return null
  return item.unitPrice * item.quantity
}

const grandTotal = computed(() =>
  form.value.items.reduce((sum, item) => {
    const lt = lineTotal(item)
    return lt != null ? sum + lt : sum
  }, 0),
)

const canSubmit = computed(() => {
  if (form.value.items.length === 0) return false
  if (form.value.saleType === 'partner' && !form.value.warehouseId) return false
  return form.value.items.every(i => i.sku.trim() && i.name.trim() && (i.quantity ?? 0) > 0)
})

function resetForm() {
  form.value = defaultForm()
  error.value = null
  insufficientItems.value = []
  submitting.value = false
}

async function submit() {
  if (!canSubmit.value) return

  error.value = null
  insufficientItems.value = []
  submitting.value = true

  try {
    const items: CreateSaleItemInput[] = form.value.items.map(i => ({
      sku:       i.sku.trim(),
      name:      i.name.trim(),
      quantity:  i.quantity!,
      unitPrice: i.unitPrice ?? undefined,
      lineTotal: lineTotal(i) ?? undefined,
    }))

    await createSale({
      saleType:      form.value.saleType,
      warehouseId:   form.value.warehouseId ?? undefined,
      customerName:  form.value.customerName.trim() || undefined,
      customerEmail: form.value.customerEmail.trim() || undefined,
      currency:      form.value.currency.trim() || 'ILS',
      notes:         form.value.notes.trim() || undefined,
      items,
    })

    queryClient.invalidateQueries({ queryKey: ['sales'] })
    visible.value = false
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string; code?: string; items?: typeof insufficientItems.value } } }
    if (axiosErr.response?.data?.code === 'INSUFFICIENT_STOCK') {
      insufficientItems.value = axiosErr.response.data.items ?? []
    } else {
      error.value = axiosErr.response?.data?.error ?? 'An unexpected error occurred'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.create-sale-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.field-sm {
  flex: 0 0 100px;
}

label {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.required {
  color: var(--p-red-500);
}

.type-toggle {
  display: flex;
  gap: 8px;
}

/* Items table */
.items-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.items-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.items-table-wrap {
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  overflow: hidden;
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.items-table thead th {
  background: var(--p-surface-100);
  padding: 8px 10px;
  text-align: left;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  border-bottom: 1px solid var(--p-content-border-color);
}

.items-table tbody td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--p-content-border-color);
  vertical-align: middle;
}

.items-table tbody tr:last-child td {
  border-bottom: none;
}

.items-table .empty-row {
  text-align: center;
  color: var(--p-text-muted-color);
  padding: 20px;
  font-style: italic;
}

.items-table .line-total {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-color);
}

.items-table tfoot td {
  padding: 8px 10px;
  background: var(--p-surface-50);
  border-top: 2px solid var(--p-content-border-color);
}

.total-label {
  text-align: right;
  font-weight: 600;
  font-size: 13px;
  color: var(--p-text-muted-color);
}

.grand-total {
  text-align: right;
  font-weight: 700;
  font-size: 15px;
  color: var(--p-primary-color);
  font-variant-numeric: tabular-nums;
}

.stock-error-list {
  margin: 4px 0 0;
  padding-left: 18px;
}
</style>
