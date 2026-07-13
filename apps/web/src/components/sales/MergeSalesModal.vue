<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="Create Merged Sale"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @hide="resetForm"
  >
    <div v-if="loadingPreview" class="preview-loading">
      <i class="pi pi-spin pi-spinner" />
      <span>Loading selected sales…</span>
    </div>

    <div v-else class="create-sale-form">
      <div class="merge-banner">
        <i class="pi pi-share-alt" />
        <span>Merging <strong>{{ saleIds.length }}</strong> sales · type will be <strong>Merged Sale</strong></span>
      </div>

      <!-- Warehouse (read-only — locked to originals) -->
      <div class="field">
        <label>Warehouse</label>
        <InputText :model-value="warehouseName" disabled fluid />
      </div>

      <!-- Customer lookup -->
      <CustomerSearchInput
        ref="customerSearchRef"
        @select="applyCustomer"
        @clear="clearCustomer"
      />

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
        <div class="field">
          <label>ID / ח.פ.</label>
          <InputText v-model="form.customerIdNumber" placeholder="Optional" fluid />
        </div>
        <div class="field field-full">
          <label>Customer Address</label>
          <InputText v-model="form.customerAddress" placeholder="Optional — street, city, zip…" fluid />
        </div>
      </div>

      <div v-if="showCreateCustomerToggle" class="create-customer-row">
        <Checkbox v-model="form.createCustomer" :binary="true" input-id="mergeCreateCustomerChk" />
        <label for="mergeCreateCustomerChk" class="create-customer-label">
          Save as new customer
          <span class="create-customer-hint">(email will be used as unique identifier)</span>
        </label>
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

          <div v-for="(item, idx) in form.items" :key="item.sku + (item.productId ?? '')" class="item-row">
            <div class="item-info col-product">
              <span class="item-sku">{{ item.sku }}</span>
              <span class="item-name">{{ item.name }}</span>
              <span v-if="item.model || item.size || item.color" class="item-attrs">
                {{ [item.model, item.size, item.color].filter(Boolean).join(' · ') }}
              </span>
            </div>

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
                  :max="maxQty(item)"
                  @blur="clampQty(idx)"
                />
                <button
                  class="qty-btn"
                  :disabled="item.quantity >= maxQty(item)"
                  @click="item.quantity = Math.min(maxQty(item), item.quantity + 1)"
                >+</button>
              </div>
              <span class="item-available">/ {{ maxQty(item) }}</span>
            </div>

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

            <span class="line-total col-total">
              {{ item.unitPrice != null ? (item.unitPrice * item.quantity).toFixed(2) : '—' }}
            </span>

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
        <Textarea v-model="form.notes" rows="4" placeholder="Merge summary…" fluid />
      </div>

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
        <div class="footer-left">
          <span v-if="form.items.length > 0" class="footer-summary">
            {{ form.items.length }} product{{ form.items.length !== 1 ? 's' : '' }} ·
            {{ grandTotal.toFixed(2) }} {{ form.currency }}
          </span>
          <div class="delete-originals-row">
            <Checkbox v-model="form.supersedeOriginals" :binary="true" input-id="supersedeOriginalsChk" />
            <label for="supersedeOriginalsChk" class="delete-originals-label">
              Mark originals as merged
              <span class="create-customer-hint">(clears items, keeps Woo/Cardcom records)</span>
            </label>
          </div>
        </div>
        <div class="footer-actions">
          <Button label="Cancel" severity="secondary" outlined @click="visible = false" />
          <Button
            label="Create the Sale"
            icon="pi pi-check"
            :disabled="!canSubmit || loadingPreview"
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
    header="Confirm Merged Sale"
    :style="{ width: '440px' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    :closable="!submitting"
  >
    <div class="confirm-body">
      <div class="confirm-meta">
        <div class="confirm-type-badge">
          <i class="pi pi-share-alt" />
          Merged Sale
        </div>
        <div v-if="warehouseName" class="confirm-warehouse-row">
          <span class="confirm-label">Warehouse</span>
          <strong>{{ warehouseName }}</strong>
        </div>
        <div v-if="form.customerName" class="confirm-warehouse-row">
          <span class="confirm-label">Customer</span>
          <strong>{{ form.customerName }}</strong>
        </div>
        <div class="confirm-warehouse-row">
          <span class="confirm-label">Originals</span>
          <strong>
            {{ form.supersedeOriginals
              ? `${saleIds.length} sales will be marked as merged (items cleared)`
              : `${saleIds.length} sales will be left unchanged` }}
          </strong>
        </div>
      </div>

      <div class="confirm-stats">
        <span><strong>{{ form.items.length }}</strong> product{{ form.items.length !== 1 ? 's' : '' }}</span>
        <span class="confirm-dot">·</span>
        <span><strong>{{ confirmTotalQty }}</strong> units</span>
        <span class="confirm-dot">·</span>
        <span><strong>{{ grandTotal.toFixed(2) }}</strong> {{ form.currency }}</span>
      </div>

      <p class="confirm-question">Are you sure you want to create this merged sale?</p>
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
import { getWarehouses } from '@/api/warehouses'
import {
  getMergePreview,
  mergeSales,
  type CreateSaleItemInput,
} from '@/api/sales'
import {
  getSaleTargets,
  getSaleInvoiceStatuses,
  getSalePaymentMethods,
  createSaleTarget,
  createSaleInvoiceStatus,
  createSalePaymentMethod,
  type SaleMetaItem,
} from '@/api/saleMeta'
import { type ProductSearchResult } from '@/api/transfers'
import type { WarehouseDTO } from '@ob-inventory/types'
import type { Customer } from '@/api/customers'
import Checkbox            from 'primevue/checkbox'
import ProductSearchInput  from '@/components/transfers/ProductSearchInput.vue'
import SaleMetaSelect      from './SaleMetaSelect.vue'
import SaleMetaMultiSelect from './SaleMetaMultiSelect.vue'
import CustomerSearchInput from './CustomerSearchInput.vue'

