<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="Edit Sale"
    :style="{ width: '820px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
    @hide="resetForm"
  >
    <div class="edit-sale-form">

      <!-- Sale type + warehouse (read-only) -->
      <div class="form-row form-row-meta">
        <div class="field">
          <label>Sale Type</label>
          <div class="meta-badge">
            <i :class="sale?.saleType === 'partner' ? 'pi pi-building' : 'pi pi-user'" />
            {{ sale?.saleType === 'direct' ? 'Direct Sale' : sale?.saleType === 'partner' ? 'Partner Sale' : 'WooCommerce' }}
          </div>
        </div>
        <div class="field">
          <label>Warehouse</label>
          <div class="meta-badge meta-badge-wh">{{ sale?.warehouseName ?? '—' }}</div>
        </div>
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
          <SaleMetaSelect
            v-model="form.paymentMethodId"
            :options="paymentMethods"
            label="Payment Method"
            placeholder="Select method…"
            :loading="loadingMeta"
            :create-fn="createSalePaymentMethod"
            @created="paymentMethods.push($event)"
          />
        </div>
      </div>

      <!-- Product search -->
      <ProductSearchInput
        :warehouse-id="sale?.warehouseId ?? null"
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

          <div v-for="(item, idx) in form.items" :key="item.productId ?? item.sku" class="item-row">
            <div class="item-info col-product">
              <span class="item-sku">{{ item.sku }}</span>
              <span class="item-name">{{ item.name }}</span>
            </div>

            <div class="col-qty-wrap">
              <div class="qty-stepper">
                <button class="qty-btn" :disabled="item.quantity <= 1" @click="item.quantity = Math.max(1, item.quantity - 1)">−</button>
                <input
                  v-model.number="item.quantity"
                  type="number"
                  class="qty-input"
                  :min="1"
                  @blur="clampQty(idx)"
                />
                <button class="qty-btn" @click="item.quantity++">+</button>
              </div>
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
        <span>No items — use the search above to add products</span>
      </div>

      <!-- Notes -->
      <div class="field">
        <label>Notes</label>
        <Textarea v-model="form.notes" rows="2" placeholder="Optional notes…" fluid />
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
        <span v-if="form.items.length > 0" class="footer-summary">
          {{ form.items.length }} product{{ form.items.length !== 1 ? 's' : '' }} ·
          {{ grandTotal.toFixed(2) }} {{ form.currency }}
        </span>
        <div class="footer-actions">
          <Button label="Cancel" severity="secondary" outlined @click="visible = false" />
          <Button label="Save Changes" icon="pi pi-check" :disabled="!canSubmit" :loading="submitting" @click="submit" />
        </div>
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { updateSale, type SaleDetail } from '@/api/sales'
import { getSaleTargets, getSaleInvoiceStatuses, getSalePaymentMethods, createSaleTarget, createSaleInvoiceStatus, createSalePaymentMethod, type SaleMetaItem } from '@/api/saleMeta'
import { type ProductSearchResult } from '@/api/transfers'
import ProductSearchInput from '@/components/transfers/ProductSearchInput.vue'
import SaleMetaSelect from './SaleMetaSelect.vue'

const props = defineProps<{ modelValue: boolean; sale: SaleDetail | null }>()
const emit  = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'updated'): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

// ── Form state ────────────────────────────────────────────────────────────────

interface SaleItemRow {
  productId:  string | null
  sku:        string
  name:       string
  quantity:   number
  unitPrice:  number | null
}

const targets         = ref<SaleMetaItem[]>([])
const invoiceStatuses = ref<SaleMetaItem[]>([])
const paymentMethods  = ref<SaleMetaItem[]>([])
const loadingMeta     = ref(false)

const defaultForm = () => ({
  customerName:    '',
  customerEmail:   '',
  customerPhone:   '',
  customerAddress: '',
  currency:        'ILS',
  notes:           '',
  targetId:        null as string | null,
  invoiceStatusId: null as string | null,
  paymentMethodId: null as string | null,
  items:           [] as SaleItemRow[],
})

const form              = ref(defaultForm())
const submitting        = ref(false)
const error             = ref<string | null>(null)
const insufficientItems = ref<{ sku: string; requested: number; available: number }[]>([])

// Load meta options once
watch(() => props.modelValue, async (open) => {
  if (!open) return
  if (targets.value.length === 0 && invoiceStatuses.value.length === 0 && paymentMethods.value.length === 0) {
    loadingMeta.value = true
    try { [targets.value, invoiceStatuses.value, paymentMethods.value] = await Promise.all([getSaleTargets(), getSaleInvoiceStatuses(), getSalePaymentMethods()]) }
    finally { loadingMeta.value = false }
  }
})

