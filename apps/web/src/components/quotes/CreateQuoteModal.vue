<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="editing ? `Edit Quote #${editing.quoteNumber}` : 'New Price Quote'"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @hide="resetForm"
  >
    <div class="create-quote-form">
      <div class="field">
        <label>Warehouse</label>
        <Select
          v-model="form.warehouseId"
          :options="warehouseOptions"
          option-label="name"
          option-value="id"
          placeholder="Select warehouse…"
          :loading="loadingWarehouses"
          fluid
          append-to="body"
          @change="clearItems"
        />
      </div>

      <CustomerSearchInput
        ref="customerSearchRef"
        @select="applyCustomer"
        @clear="clearCustomer"
      />

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
        <Checkbox v-model="form.createCustomer" :binary="true" input-id="createQuoteCustomerChk" />
        <label for="createQuoteCustomerChk" class="create-customer-label">
          Save as new customer
          <span class="create-customer-hint">(email will be used as unique identifier)</span>
        </label>
      </div>

      <div class="field field-date">
        <label>Quote Date</label>
        <DatePicker
          v-model="form.quoteDate"
          date-format="dd/mm/yy"
          :show-icon="true"
          :show-button-bar="true"
          fluid
          append-to="body"
        />
      </div>

      <ProductSearchInput
        :warehouse-id="form.warehouseId"
        :added-ids="addedProductIds"
        @select="addItem"
      />

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
            <div class="item-info col-product">
              <span class="item-sku">{{ item.sku }}</span>
              <span class="item-name">{{ item.name }}</span>
              <span v-if="item.model || item.size || item.color" class="item-attrs">
                {{ [item.model, item.size, item.color].filter(Boolean).join(' · ') }}
              </span>
            </div>
            <div class="col-qty-wrap">
              <div class="qty-stepper">
                <button class="qty-btn" :disabled="item.quantity <= 1" @click="item.quantity = Math.max(1, item.quantity - 1)">−</button>
                <input v-model.number="item.quantity" type="number" class="qty-input" :min="1" @blur="clampQty(idx)" />
                <button class="qty-btn" @click="item.quantity += 1">+</button>
              </div>
              <span class="item-available">{{ item.availableQty }} in stock</span>
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
              <Button icon="pi pi-times" text rounded severity="secondary" size="small" @click="removeItem(idx)" />
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

      <div class="field">
        <label>Notes</label>
        <Textarea v-model="form.notes" rows="2" placeholder="Optional notes printed on the quote…" fluid />
      </div>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
    </div>

    <template #footer>
      <div class="footer-row">
        <span v-if="form.items.length > 0" class="footer-summary">
          {{ form.items.length }} product{{ form.items.length !== 1 ? 's' : '' }} ·
          {{ grandTotal.toFixed(2) }} {{ form.currency }}
          <span class="footer-hint"> · stock is not reserved</span>
        </span>
        <div class="footer-actions">
          <Button label="Cancel" severity="secondary" outlined @click="visible = false" />
          <Button
            :label="editing ? 'Save Quote' : 'Create Quote'"
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
import { getWarehouses } from '@/api/warehouses'
import { createQuote, updateQuote, type QuoteDetail, type QuoteItemInput } from '@/api/quotes'
import { type ProductSearchResult } from '@/api/transfers'
import type { WarehouseDTO } from '@ob-inventory/types'
import type { Customer } from '@/api/customers'
import Checkbox from 'primevue/checkbox'
import ProductSearchInput from '@/components/transfers/ProductSearchInput.vue'
import CustomerSearchInput from '@/components/sales/CustomerSearchInput.vue'

const props = defineProps<{
  modelValue: boolean
  quote?: QuoteDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const editing = computed(() => props.quote ?? null)

interface QuoteItemRow extends ProductSearchResult {
  quantity:  number
  unitPrice: number | null
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
  quoteDate:        new Date() as Date,
  createCustomer:   true,
  items:            [] as QuoteItemRow[],
})

const form = ref(defaultForm())
const submitting = ref(false)
const error = ref<string | null>(null)
const warehouses = ref<WarehouseDTO[]>([])
const loadingWarehouses = ref(false)
const customerSearchRef = ref<InstanceType<typeof CustomerSearchInput> | null>(null)
const customerSelectedFromLookup = ref(false)

const mainWarehouse = computed(() => warehouses.value.find(w => w.type === 'main') ?? null)
const warehouseOptions = computed(() => warehouses.value.filter(w => w.type === 'main'))

const addedProductIds = computed(() => form.value.items.map(i => i.productId))
const grandTotal = computed(() =>
  form.value.items.reduce((sum, item) => item.unitPrice != null ? sum + item.unitPrice * item.quantity : sum, 0),
)
const canSubmit = computed(() => form.value.items.length > 0 && form.value.items.every(i => i.quantity > 0))
const showCreateCustomerToggle = computed(() =>
  !customerSelectedFromLookup.value && !!form.value.customerEmail.trim(),
)

function applyDefaultWarehouse() {
  const target = mainWarehouse.value ?? warehouses.value[0] ?? null
  if (target) form.value.warehouseId = target.id
}

function populateFromQuote(quote: QuoteDetail) {
  form.value.warehouseId      = quote.warehouseId
  form.value.customerName     = quote.customerName     ?? ''
  form.value.customerEmail    = quote.customerEmail    ?? ''
  form.value.customerPhone    = quote.customerPhone    ?? ''
  form.value.customerAddress  = quote.customerAddress  ?? ''
  form.value.customerIdNumber = quote.customerIdNumber ?? ''
  form.value.currency         = quote.currency || 'ILS'
  form.value.notes            = quote.notes ?? ''
  form.value.quoteDate        = new Date(quote.quoteDate)
  form.value.createCustomer   = false
  form.value.items = quote.items.map(i => ({
    productId:    i.productId ?? i.sku,
    sku:          i.sku,
    name:         i.name,
    brandName:    null,
    categoryName: null,
    availableQty: 0,
    model:        null,
    size:         null,
    color:        null,
    retailPrice:  i.unitPrice,
    quantity:     i.quantity,
    unitPrice:    i.unitPrice != null ? parseFloat(i.unitPrice) : null,
  }))
}