const props = defineProps<{
  modelValue: boolean
  saleIds: string[]
}>()
const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'created'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const targets         = ref<SaleMetaItem[]>([])
const invoiceStatuses = ref<SaleMetaItem[]>([])
const paymentMethods  = ref<SaleMetaItem[]>([])
const loadingMeta     = ref(false)
const warehouses      = ref<WarehouseDTO[]>([])
const loadingPreview  = ref(false)

interface SaleItemRow {
  productId:    string | null
  sku:          string
  name:         string
  quantity:     number
  carriedQty:   number
  unitPrice:    number | null
  availableQty: number
  model:        string | null
  size:         string | null
  color:        string | null
}

const defaultForm = () => ({
  warehouseId:      null as string | null,
  customerName:     '',
  customerEmail:    '',
  customerPhone:    '',
  customerAddress:  '',
  customerIdNumber: '',
  currency:         'ILS',
  notes:            '',
  targetId:         null as string | null,
  invoiceStatusId:  null as string | null,
  paymentMethodIds: [] as string[],
  saleDate:         new Date() as Date,
  createCustomer:   true,
  supersedeOriginals: true,
  items:            [] as SaleItemRow[],
})

const form              = ref(defaultForm())
const submitting        = ref(false)
const error             = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])
const showConfirm       = ref(false)

const warehouseName = computed(() =>
  warehouses.value.find(w => w.id === form.value.warehouseId)?.name ?? '',
)
const confirmTotalQty = computed(() =>
  form.value.items.reduce((s, i) => s + i.quantity, 0),
)
const addedProductIds = computed(() =>
  form.value.items.map(i => i.productId).filter((id): id is string => !!id),
)
const grandTotal = computed(() =>
  form.value.items.reduce((sum, item) => {
    return item.unitPrice != null ? sum + item.unitPrice * item.quantity : sum
  }, 0),
)
const canSubmit = computed(() =>
  form.value.items.length > 0
  && !!form.value.warehouseId
  && form.value.items.every(i => i.quantity > 0),
)

function maxQty(item: SaleItemRow) {
  // Carried stock was already deducted; admin can go up to available + carried
  return Math.max(1, item.availableQty + item.carriedQty)
}

