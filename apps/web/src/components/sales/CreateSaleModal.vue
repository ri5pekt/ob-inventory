<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="New Sale"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @hide="resetForm"
  >
    <div class="create-sale-form">

      <!-- Sale Type -->
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
            @click="onTypeChange(opt.value as 'direct' | 'partner')"
          />
        </div>
      </div>

      <!-- Warehouse -->
      <div class="field">
        <label>
          {{ form.saleType === 'partner' ? 'Partner Warehouse' : 'Warehouse' }}
          <span v-if="form.saleType === 'partner'" class="required">*</span>
        </label>
        <Select
          v-model="form.warehouseId"
          :options="warehouseOptions"
          option-label="name"
          option-value="id"
          :placeholder="form.saleType === 'partner' ? 'Select partner warehouse…' : 'Select warehouse…'"
          :loading="loadingWarehouses"
          show-clear
          fluid
          append-to="body"
          @change="clearItems"
        />
      </div>

      <!-- Customer row -->
      <div class="form-row form-row-customer">
        <div class="field">
          <label>Customer Name</label>
          <InputText v-model="form.customerName" placeholder="Optional" fluid />
        </div>
        <div class="field">
          <label>Customer Email</label>
          <InputText v-model="form.customerEmail" type="email" placeholder="Optional" fluid />
        </div>
        <div class="field">
          <label>Customer Phone</label>
          <InputText v-model="form.customerPhone" type="tel" placeholder="Optional" fluid />
        </div>
        <div class="field field-sm">
          <label>Currency</label>
          <InputText v-model="form.currency" placeholder="ILS" fluid />
        </div>
        <div class="field field-full">
          <label>Customer Address</label>
          <InputText v-model="form.customerAddress" placeholder="Optional — street, city, zip…" fluid />
        </div>
      </div>

      <!-- Sale Date -->
      <div class="field field-date">
        <label>Sale Date</label>
        <DatePicker
          v-model="form.saleDate"
          date-format="dd/mm/yy"
          :show-icon="true"
          :show-button-bar="true"
          fluid
          append-to="body"
        />
      </div>

      <!-- Target + Invoice status + Payment method -->
      <div class="form-row">
        <div class="field">
          <label>Target</label>
          <SaleMetaSelect
            v-model="form.targetId"
            :options="targets"
            label="Target"
            placeholder="Select target…"
            :loading="loadingMeta"
            :create-fn="createSaleTarget"
            @created="targets.push($event)"
          />
        </div>
        <div class="field">
          <label>Invoice Status</label>
          <SaleMetaSelect
            v-model="form.invoiceStatusId"
            :options="invoiceStatuses"
            label="Invoice Status"
            placeholder="Select status…"
            :loading="loadingMeta"
            :create-fn="createSaleInvoiceStatus"
            @created="invoiceStatuses.push($event)"
          />
        </div>
        <div class="field">
          <label>Payment Method</label>
          <SaleMetaMultiSelect
            v-model="form.paymentMethodIds"
            :options="paymentMethods"
            label="Payment Method"
            placeholder="Select method(s)…"
            :loading="loadingMeta"
            :create-fn="createSalePaymentMethod"
            @created="paymentMethods.push($event)"
          />
        </div>
      </div>

      <!-- Product search -->
      <ProductSearchInput
        :warehouse-id="form.warehouseId"
        :added-ids="addedProductIds"
        @select="addItem"
      />

      <!-- Items list -->
      <div v-if="form.items.length > 0" class="items-section">
        <div class="items-header">
          <span class="items-title">Items</span>
          <span class="items-count">{{ form.items.length }} product{{ form.items.length !== 1 ? 's' : '' }}</span>
        </div>

        <div class="items-list">
          <div class="items-list-head">
            <span class="col-product">Product</span>
            <span class="col-qty">Qty</span>
            <span class="col-price">Unit Price</span>
            <span class="col-total">Total</span>
            <span class="col-remove"></span>
          </div>

          <div v-for="(item, idx) in form.items" :key="item.productId" class="item-row">
            <!-- Product info -->
            <div class="item-info col-product">
              <span class="item-sku">{{ item.sku }}</span>
              <span class="item-name">{{ item.name }}</span>
              <span v-if="item.model || item.size || item.color" class="item-attrs">
                {{ [item.model, item.size, item.color].filter(Boolean).join(' · ') }}
              </span>
            </div>

            <!-- Qty stepper -->
            <div class="col-qty-wrap">
              <div class="qty-stepper">
                <button
                  class="qty-btn"
                  :disabled="item.quantity <= 1"
                  @click="item.quantity = Math.max(1, item.quantity - 1)"
                >−</button>
                <input
                  v-model.number="item.quantity"
                  type="number"
                  class="qty-input"
                  :min="1"
                  :max="item.availableQty"
                  @blur="clampQty(idx)"
                />
                <button
                  class="qty-btn"
                  :disabled="item.quantity >= item.availableQty"
                  @click="item.quantity = Math.min(item.availableQty, item.quantity + 1)"
                >+</button>
              </div>
              <span class="item-available">/ {{ item.availableQty }}</span>
            </div>

            <!-- Unit price -->
            <div class="col-price">
              <InputNumber
                v-model="item.unitPrice"
                :min-fraction-digits="2"
                :max-fraction-digits="2"
                :min="0"
                size="small"
                placeholder="0.00"
                class="price-input"
              />
            </div>

            <!-- Line total -->
            <span class="line-total col-total">
              {{ item.unitPrice != null ? (item.unitPrice * item.quantity).toFixed(2) : '—' }}
            </span>

            <!-- Remove -->
            <div class="col-remove">
              <Button
                icon="pi pi-times"
                text rounded
                severity="secondary"
                size="small"
                @click="removeItem(idx)"
              />
            </div>
          </div>
        </div>

        <div class="grand-total-row">
          <span class="grand-total-label">Grand Total</span>
          <span class="grand-total-value">{{ grandTotal.toFixed(2) }} {{ form.currency }}</span>
        </div>
      </div>

      <div v-else class="items-empty">
        <i class="pi pi-inbox" />
        <span>No items yet — use the search above to add products</span>
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
            <li v-for="it in insufficientItems" :key="it.sku">
              {{ it.sku }} — requested {{ it.requested }}, available {{ it.available }}
            </li>
          </ul>
        </Message>
      </template>
    </div>

    <template #footer>
      <div class="footer-row">
        <span v-if="form.items.length > 0" class="footer-summary">
          {{ form.items.length }} product{{ form.items.length !== 1 ? 's' : '' }} ·
          {{ grandTotal.toFixed(2) }} {{ form.currency }}
        </span>
        <div class="footer-actions">
          <Button label="Cancel" severity="secondary" outlined @click="visible = false" />
          <Button
            label="Create Sale"
            icon="pi pi-check"
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
    header="Confirm Sale"
    :style="{ width: '420px' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    :closable="!submitting"
  >
    <div class="confirm-body">
      <div class="confirm-meta">
        <div class="confirm-type-badge">
          <i :class="form.saleType === 'direct' ? 'pi pi-user' : 'pi pi-building'" />
          {{ form.saleType === 'direct' ? 'Direct Sale' : 'Partner Sale' }}
        </div>
        <div v-if="confirmWarehouseName" class="confirm-warehouse-row">
          <span class="confirm-label">Warehouse</span>
          <strong>{{ confirmWarehouseName }}</strong>
        </div>
        <div v-if="form.customerName" class="confirm-warehouse-row">
          <span class="confirm-label">Customer</span>
          <strong>{{ form.customerName }}</strong>
        </div>
        <div v-if="form.customerPhone" class="confirm-warehouse-row">
          <span class="confirm-label">Phone</span>
          <strong>{{ form.customerPhone }}</strong>
        </div>
      </div>

      <div class="confirm-stats">
        <span><strong>{{ form.items.length }}</strong> product{{ form.items.length !== 1 ? 's' : '' }}</span>
        <span class="confirm-dot">·</span>
        <span><strong>{{ confirmTotalQty }}</strong> units</span>
        <span class="confirm-dot">·</span>
        <span><strong>{{ grandTotal.toFixed(2) }}</strong> {{ form.currency }}</span>
      </div>

      <p class="confirm-question">Are you sure you want to create this sale?</p>
    </div>

    <template #footer>
      <div class="confirm-footer-row">
        <Button label="Cancel" severity="secondary" outlined :disabled="submitting" @click="showConfirm = false" />
        <Button
          label="Confirm & Create"
          icon="pi pi-check"
          :loading="submitting"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { getWarehouses } from '@/api/warehouses'