// Pre-fill when modal opens with a sale
watch(() => props.sale, (sale) => {
  if (!sale) return
  form.value.customerName    = sale.customerName    ?? ''
  form.value.customerEmail   = sale.customerEmail   ?? ''
  form.value.customerPhone   = sale.customerPhone   ?? ''
  form.value.customerAddress = sale.customerAddress ?? ''
  form.value.currency        = sale.currency        ?? 'ILS'
  form.value.notes           = sale.notes           ?? ''
  form.value.targetId        = sale.targetId        ?? null
  form.value.invoiceStatusId = sale.invoiceStatusId ?? null
  form.value.paymentMethodId = sale.paymentMethodId ?? null
  form.value.items = (sale.items ?? []).map(item => ({
    productId: item.productId,
    sku:       item.sku,
    name:      item.name,
    quantity:  item.quantity,
    unitPrice: item.unitPrice ? parseFloat(item.unitPrice) : null,
  }))
}, { immediate: true })

const addedProductIds = computed(() => form.value.items.map(i => i.productId).filter(Boolean) as string[])

const grandTotal = computed(() =>
  form.value.items.reduce((sum, item) =>
    item.unitPrice != null ? sum + item.unitPrice * item.quantity : sum, 0),
)

const canSubmit = computed(() =>
  form.value.items.length > 0 &&
  form.value.items.every(i => i.quantity > 0),
)

function addItem(result: ProductSearchResult) {
  if (addedProductIds.value.includes(result.productId)) return
  form.value.items.unshift({
    productId: result.productId,
    sku:       result.sku,
    name:      result.name,
    quantity:  1,
    unitPrice: null,
  })
}

function removeItem(idx: number) {
  form.value.items.splice(idx, 1)
}

function clampQty(idx: number) {
  const item = form.value.items[idx]
  if (!item) return
  if (item.quantity < 1) item.quantity = 1
}

function resetForm() {
  form.value = defaultForm()
  error.value = null
  insufficientItems.value = []
  submitting.value = false
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submit() {
  if (!props.sale || !canSubmit.value) return
  error.value = null
  insufficientItems.value = []
  submitting.value = true
  try {
    await updateSale(props.sale.id, {
      customerName:    form.value.customerName.trim()    || undefined,
      customerEmail:   form.value.customerEmail.trim()   || undefined,
      customerPhone:   form.value.customerPhone.trim()   || undefined,
      customerAddress: form.value.customerAddress.trim() || undefined,
      currency:        form.value.currency.trim()        || 'ILS',
      notes:           form.value.notes.trim()           || undefined,
      targetId:        form.value.targetId,
      invoiceStatusId: form.value.invoiceStatusId,
      paymentMethodId: form.value.paymentMethodId,
      items: form.value.items.map(i => ({
        productId: i.productId ?? undefined,
        sku:       i.sku,
        name:      i.name,
        quantity:  i.quantity,
        unitPrice: i.unitPrice ?? undefined,
        lineTotal: i.unitPrice != null ? i.unitPrice * i.quantity : undefined,
      })),
    })
    visible.value = false
    emit('updated')
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
.edit-sale-form {
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

.field-sm   { flex: 0 0 100px; }
.field-full { flex: 1 1 100%; min-width: 100%; }

label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.meta-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 8px;
  background: var(--p-surface-100, #f1f5f9);
  color: var(--p-text-color);
  font-size: 13px;
  font-weight: 600;
  width: fit-content;
}

.meta-badge-wh { background: var(--p-primary-50, #eff6ff); color: var(--p-primary-700, #1d4ed8); }

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

.items-count { font-size: 12px; color: var(--p-text-muted-color); }

.items-list { display: flex; flex-direction: column; }

.items-list-head {
  display: grid;
  grid-template-columns: 1fr 130px 110px 80px 36px;
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
  grid-template-columns: 1fr 130px 110px 80px 36px;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.item-row:last-child { border-bottom: none; }

.item-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }

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
  color: var(--p-text-color);
  cursor: pointer;
  font-size: 14px;
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
}

.footer-summary { font-size: 13px; color: var(--p-text-muted-color); font-weight: 500; }
.footer-actions { display: flex; gap: 8px; }
.stock-error-list { margin: 4px 0 0; padding-left: 18px; }

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .edit-sale-form { gap: 12px; padding-bottom: 4px; }

  .form-row { flex-direction: column; gap: 8px; }
  .field-sm { flex: 1 1 auto; }
  .field-full { min-width: 0; }

  .items-header { padding: 8px 12px; }
  .items-list-head { display: none; }

  .item-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    align-items: stretch;
  }

  .item-row .col-product  { order: 1; }
  .item-row .col-qty-wrap { order: 2; display: flex; align-items: center; gap: 8px; }
  .item-row .col-price    { order: 3; }
  .item-row .col-total    { order: 4; text-align: left; }
  .item-row .col-remove   { order: 5; justify-self: start; }

  .item-name { white-space: normal; word-break: break-word; font-size: 12px; }
  .item-sku  { font-size: 11px; }

  .qty-stepper { height: 28px; }
  .qty-btn     { width: 24px; }
  .qty-input   { width: 34px; font-size: 12px; }

  .grand-total-row { padding: 8px 12px; flex-wrap: wrap; }

  .footer-row { flex-direction: column; align-items: stretch; gap: 12px; }
  .footer-actions { flex-direction: column-reverse; gap: 8px; }
  .footer-actions .p-button { width: 100%; justify-content: center; }
}
</style>