function clampQty(idx: number) {
  const item = form.value.items[idx]
  if (!item) return
  if (item.quantity < 1) item.quantity = 1
  const max = maxQty(item)
  if (item.quantity > max) item.quantity = max
}

function addItem(result: ProductSearchResult) {
  if (addedProductIds.value.includes(result.productId)) return
  const unitPrice = result.retailPrice != null ? parseFloat(result.retailPrice) : null
  form.value.items.unshift({
    productId:    result.productId,
    sku:          result.sku,
    name:         result.name,
    quantity:     1,
    carriedQty:   0,
    unitPrice,
    availableQty: result.availableQty,
    model:        result.model ?? null,
    size:         result.size ?? null,
    color:        result.color ?? null,
  })
}

function removeItem(idx: number) {
  form.value.items.splice(idx, 1)
}

const customerSearchRef = ref<InstanceType<typeof CustomerSearchInput> | null>(null)
const customerSelectedFromLookup = ref(false)

const showCreateCustomerToggle = computed(() =>
  !customerSelectedFromLookup.value && !!form.value.customerEmail.trim(),
)

function applyCustomer(c: Customer) {
  customerSelectedFromLookup.value = true
  form.value.customerName     = c.name     ?? ''
  form.value.customerEmail    = c.email    ?? ''
  form.value.customerPhone    = c.phone    ?? ''
  form.value.customerAddress  = c.address  ?? ''
  form.value.customerIdNumber = c.idNumber ?? ''
}

function clearCustomer() {
  customerSelectedFromLookup.value = false
  form.value.customerName     = ''
  form.value.customerEmail    = ''
  form.value.customerPhone    = ''
  form.value.customerAddress  = ''
  form.value.customerIdNumber = ''
}

function resetForm() {
  form.value = defaultForm()
  error.value = null
  insufficientItems.value = []
  submitting.value = false
  customerSelectedFromLookup.value = false
  customerSearchRef.value?.reset()
}

async function loadPreview() {
  if (props.saleIds.length < 2) return
  loadingPreview.value = true
  error.value = null
  try {
    if (warehouses.value.length === 0) {
      warehouses.value = await getWarehouses()
    }
    if (targets.value.length === 0 && invoiceStatuses.value.length === 0 && paymentMethods.value.length === 0) {
      loadingMeta.value = true
      try {
        ;[targets.value, invoiceStatuses.value, paymentMethods.value] = await Promise.all([
          getSaleTargets(),
          getSaleInvoiceStatuses(),
          getSalePaymentMethods(),
        ])
      } finally {
        loadingMeta.value = false
      }
    }

    const preview = await getMergePreview(props.saleIds)
    form.value.warehouseId      = preview.warehouseId
    form.value.currency         = preview.currency || 'ILS'
    form.value.customerName     = preview.customerName     ?? ''
    form.value.customerEmail    = preview.customerEmail    ?? ''
    form.value.customerPhone    = preview.customerPhone    ?? ''
    form.value.customerAddress  = preview.customerAddress  ?? ''
    form.value.customerIdNumber = preview.customerIdNumber ?? ''
    form.value.targetId         = preview.targetId
    form.value.invoiceStatusId  = preview.invoiceStatusId
    form.value.paymentMethodIds = preview.paymentMethodIds ?? []
    form.value.saleDate         = new Date()
    form.value.notes            = preview.notes ?? ''
    form.value.supersedeOriginals = true
    form.value.createCustomer   = true
    form.value.items = preview.items.map(i => ({
      productId:    i.productId,
      sku:          i.sku,
      name:         i.name,
      quantity:     i.quantity,
      carriedQty:   i.carriedQty,
      unitPrice:    i.unitPrice,
      availableQty: i.availableQty,
      model:        i.model,
      size:         i.size,
      color:        i.color,
    }))

    if (preview.customerEmail) {
      customerSelectedFromLookup.value = true
    }
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } } }
    error.value = axiosErr.response?.data?.error ?? 'Failed to load merge preview'
  } finally {
    loadingPreview.value = false
  }
}

watch(visible, (open) => {
  if (open) loadPreview()
})

function openConfirm() {
  if (!canSubmit.value) return
  error.value = null
  insufficientItems.value = []
  showConfirm.value = true
}