watch(visible, async (open) => {
  if (!open) return
  if (warehouses.value.length === 0) {
    loadingWarehouses.value = true
    try {
      warehouses.value = await getWarehouses()
    } finally {
      loadingWarehouses.value = false
    }
  }
  if (props.quote) populateFromQuote(props.quote)
  else applyDefaultWarehouse()
})

function clearItems() { form.value.items = [] }

function addItem(result: ProductSearchResult) {
  if (addedProductIds.value.includes(result.productId)) return
  const unitPrice = result.retailPrice != null ? parseFloat(result.retailPrice) : null
  form.value.items.unshift({ ...result, quantity: 1, unitPrice })
}

function removeItem(idx: number) { form.value.items.splice(idx, 1) }

function clampQty(idx: number) {
  const item = form.value.items[idx]
  if (!item) return
  if (!item.quantity || item.quantity < 1) item.quantity = 1
}

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
  submitting.value = false
  customerSelectedFromLookup.value = false
  customerSearchRef.value?.reset()
}

function payloadItems(): QuoteItemInput[] {
  return form.value.items.map(i => ({
    sku:       i.sku,
    name:      i.name,
    quantity:  i.quantity,
    unitPrice: i.unitPrice ?? undefined,
    lineTotal: i.unitPrice != null ? i.unitPrice * i.quantity : undefined,
  }))
}

async function submit() {
  if (!canSubmit.value) return
  error.value = null
  submitting.value = true
  try {
    const payload = {
      warehouseId:      form.value.warehouseId ?? undefined,
      customerName:     form.value.customerName.trim()     || undefined,
      customerEmail:    form.value.customerEmail.trim()    || undefined,
      customerPhone:    form.value.customerPhone.trim()    || undefined,
      customerAddress:  form.value.customerAddress.trim()  || undefined,
      customerIdNumber: form.value.customerIdNumber.trim() || undefined,
      currency:         form.value.currency.trim()         || 'ILS',
      notes:            form.value.notes.trim()            || undefined,
      quoteDate:        form.value.quoteDate.toISOString(),
      createCustomer:   showCreateCustomerToggle.value ? form.value.createCustomer : false,
      items:            payloadItems(),
    }
    if (editing.value) await updateQuote(editing.value.id, payload)
    else await createQuote(payload)
    visible.value = false
    emit('saved')
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: { error?: string } } }
    error.value = axiosErr.response?.data?.error ?? 'An unexpected error occurred'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
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
.create-customer-hint { font-size: 0.75rem; color: var(--p-text-muted-color, #94a3b8); margin-left: 4px; }
.create-quote-form { display: flex; flex-direction: column; gap: 16px; padding-bottom: 8px; }
.form-row { display: flex; gap: 16px; align-items: flex-end; flex-wrap: wrap; }
.form-row-customer { align-items: stretch; }
.field { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
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
.items-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--p-text-muted-color); }
.items-count { font-size: 12px; color: var(--p-text-muted-color); }
.items-list-head, .item-row {
  display: grid;
  grid-template-columns: 1fr 160px 110px 80px 36px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
}
.items-list-head {
  background: var(--p-surface-50, #f8fafc);
  border-bottom: 1px solid var(--p-content-border-color);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-text-muted-color);
}
.item-row { border-bottom: 1px solid var(--p-content-border-color); }
.item-row:last-child { border-bottom: none; }
.item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.item-sku { font-family: 'Courier New', monospace; font-size: 12px; font-weight: 600; }
.item-name { font-size: 13px; color: var(--p-text-muted-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.item-attrs { font-size: 11px; color: var(--p-text-muted-color); opacity: 0.7; }
.qty-stepper {
  display: flex;
  align-items: center;
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
  cursor: pointer;
  flex-shrink: 0;
}
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
  outline: none;
}
.col-qty-wrap { display: flex; align-items: center; gap: 6px; }
.item-available { font-size: 11px; color: var(--p-text-muted-color); white-space: nowrap; }
.line-total { font-size: 13px; font-weight: 600; text-align: right; }
.grand-total-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 16px;
  padding: 10px 14px;
  background: var(--p-surface-50, #f8fafc);
  border-top: 2px solid var(--p-content-border-color);
}
.grand-total-label { font-size: 13px; font-weight: 600; color: var(--p-text-muted-color); text-transform: uppercase; }
.grand-total-value { font-size: 16px; font-weight: 700; color: var(--p-primary-color); }
.items-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 24px;
  color: var(--p-text-muted-color);
  border: 1px dashed var(--p-content-border-color);
  border-radius: 10px;
}
.footer-row { display: flex; align-items: center; justify-content: space-between; width: 100%; padding-top: 12px; }
.footer-summary { font-size: 13px; color: var(--p-text-muted-color); }
.footer-hint { color: #94a3b8; }
.footer-actions { display: flex; gap: 8px; }
@media (max-width: 768px) {
  .form-row { flex-direction: column; align-items: stretch; }
  .items-list-head { display: none; }
  .item-row { grid-template-columns: auto minmax(72px, 1fr) auto auto; }
  .item-row .col-product { grid-column: 1 / -1; }
  .footer-row { flex-direction: column; align-items: stretch; gap: 12px; }
  .footer-actions { flex-direction: column-reverse; }
}
</style>
