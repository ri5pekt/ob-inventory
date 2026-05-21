<template>
  <Dialog
    :visible="visible"
    modal
    header="Pay with Terminal"
    :style="{ width: '520px', maxWidth: '96vw' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)' }"
    :closable="!charging"
    @update:visible="$emit('update:visible', $event)"
  >
    <!-- SUCCESS STATE -->
    <div v-if="result" class="terminal-success">
      <div class="success-icon"><i class="pi pi-check-circle" /></div>
      <p class="success-title">Payment successful!</p>
      <div class="success-details">
        <div class="detail-row">
          <span class="detail-label">Card</span>
          <span>{{ result.cardBrand }} ****{{ result.last4Digits }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Document</span>
          <span>Tax Invoice &amp; Receipt #{{ result.documentNumber }}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Amount</span>
          <span>{{ formatAmount(totalAmount) }} ₪</span>
        </div>
      </div>
      <a v-if="result.docUrl" :href="result.docUrl" target="_blank" rel="noopener" class="pdf-link">
        <i class="pi pi-file-pdf" /> Download Invoice PDF
      </a>
    </div>

    <!-- CHARGE FORM -->
    <form v-else class="terminal-form" @submit.prevent="submit">
      <!-- Customer & amount info (read-only summary) -->
      <div class="info-section">
        <div class="info-row">
          <span class="info-label">Customer</span>
          <span class="info-value">{{ form.customerName || '—' }}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Amount to charge</span>
          <span class="info-value amount">{{ formatAmount(totalAmount) }} ₪</span>
        </div>
      </div>

      <Divider />

      <!-- Card details -->
      <div class="form-section">
        <p class="section-title">Credit card details</p>

        <div class="field">
          <label for="cardNumber">Card number</label>
          <InputText
            id="cardNumber"
            v-model="form.cardNumber"
            placeholder="4580 0000 0000 0000"
            maxlength="19"
            inputmode="numeric"
            :disabled="charging"
            @input="formatCardNumber"
          />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="cardExpiry">Expiry (MM/YY)</label>
            <InputText
              id="cardExpiry"
              v-model="form.cardExpiryDisplay"
              placeholder="MM/YY"
              maxlength="5"
              inputmode="numeric"
              :disabled="charging"
              @input="formatExpiry"
            />
          </div>
          <div class="field">
            <label for="cvv">CVV</label>
            <InputText
              id="cvv"
              v-model="form.cvv"
              placeholder="123"
              maxlength="4"
              inputmode="numeric"
              :disabled="charging"
            />
          </div>
          <div class="field">
            <label for="payments">Installments</label>
            <Select
              id="payments"
              v-model="form.numOfPayments"
              :options="paymentOptions"
              option-label="label"
              option-value="value"
              :disabled="charging"
            />
          </div>
        </div>
      </div>

      <Message v-if="error" severity="error" :closable="false" class="error-msg">{{ error }}</Message>
    </form>

    <template #footer>
      <div v-if="result" class="footer-done">
        <Button label="Close" @click="close" />
      </div>
      <div v-else class="footer-actions">
        <Button label="Cancel" severity="secondary" outlined :disabled="charging" @click="close" />
        <Button
          label="Charge card"
          icon="pi pi-credit-card"
          :loading="charging"
          :disabled="!isFormValid"
          @click="submit"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import Dialog    from 'primevue/dialog'
import Button    from 'primevue/button'
import InputText from 'primevue/inputtext'
import Select    from 'primevue/select'
import Divider   from 'primevue/divider'
import Message   from 'primevue/message'
import { chargeCardForSale, type ChargeCardResult } from '@/api/invoices'
import type { SaleDetail } from '@/api/sales'

const props = defineProps<{
  visible: boolean
  sale:    SaleDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'charged', result: ChargeCardResult): void
}>()

// ── State ───────────────────────────────────────────────────────────────────

const charging = ref(false)
const error    = ref<string | null>(null)
const result   = ref<ChargeCardResult | null>(null)

const form = ref({
  customerName:      '',
  customerEmail:     '' as string | null,
  cardNumber:        '',
  cardExpiryDisplay: '',  // formatted MM/YY for display
  cvv:               '',
  numOfPayments:     1,
})

const paymentOptions = Array.from({ length: 12 }, (_, i) => ({
  label: i === 0 ? '1 payment' : `${i + 1} payments`,
  value: i + 1,
}))

// ── Computed ─────────────────────────────────────────────────────────────────