async function submit() {
  if (!canSubmit.value || !form.value.warehouseId) return

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

    await mergeSales({
      saleIds:          props.saleIds,
      supersedeOriginals: form.value.supersedeOriginals,
      warehouseId:      form.value.warehouseId,
      customerName:     form.value.customerName.trim()     || undefined,
      customerEmail:    form.value.customerEmail.trim()    || undefined,
      customerPhone:    form.value.customerPhone.trim()    || undefined,
      customerAddress:  form.value.customerAddress.trim()  || undefined,
      customerIdNumber: form.value.customerIdNumber.trim() || undefined,
      currency:         form.value.currency.trim()         || 'ILS',
      notes:            form.value.notes.trim()            || undefined,
      targetId:         form.value.targetId        ?? undefined,
      invoiceStatusId:  form.value.invoiceStatusId ?? undefined,
      paymentMethodIds: form.value.paymentMethodIds.length ? form.value.paymentMethodIds : undefined,
      saleDate:         form.value.saleDate.toISOString(),
      createCustomer:   showCreateCustomerToggle.value ? form.value.createCustomer : false,
      items,
    })

    showConfirm.value = false
    visible.value = false
    emit('created')
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string; code?: string; items?: typeof insufficientItems.value }; status?: number }; message?: string }
    showConfirm.value = false
    if (axiosErr.response?.data?.code === 'INSUFFICIENT_STOCK') {
      insufficientItems.value = axiosErr.response.data.items ?? []
    } else {
      error.value = axiosErr.response?.data?.error
        ?? (axiosErr.response?.status ? `Request failed (${axiosErr.response.status})` : null)
        ?? axiosErr.message
        ?? 'An unexpected error occurred'
    }
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 48px 20px;
  color: var(--p-text-muted-color);
  font-size: 14px;
}

.merge-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--p-primary-50, #eff6ff);
  border: 1px solid var(--p-primary-200, #bfdbfe);
  border-radius: 8px;
  font-size: 13px;
  color: var(--p-primary-color);
}

.create-customer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--p-surface-50, #f8fafc);
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 6px;
}

.create-customer-label { font-size: 0.875rem; cursor: pointer; }
.create-customer-hint {
  font-size: 0.75rem;
  color: var(--p-text-muted-color, #94a3b8);
  margin-left: 4px;
}

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

.form-row-customer { align-items: stretch; }

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

.items-count { font-size: 12px; color: var(--p-text-muted-color); }

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

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-top: 12px;
  gap: 12px;
  flex-wrap: wrap;
}

.footer-left {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.footer-summary {
  font-size: 13px;
  color: var(--p-text-muted-color);
  font-weight: 500;
}

.delete-originals-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.delete-originals-label {
  font-size: 13px;
  font-weight: 500;
  text-transform: none;
  letter-spacing: 0;
  color: var(--p-text-color);
  cursor: pointer;
}

.footer-actions { display: flex; gap: 8px; }

.stock-error-list { margin: 4px 0 0; padding-left: 18px; }

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

@media (max-width: 768px) {
  .create-sale-form { gap: 12px; padding-bottom: 4px; }

  .form-row {
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
  }

  .field-sm { flex: 1 1 auto; }
  .field-full { min-width: 0; }

  .items-header { padding: 8px 12px; }
  .items-list-head { display: none; }

  .item-row {
    display: grid;
    grid-template-columns: auto minmax(72px, 1fr) auto auto;
    gap: 8px 6px;
    padding: 10px 12px;
    align-items: center;
  }

  .item-row .col-product {
    grid-column: 1 / -1;
    min-width: 0;
  }

  .item-row .col-qty-wrap {
    display: flex;
    align-items: center;
  }

  .item-row .col-price { min-width: 0; }
  .item-row .col-price :deep(.p-inputnumber),
  .item-row .col-price :deep(.p-inputtext) { width: 100%; }

  .item-row .col-total {
    text-align: right;
    font-size: 12px;
    white-space: nowrap;
  }

  .item-row .col-remove { justify-self: end; }

  .item-name { white-space: normal; word-break: break-word; font-size: 12px; }
  .item-sku { font-size: 11px; }

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
