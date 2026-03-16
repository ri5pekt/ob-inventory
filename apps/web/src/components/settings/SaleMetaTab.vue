<template>
  <div class="static-grid">
    <!-- Sale Targets -->
    <div class="static-col">
      <div class="static-col-header">
        <span class="static-col-title"><i class="pi pi-bullseye" /> Sale Targets</span>
      </div>
      <SimpleParamTable
        :rows="targets ?? []"
        :loading="targetsLoading"
        row-label="target"
        @add="openAdd('target')"
        @edit="openEdit('target', $event)"
        @delete="confirmDelete('target', $event)"
      />
    </div>

    <div class="static-divider" />

    <!-- Invoice Statuses -->
    <div class="static-col">
      <div class="static-col-header">
        <span class="static-col-title"><i class="pi pi-file-check" /> Invoice Statuses</span>
      </div>
      <SimpleParamTable
        :rows="invoiceStatuses ?? []"
        :loading="invoiceLoading"
        row-label="invoice status"
        @add="openAdd('invoice')"
        @edit="openEdit('invoice', $event)"
        @delete="confirmDelete('invoice', $event)"
      />
    </div>

    <div class="static-divider" />

    <!-- Payment Methods -->
    <div class="static-col">
      <div class="static-col-header">
        <span class="static-col-title"><i class="pi pi-credit-card" /> Payment Methods</span>
      </div>
      <SimpleParamTable
        :rows="paymentMethods ?? []"
        :loading="paymentLoading"
        row-label="payment method"
        @add="openAdd('payment')"
        @edit="openEdit('payment', $event)"
        @delete="confirmDelete('payment', $event)"
      />
    </div>
  </div>

  <!-- Add / Edit dialog -->
  <Dialog
    v-model:visible="nameDialog"
    :header="nameDialogTitle"
    modal
    :style="{ width: '380px' }"
    :breakpoints="{ '480px': 'calc(100vw - 16px)' }"
  >
    <div class="field">
      <label>Name</label>
      <InputText v-model="nameForm" autofocus style="width: 100%" @keyup.enter="saveName" />
    </div>
    <template #footer>
      <Button label="Cancel" text @click="nameDialog = false" />
      <Button :label="nameEditId ? 'Save' : 'Add'" :loading="saving" @click="saveName" />
    </template>
  </Dialog>

  <ConfirmDialog />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import SimpleParamTable from './SimpleParamTable.vue'
import {
  getSaleTargets, createSaleTarget, updateSaleTarget, deleteSaleTarget,
  getSaleInvoiceStatuses, createSaleInvoiceStatus, updateSaleInvoiceStatus, deleteSaleInvoiceStatus,
  getSalePaymentMethods, createSalePaymentMethod, updateSalePaymentMethod, deleteSalePaymentMethod,
} from '@/api/saleMeta'

const toast   = useToast()
const confirm = useConfirm()
const qc      = useQueryClient()

const { data: targets,        isLoading: targetsLoading } = useQuery({ queryKey: ['sale-targets'],          queryFn: getSaleTargets })
const { data: invoiceStatuses, isLoading: invoiceLoading } = useQuery({ queryKey: ['sale-invoice-statuses'],  queryFn: getSaleInvoiceStatuses })
const { data: paymentMethods,  isLoading: paymentLoading } = useQuery({ queryKey: ['sale-payment-methods'],   queryFn: getSalePaymentMethods })

type MetaType = 'target' | 'invoice' | 'payment'
const nameDialog      = ref(false)
const nameDialogTitle = ref('')
const nameForm        = ref('')
const nameEditId      = ref<string | null>(null)
const nameType        = ref<MetaType>('target')
const saving          = ref(false)

function openAdd(type: MetaType) {
  nameType.value        = type
  nameEditId.value      = null
  nameForm.value        = ''
  nameDialogTitle.value = type === 'target' ? 'Add Sale Target' : type === 'invoice' ? 'Add Invoice Status' : 'Add Payment Method'
  nameDialog.value      = true
}

function openEdit(type: MetaType, row: { id: string; name: string }) {
  nameType.value        = type
  nameEditId.value      = row.id
  nameForm.value        = row.name
  nameDialogTitle.value = type === 'target' ? 'Edit Sale Target' : type === 'invoice' ? 'Edit Invoice Status' : 'Edit Payment Method'
  nameDialog.value      = true
}

async function saveName() {
  if (!nameForm.value.trim()) return
  saving.value = true
  try {
    if (nameType.value === 'target') {
      nameEditId.value
        ? await updateSaleTarget(nameEditId.value, nameForm.value.trim())
        : await createSaleTarget(nameForm.value.trim())
      qc.invalidateQueries({ queryKey: ['sale-targets'] })
    } else if (nameType.value === 'invoice') {
      nameEditId.value
        ? await updateSaleInvoiceStatus(nameEditId.value, nameForm.value.trim())
        : await createSaleInvoiceStatus(nameForm.value.trim())
      qc.invalidateQueries({ queryKey: ['sale-invoice-statuses'] })
    } else {
      nameEditId.value
        ? await updateSalePaymentMethod(nameEditId.value, nameForm.value.trim())
        : await createSalePaymentMethod(nameForm.value.trim())
      qc.invalidateQueries({ queryKey: ['sale-payment-methods'] })
    }
    nameDialog.value = false
    toast.add({ severity: 'success', summary: 'Saved', life: 2000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Error saving', life: 3000 })
  } finally {
    saving.value = false
  }
}

function confirmDelete(type: MetaType, row: { id: string; name: string }) {
  confirm.require({
    message:      `Delete "${row.name}"?`,
    header:       'Confirm Delete',
    icon:         'pi pi-exclamation-triangle',
    rejectLabel:  'Cancel',
    acceptLabel:  'Delete',
    acceptClass:  'p-button-danger',
    accept: async () => {
      try {
        if (type === 'target') {
          await deleteSaleTarget(row.id)
          qc.invalidateQueries({ queryKey: ['sale-targets'] })
        } else if (type === 'invoice') {
          await deleteSaleInvoiceStatus(row.id)
          qc.invalidateQueries({ queryKey: ['sale-invoice-statuses'] })
        } else {
          await deleteSalePaymentMethod(row.id)
          qc.invalidateQueries({ queryKey: ['sale-payment-methods'] })
        }
        toast.add({ severity: 'success', summary: 'Deleted', life: 2000 })
      } catch {
        toast.add({ severity: 'error', summary: 'Error deleting', life: 3000 })
      }
    },
  })
}
</script>

<style scoped>
.static-grid {
  display: grid;
  grid-template-columns: 1fr 1px 1fr 1px 1fr;
  gap: 0 24px;
  align-items: start;
}

.static-divider {
  background: var(--p-content-border-color, #e2e8f0);
  align-self: stretch;
  margin-top: 4px;
}

@media (max-width: 768px) {
  .static-grid { grid-template-columns: 1fr; gap: 20px 0; }
  .static-divider { width: 100%; height: 1px; min-height: 1px; margin: 0; }
}

.static-col-header { margin-bottom: 12px; }

.static-col-title {
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color, #64748b);
  display: flex;
  align-items: center;
  gap: 6px;
}

.field { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 13px; font-weight: 500; color: #374151; }
</style>