import { createSale, type CreateSaleItemInput } from '@/api/sales'
import { getSaleTargets, getSaleInvoiceStatuses, getSalePaymentMethods, createSaleTarget, createSaleInvoiceStatus, createSalePaymentMethod, type SaleMetaItem } from '@/api/saleMeta'
import { type ProductSearchResult } from '@/api/transfers'
import type { WarehouseDTO } from '@ob-inventory/types'
import ProductSearchInput from '@/components/transfers/ProductSearchInput.vue'
import SaleMetaSelect      from './SaleMetaSelect.vue'
import SaleMetaMultiSelect from './SaleMetaMultiSelect.vue'

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

// ── Sale meta (targets + invoice statuses) ────────────────────────────────────

const targets           = ref<SaleMetaItem[]>([])
const invoiceStatuses   = ref<SaleMetaItem[]>([])
const paymentMethods    = ref<SaleMetaItem[]>([])
const loadingMeta       = ref(false)

// ── Warehouses ────────────────────────────────────────────────────────────────

const warehouses        = ref<WarehouseDTO[]>([])
const loadingWarehouses = ref(false)

const mainWarehouse = computed(() => warehouses.value.find(w => w.type === 'main') ?? null)

const warehouseOptions = computed(() =>
  form.value.saleType === 'partner'
    ? warehouses.value.filter(w => w.type !== 'main')
    : warehouses.value,
)