const saleItems = computed(() =>
  (props.sale?.items ?? []).map(i => ({
    name:      i.name,
    quantity:  i.quantity,
    unitPrice: parseFloat(i.unitPrice ?? '0'),
  }))
)

const totalAmount = computed(() =>
  saleItems.value.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)
)

// MMYY for API — strip the slash from MM/YY display value
const cardExpiryMMYY = computed(() => form.value.cardExpiryDisplay.replace('/', ''))

const rawCardNumber = computed(() => form.value.cardNumber.replace(/\s/g, ''))

const isFormValid = computed(() =>
  rawCardNumber.value.length >= 13 &&
  cardExpiryMMYY.value.length === 4 &&
  form.value.cvv.length >= 3 &&
  totalAmount.value > 0
)

// ── Watchers ─────────────────────────────────────────────────────────────────

watch(() => props.visible, (open) => {
  if (open) reset()
})

// ── Methods ───────────────────────────────────────────────────────────────────

function reset() {
  error.value    = null
  result.value   = null
  charging.value = false
  form.value = {
    customerName:      props.sale?.customerName  ?? '',
    customerEmail:     props.sale?.customerEmail ?? null,
    cardNumber:        '',
    cardExpiryDisplay: '',
    cvv:               '',
    numOfPayments:     1,
  }
}

function formatCardNumber(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 16)
  form.value.cardNumber = raw.replace(/(.{4})/g, '$1 ').trim()
}

function formatExpiry(e: Event) {
  const raw = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4)
  form.value.cardExpiryDisplay = raw.length > 2 ? `${raw.slice(0, 2)}/${raw.slice(2)}` : raw
}

function formatAmount(n: number) {
  return n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function submit() {
  if (!props.sale || !isFormValid.value) return
  error.value    = null
  charging.value = true

  try {
    const res = await chargeCardForSale(props.sale.id, {
      cardNumber:    rawCardNumber.value,
      cardExpiry:    cardExpiryMMYY.value,
      cvv:           form.value.cvv,
      numOfPayments: form.value.numOfPayments,
      customerName:  form.value.customerName || undefined,
      customerEmail: form.value.customerEmail,
      items:         saleItems.value,
    })
    result.value = res
    emit('charged', res)
  } catch (err: unknown) {
    // Try to read the error message from the API response body first
    const responseMsg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    error.value = responseMsg ?? (err instanceof Error ? err.message : 'Card charge failed')
  } finally {
    charging.value = false
  }
}

function close() {
  emit('update:visible', false)
}
</script>

<style scoped>
.terminal-form { display: flex; flex-direction: column; gap: 1rem; }

.info-section {
  background: var(--p-surface-50, #f8f9fa);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}
.info-row { display: flex; justify-content: space-between; align-items: center; }
.info-label { color: var(--p-text-muted-color, #6c757d); font-size: 0.875rem; }
.info-value { font-weight: 500; }
.info-value.amount { font-size: 1.1rem; font-weight: 700; color: var(--p-primary-color); }

.form-section { display: flex; flex-direction: column; gap: 0.75rem; }
.section-title { font-weight: 600; font-size: 0.9rem; margin: 0; color: var(--p-text-muted-color, #6c757d); }

.field { display: flex; flex-direction: column; gap: 0.3rem; flex: 1; }
.field label { font-size: 0.85rem; font-weight: 500; }
.field :deep(.p-inputtext),
.field :deep(.p-select) { width: 100%; }

.field-row { display: flex; gap: 0.75rem; }

.error-msg { margin: 0; }

/* Success */
.terminal-success {
  display: flex; flex-direction: column; align-items: center;
  gap: 1rem; padding: 1rem 0;
}
.success-icon { font-size: 3rem; color: var(--p-green-500, #22c55e); }
.success-title { font-size: 1.2rem; font-weight: 700; margin: 0; }
.success-details {
  width: 100%;
  background: var(--p-surface-50, #f8f9fa);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  display: flex; flex-direction: column; gap: 0.4rem;
}
.detail-row { display: flex; justify-content: space-between; }
.detail-label { color: var(--p-text-muted-color, #6c757d); font-size: 0.875rem; }
.pdf-link {
  display: flex; align-items: center; gap: 0.4rem;
  color: var(--p-primary-color); text-decoration: none; font-weight: 500;
}
.pdf-link:hover { text-decoration: underline; }

/* Footer */
.footer-actions { display: flex; justify-content: flex-end; gap: 0.5rem; width: 100%; }
.footer-done    { display: flex; justify-content: flex-end; width: 100%; }
</style>
