<template>
  <div class="param-table-card">
    <div class="param-toolbar">
      <InputText v-model="search" :placeholder="`Search ${rowLabel}s…`" size="small" class="param-search" />
      <Button :label="`Add ${rowLabel}`" icon="pi pi-plus" size="small" @click="$emit('add')" />
    </div>

    <DataTable
      class="param-datatable"
      :value="filtered"
      :loading="loading"
      size="small"
      striped-rows
      :rows="50"
      paginator
      paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
      :rows-per-page-options="[25, 50, 100]"
    >
      <template #empty>
        <div class="empty-state">
          <i class="pi pi-inbox"></i>
          <span>No {{ rowLabel }}s found</span>
        </div>
      </template>

      <Column field="name" header="Name" sortable />
      <Column field="createdAt" header="Created" sortable style="width: 160px">
        <template #body="{ data }">
          <span class="muted">{{ formatDate(data.createdAt) }}</span>
        </template>
      </Column>
      <Column style="width: 90px">
        <template #body="{ data }">
          <div class="row-actions">
            <Button icon="pi pi-pencil" text rounded size="small" @click="$emit('edit', data)" />
            <Button icon="pi pi-trash" text rounded size="small" severity="danger" @click="$emit('delete', data)" />
          </div>
        </template>
      </Column>
    </DataTable>
  </div>

  <ConfirmDialog />
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ConfirmDialog from 'primevue/confirmdialog'

const props = defineProps<{
  rows: { id: string; name: string; createdAt: string }[]
  loading: boolean
  rowLabel: string
}>()

defineEmits<{
  add: []
  edit: [row: { id: string; name: string; createdAt: string }]
  delete: [row: { id: string; name: string; createdAt: string }]
}>()

const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? props.rows.filter(r => r.name.toLowerCase().includes(q)) : props.rows
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<style scoped>
.param-table-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}

.param-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
}

.param-search { width: 240px; min-width: 0; }

.empty-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  padding: 32px;
  justify-content: center;
}

.row-actions { display: flex; gap: 2px; justify-content: flex-end; }
.muted { font-size: 12px; color: #94a3b8; }

@media (max-width: 768px) {
  .param-toolbar { flex-direction: column; align-items: stretch; padding: 10px 12px; gap: 8px; }
  .param-search { width: 100%; }
  :deep(.param-datatable .p-datatable-thead th),
  :deep(.param-datatable .p-datatable-tbody td) { padding: 6px 8px; font-size: 12px; }
  :deep(.param-datatable .p-paginator) { padding: 6px 8px; }
}
</style>