function applyMainWarehouse() {
  if (form.value.saleType === 'direct' && mainWarehouse.value) {
    form.value.warehouseId = mainWarehouse.value.id
  }
}

watch(visible, async (open) => {
  if (!open) return
  if (warehouses.value.length === 0) {
    loadingWarehouses.value = true
    try { warehouses.value = await getWarehouses(); applyMainWarehouse() }
    finally { loadingWarehouses.value = false }
  }
  if (targets.value.length === 0 && invoiceStatuses.value.length === 0 && paymentMethods.value.length === 0) {
    loadingMeta.value = true
    try { [targets.value, invoiceStatuses.value, paymentMethods.value] = await Promise.all([getSaleTargets(), getSaleInvoiceStatuses(), getSalePaymentMethods()]) }
    finally { loadingMeta.value = false }
  }
})

// ── Form state ────────────────────────────────────────────────────────────────

interface SaleItemRow extends ProductSearchResult {
  quantity:  number
  unitPrice: number | null
}

const defaultForm = () => ({
  saleType:         'direct' as 'direct' | 'partner',
  warehouseId:      null as string | null,
  customerName:     '',
  customerEmail:    '',
  customerPhone:    '',
  customerAddress:  '',
  currency:         'ILS',
  notes:            '',
  targetId:         null as string | null,
  invoiceStatusId:  null as string | null,
  paymentMethodIds: [] as string[],
  saleDate:         new Date() as Date,
  items:            [] as SaleItemRow[],
})

const form              = ref(defaultForm())
const submitting        = ref(false)
const error             = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])
const showConfirm       = ref(false)

const confirmWarehouseName = computed(() =>
  warehouses.value.find(w => w.id === form.value.warehouseId)?.name ?? '',
)
const confirmTotalQty = computed(() =>
  form.value.items.reduce((s, i) => s + i.quantity, 0),
)

const typeOptions = [
  { value: 'direct',  label: 'Direct Sale',  icon: 'pi pi-user'     },
  { value: 'partner', label: 'Partner Sale',  icon: 'pi pi-building' },
]

const addedProductIds = computed(() => form.value.items.map(i => i.productId))

