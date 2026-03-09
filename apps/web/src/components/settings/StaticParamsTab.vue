<template>
  <div class="static-grid">
    <!-- Categories -->
    <div class="static-col">
      <div class="static-col-header">
        <span class="static-col-title"><i class="pi pi-tag" /> Categories</span>
      </div>
      <SimpleParamTable
        :rows="categories ?? []"
        :loading="catLoading"
        row-label="category"
        @add="openAdd('category')"
        @edit="openEdit('category', $event)"
        @delete="confirmDelete('category', $event)"
      />
    </div>

    <div class="static-divider" />

    <!-- Brands -->
    <div class="static-col">
      <div class="static-col-header">
        <span class="static-col-title"><i class="pi pi-star" /> Brands</span>
      </div>
      <SimpleParamTable
        :rows="brands ?? []"
        :loading="brandLoading"
        row-label="brand"
        @add="openAdd('brand')"
        @edit="openEdit('brand', $event)"
        @delete="confirmDelete('brand', $event)"
      />
    </div>
  </div>

  <!-- Add / Edit dialog -->
  <Dialog v-model:visible="nameDialog" :header="nameDialogTitle" modal :style="{ width: '380px' }" :breakpoints="{ '480px': 'calc(100vw - 16px)' }">
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
import { catalogApi } from '@/api/catalog'

const toast   = useToast()
const confirm = useConfirm()
const qc      = useQueryClient()

const { data: categories, isLoading: catLoading }   = useQuery({ queryKey: ['categories'], queryFn: catalogApi.getCategories })
const { data: brands,     isLoading: brandLoading }  = useQuery({ queryKey: ['brands'],     queryFn: catalogApi.getBrands })

type SimpleType = 'category' | 'brand'
const nameDialog      = ref(false)
const nameDialogTitle = ref('')
const nameForm        = ref('')
const nameEditId      = ref<string | null>(null)
const nameType        = ref<SimpleType>('category')
const saving          = ref(false)

function openAdd(type: SimpleType) {
  nameType.value      = type
  nameEditId.value    = null
  nameForm.value      = ''
  nameDialogTitle.value = `Add ${type === 'category' ? 'Category' : 'Brand'}`
  nameDialog.value    = true
}

function openEdit(type: SimpleType, row: { id: string; name: string }) {
  nameType.value      = type
  nameEditId.value    = row.id
  nameForm.value      = row.name
  nameDialogTitle.value = `Edit ${type === 'category' ? 'Category' : 'Brand'}`
  nameDialog.value    = true
}

async function saveName() {
  if (!nameForm.value.trim()) return
  saving.value = true
  try {
    if (nameType.value === 'category') {
      nameEditId.value
        ? await catalogApi.updateCategory(nameEditId.value, nameForm.value.trim())
        : await catalogApi.createCategory(nameForm.value.trim())
      qc.invalidateQueries({ queryKey: ['categories'] })
    } else {
      nameEditId.value
        ? await catalogApi.updateBrand(nameEditId.value, nameForm.value.trim())
        : await catalogApi.createBrand(nameForm.value.trim())
      qc.invalidateQueries({ queryKey: ['brands'] })
    }
    nameDialog.value = false
    toast.add({ severity: 'success', summary: 'Saved', life: 2000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Error saving', life: 3000 })
  } finally {
    saving.value = false
  }
}

function confirmDelete(type: SimpleType, row: { id: string; name: string }) {
  confirm.require({
    message:      `Delete ${type} "${row.name}"?`,
    header:       'Confirm Delete',
    icon:         'pi pi-exclamation-triangle',
    rejectLabel:  'Cancel',
    acceptLabel:  'Delete',
    acceptClass:  'p-button-danger',
    accept: async () => {
      if (type === 'category') {
        await catalogApi.deleteCategory(row.id)
        qc.invalidateQueries({ queryKey: ['categories'] })
      } else {
        await catalogApi.deleteBrand(row.id)
        qc.invalidateQueries({ queryKey: ['brands'] })
      }
      toast.add({ severity: 'success', summary: 'Deleted', life: 2000 })
    },
  })
}
</script>

<style scoped>
.static-grid {
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
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
