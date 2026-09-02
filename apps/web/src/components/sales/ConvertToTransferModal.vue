<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="Convert to Stock Transfer"
    :style="{ width: '480px', maxWidth: '96vw' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    :closable="!submitting"
    @hide="resetForm"
  >
    <div v-if="sale" class="convert-body">
      <p class="intro">
        This removes the sale and creates a stock transfer of
        <strong>{{ sale.items.length }} item{{ sale.items.length !== 1 ? 's' : '' }}</strong>
        from <strong>{{ sale.warehouseName ?? 'the sale warehouse' }}</strong> to the warehouse you choose below.
      </p>

      <div class="field">
        <label>Destination Warehouse <span class="req">*</span></label>
        <Select
          v-model="toWarehouseId"
          :options="toWarehouseOptions"
          option-label="name"
          option-value="id"
          placeholder="Select destination…"
          :loading="loadingWarehouses"
          fluid
          append-to="body"
        />
      </div>

      <div class="field">
        <label>Reference <span class="opt">(optional)</span></label>
        <InputText v-model="reference" placeholder="e.g. TR-2025-01" fluid />
      </div>

      <div class="field">
        <label>Notes <span class="opt">(optional)</span></label>
        <Textarea v-model="notes" rows="2" placeholder="Why is this being converted…" fluid />
      </div>

      <Message v-if="sale.wooOrderId" severity="info" :closable="false">
        WooCommerce order <strong>#{{ sale.wooOrderId }}</strong> will be cancelled so it isn't re-imported.
      </Message>

      <Message v-if="docCount > 0" severity="warn" :closable="false">
        This sale has {{ docCount }} Cardcom document{{ docCount !== 1 ? 's' : '' }} on file. They will be unlinked
        from OB (not cancelled on Cardcom).
      </Message>

      <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" outlined :disabled="submitting" @click="visible = false" />
      <Button
        label="Convert"
        icon="pi pi-truck"
        severity="warn"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { getWarehouses } from '@/api/warehouses'
import { convertSaleToTransfer } from '@/api/sales'
import { getSaleDocuments } from '@/api/invoices'
import type { SaleDetail } from '@/api/sales'
import type { WarehouseDTO } from '@ob-inventory/types'

const props = defineProps<{
  visible: boolean
  sale:    SaleDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'converted'): void
}>()

const visible = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

const toast = useToast()

const warehouses        = ref<WarehouseDTO[]>([])
const loadingWarehouses = ref(false)
const toWarehouseId     = ref<string | null>(null)
const reference         = ref('')
const notes             = ref('')
const submitting        = ref(false)
const errorMsg          = ref<string | null>(null)
const docCount          = ref(0)

const toWarehouseOptions = computed(() =>
  warehouses.value.filter(w => w.id !== props.sale?.warehouseId),
)

const canSubmit = computed(() => !!toWarehouseId.value && !submitting.value)

watch(() => props.visible, async (open) => {
  if (!open || !props.sale) return
  errorMsg.value = null
  if (warehouses.value.length === 0) {
    loadingWarehouses.value = true
    try { warehouses.value = await getWarehouses() }
    finally { loadingWarehouses.value = false }
  }
  try {
    const docs = await getSaleDocuments(props.sale.id)
    docCount.value = docs.length
  } catch {
    docCount.value = 0
  }
})

function resetForm() {
  toWarehouseId.value = null
  reference.value = ''
  notes.value = ''
  errorMsg.value = null
  docCount.value = 0
}

async function submit() {
  if (!props.sale || !canSubmit.value) return
  submitting.value = true
  errorMsg.value = null
  try {
    const result = await convertSaleToTransfer(props.sale.id, {
      toWarehouseId: toWarehouseId.value!,
      reference:     reference.value.trim() || undefined,
      notes:         notes.value.trim()     || undefined,
    })
    visible.value = false
    emit('converted')

    if (result.wooOrderCancelled === false) {
      toast.add({
        severity: 'warn',
        summary:  'Converted with a warning',
        detail:   result.wooCancelWarning ?? 'Transfer created, but the WooCommerce order could not be cancelled — cancel it manually.',
        life:      8000,
      })
    } else {
      toast.add({ severity: 'success', summary: 'Converted', detail: 'Sale converted to a stock transfer.', life: 4000 })
    }
  } catch (err: unknown) {
    const e = err as { response?: { data?: { error?: string; unresolvedSkus?: string[] } } }
    const skus = e.response?.data?.unresolvedSkus
    errorMsg.value = skus?.length
      ? `${e.response?.data?.error ?? 'Cannot convert'}: ${skus.join(', ')}`
      : e.response?.data?.error ?? 'Failed to convert sale. Please try again.'
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.convert-body { display: flex; flex-direction: column; gap: 16px; padding-top: 4px; }

.intro { margin: 0; font-size: 13px; line-height: 1.5; color: var(--p-text-color); }

.field { display: flex; flex-direction: column; gap: 6px; }

label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.req { color: var(--p-red-500); }
.opt { font-weight: 400; text-transform: none; letter-spacing: 0; }
</style>