const grandTotal = computed(() =>
  form.value.items.reduce((sum, item) => {
    return item.unitPrice != null ? sum + item.unitPrice * item.quantity : sum
  }, 0),
)

const canSubmit = computed(() => {
  if (form.value.items.length === 0) return false
  if (form.value.saleType === 'partner' && !form.value.warehouseId) return false
  return form.value.items.every(i => i.quantity > 0)
})

function onTypeChange(type: 'direct' | 'partner') {
  if (form.value.saleType === type) return   // already selected — don't reset
  form.value.saleType    = type
  form.value.warehouseId = null
  form.value.items       = []
  if (type === 'direct') applyMainWarehouse()
}

function clearItems() {
  form.value.items = []
}

function addItem(result: ProductSearchResult) {
  if (addedProductIds.value.includes(result.productId)) return
  const unitPrice = result.retailPrice != null ? parseFloat(result.retailPrice) : null
  form.value.items.unshift({ ...result, quantity: 1, unitPrice })
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
  error.value = null
  insufficientItems.value = []
  submitting.value = false
}

// ── Submit ────────────────────────────────────────────────────────────────────

function openConfirm() {
  if (!canSubmit.value) return
  error.value = null
  insufficientItems.value = []
  showConfirm.value = true
}

async function submit() {
  if (!canSubmit.value) return

  error.value = null
  insufficientItems.value = []
  submitting.value = true

  try {
    const items: CreateSaleItemInput[] = form.value.items.map(i => ({
      sku:       i.sku,
      name:      i.name,
      quantity:  i.quantity,
      unitPrice: i.unitPrice ?? undefined,
      lineTotal: i.unitPrice != null ? i.unitPrice * i.quantity : undefined,
    }))

    await createSale({
      saleType:         form.value.saleType,
      warehouseId:      form.value.warehouseId      ?? undefined,
      customerName:     form.value.customerName.trim()     || undefined,
      customerEmail:    form.value.customerEmail.trim()    || undefined,
      customerPhone:    form.value.customerPhone.trim()    || undefined,
      customerAddress:  form.value.customerAddress.trim()  || undefined,
      currency:         form.value.currency.trim()         || 'ILS',
      notes:            form.value.notes.trim()            || undefined,
      targetId:         form.value.targetId        ?? undefined,
      invoiceStatusId:  form.value.invoiceStatusId ?? undefined,
      paymentMethodIds: form.value.paymentMethodIds.length ? form.value.paymentMethodIds : undefined,
      saleDate:         form.value.saleDate.toISOString(),
      items,
    })

    showConfirm.value = false
    visible.value = false
    emit('created')
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string; code?: string; items?: typeof insufficientItems.value } } }
    showConfirm.value = false
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
  gap: 16px;
  padding-bottom: 8px;
}

.form-row {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  flex-wrap: wrap;
}

.form-row-customer {
  align-items: stretch;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.field-sm { flex: 0 0 100px; }
.field-full { flex: 1 1 100%; min-width: 100%; }

label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.required { color: var(--p-red-500); }

.type-toggle { display: flex; gap: 8px; }

/* ── Items ── */
.items-section {
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  overflow: hidden;
}

.items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--p-surface-100, #f8fafc);
  border-bottom: 1px solid var(--p-content-border-color);
}

.items-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.items-count {
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.items-list { display: flex; flex-direction: column; }

.items-list-head {
  display: grid;
  grid-template-columns: 1fr 160px 110px 80px 36px;
  gap: 8px;
  padding: 6px 12px;
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-content-border-color);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}

.item-row {
  display: grid;
  grid-template-columns: 1fr 160px 110px 80px 36px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.item-row:last-child { border-bottom: none; }

.item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.item-sku {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-color);
}

.item-name {
  font-size: 13px;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-attrs {
  font-size: 11px;
  color: var(--p-text-muted-color);
  opacity: 0.7;
}

/* Qty stepper (same as transfers) */
.qty-stepper {
  display: flex;
  align-items: center;
  gap: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  overflow: hidden;
  height: 32px;
}

.qty-btn {
  width: 28px;
  height: 100%;
  border: none;
  background: var(--p-surface-100, #f1f5f9);
  color: var(--p-text-color);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  transition: background 0.12s;
  flex-shrink: 0;
}

.qty-btn:hover:not(:disabled) { background: var(--p-surface-200, #e2e8f0); }
.qty-btn:disabled { opacity: 0.4; cursor: default; }

.qty-input {
  width: 44px;
  height: 100%;
  border: none;
  border-left: 1px solid var(--p-content-border-color);
  border-right: 1px solid var(--p-content-border-color);
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
  background: var(--p-surface-0, #fff);
  outline: none;
  -moz-appearance: textfield;
}
.qty-input::-webkit-outer-spin-button,
.qty-input::-webkit-inner-spin-button { -webkit-appearance: none; }

.price-input { width: 100%; }

.col-product  { min-width: 0; }
.col-qty-wrap { display: flex; align-items: center; gap: 6px; }
.col-qty      { justify-self: start; }
.col-price    { justify-self: stretch; }
.col-total    { justify-self: end; }
.col-remove   { justify-self: center; }

.item-available {
  font-size: 11px;
  color: var(--p-text-muted-color);
  white-space: nowrap;
}

.line-total {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-color);
  text-align: right;
}

.grand-total-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 10px 14px;
  background: var(--p-surface-50, #f8fafc);
  border-top: 2px solid var(--p-content-border-color);
}

.grand-total-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.grand-total-value {
  font-size: 16px;
  font-weight: 700;
  color: var(--p-primary-color);
  font-variant-numeric: tabular-nums;
}

.items-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--p-text-muted-color);
  font-size: 14px;
  border: 1px dashed var(--p-content-border-color);
  border-radius: 10px;
}

.items-empty .pi { font-size: 18px; opacity: 0.5; }

/* Footer */
.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-top: 12px;
}

.footer-summary {
  font-size: 13px;
  color: var(--p-text-muted-color);
  font-weight: 500;
}

.footer-actions { display: flex; gap: 8px; }

.stock-error-list { margin: 4px 0 0; padding-left: 18px; }

/* Confirmation dialog */
.confirm-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}

.confirm-meta {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.confirm-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  background: var(--p-primary-50, #eff6ff);
  color: var(--p-primary-color);
  font-size: 13px;
  font-weight: 600;
  width: fit-content;
}

.confirm-warehouse-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.confirm-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
  min-width: 70px;
}

.confirm-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  padding: 10px 14px;
  background: var(--p-surface-50, #f8fafc);
  border-radius: 8px;
  border: 1px solid var(--p-content-border-color);
}

.confirm-dot { color: var(--p-text-muted-color); }

.confirm-question {
  font-size: 14px;
  color: var(--p-text-color);
  margin: 0;
}

.confirm-footer-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  width: 100%;
}

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .create-sale-form { gap: 12px; padding-bottom: 4px; }

  .form-row {
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }

  .field-sm { flex: 1 1 auto; }
  .field-full { min-width: 0; }

  .type-toggle { flex-wrap: wrap; }

  .items-header { padding: 8px 12px; }
  .items-list-head { display: none; }

  .item-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    align-items: stretch;
  }

  .item-row .col-product { order: 1; }
  .item-row .col-qty-wrap { order: 2; display: flex; align-items: center; gap: 8px; }
  .item-row .col-price { order: 3; }
  .item-row .col-total { order: 4; text-align: left; }
  .item-row .col-remove { order: 5; justify-self: start; }

  .item-name { white-space: normal; word-break: break-word; }
  .item-sku { font-size: 11px; }
  .item-name { font-size: 12px; }

  .qty-stepper { height: 28px; }
  .qty-btn { width: 24px; }
  .qty-input { width: 34px; font-size: 12px; }

  .grand-total-row { padding: 8px 12px; flex-wrap: wrap; }

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

  .confirm-body { gap: 12px; padding: 8px 0; }
  .confirm-stats { flex-wrap: wrap; padding: 8px 12px; }

  .confirm-footer-row {
    flex-direction: column-reverse;
    align-items: stretch;
  }

  .confirm-footer-row .p-button {
    width: 100%;
    justify-content: center;
  }
}
</style>
