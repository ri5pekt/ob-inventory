<template>
  <div class="warehouses-view">
    <!-- Page header -->
    <div class="view-header">
      <h2 class="view-title">Warehouses</h2>
      <Button label="Add Warehouse" icon="pi pi-plus" size="small" @click="showDialog = true" />
    </div>

    <!-- Loading -->
    <div v-if="isLoading" class="grid-3">
      <Skeleton v-for="n in 3" :key="n" height="120px" border-radius="12px" />
    </div>

    <!-- Empty state -->
    <div v-else-if="warehouses?.length === 0" class="empty-state">
      <i class="pi pi-building empty-icon"></i>
      <p class="empty-title">No warehouses yet</p>
      <p class="empty-sub">Add your first warehouse to start tracking inventory.</p>
      <Button label="Add Warehouse" icon="pi pi-plus" @click="showDialog = true" />
    </div>

    <!-- Warehouse cards -->
    <div v-else class="grid-3">
      <div
        v-for="wh in warehouses"
        :key="wh.id"
        class="wh-card"
        :class="{ selected: selectedId === wh.id }"
        @click="selectWarehouse(wh.id)"
      >
        <div class="wh-card-top">
          <div class="wh-icon" :class="`wh-type-${wh.type}`">
            <i class="pi pi-building"></i>
          </div>
          <Tag :value="wh.type" :severity="typeSeverity(wh.type)" class="type-tag" />
        </div>
        <div class="wh-name">{{ wh.name }}</div>
        <div class="wh-meta">
          <span class="stock-count"><b>{{ wh.stockCount ?? 0 }}</b> SKUs</span>
          <span v-if="!wh.isActive" class="inactive-badge">Inactive</span>
        </div>
      </div>
    </div>

    <!-- Stock table for selected warehouse -->
    <template v-if="selectedId">
      <div class="stock-section">
        <div class="stock-header">
          <h3 class="stock-title">
            <i class="pi pi-list-check mr-2"></i>
            {{ selectedWarehouse?.name }} — Stock
          </h3>
          <span class="stock-count-badge">{{ stockItems?.length ?? 0 }} items</span>
        </div>

        <DataTable
          :value="stockItems"
          :loading="stockLoading"
          striped-rows
          size="small"
          paginator
          paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
          :rows="50"
          :rows-per-page-options="[25, 50, 100]"
          filter-display="row"
          v-model:filters="filters"
          :global-filter-fields="['sku', 'name', 'binLocation']"
          class="stock-table"
        >
          <template #header>
            <div class="table-toolbar">
              <InputText v-model="filters['global'].value" placeholder="Search SKU, name, bin…" size="small" />
            </div>
          </template>

          <template #empty>
            <div class="table-empty">
              <i class="pi pi-inbox"></i>
              <span>No stock in this warehouse</span>
            </div>
          </template>

          <Column field="sku" header="SKU" sortable style="width: 160px; font-family: monospace; font-size: 13px" />
          <Column field="name" header="Name" sortable />
          <Column field="binLocation" header="Bin" style="width: 100px">
            <template #body="{ data }">
              <span v-if="data.binLocation" class="bin-badge">{{ data.binLocation }}</span>
              <span v-else class="text-muted">—</span>
            </template>
          </Column>
          <Column field="quantity" header="Qty" sortable style="width: 80px; text-align: right">
            <template #body="{ data }">
              <span class="qty-badge" :class="{ 'qty-low': data.quantity <= 3, 'qty-zero': data.quantity === 0 }">
                {{ data.quantity }}
              </span>
            </template>
          </Column>
        </DataTable>
      </div>
    </template>

    <!-- Add Warehouse Dialog -->
    <Dialog v-model:visible="showDialog" header="Add Warehouse" modal style="width: 420px" :draggable="false">
      <form class="dialog-form" @submit.prevent="handleCreate">
        <div class="field">
          <label>Name <span class="req">*</span></label>
          <InputText v-model="form.name" placeholder="e.g. Main Warehouse" fluid />
        </div>
        <div class="field">
          <label>Type <span class="req">*</span></label>
          <Select
            v-model="form.type"
            :options="warehouseTypeOptions"
            option-label="label"
            option-value="value"
            fluid
          />
        </div>
        <div class="field">
          <label>Notes</label>
          <Textarea v-model="form.notes" rows="2" fluid auto-resize />
        </div>
        <div class="dialog-footer">
          <Button label="Cancel" severity="secondary" text @click="showDialog = false" />
          <Button type="submit" label="Create" :loading="creating" />
        </div>
      </form>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import InputText from 'primevue/inputtext'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { getWarehouses, getWarehouseStock, createWarehouse } from '@/api/warehouses'
import type { WarehouseType } from '@ob-inventory/types'

const toast = useToast()
const queryClient = useQueryClient()

// Warehouses list
const { data: warehouses, isLoading } = useQuery({
  queryKey: ['warehouses'],
  queryFn: getWarehouses,
})

// Selection
const selectedId = ref<string | null>(null)
const selectedWarehouse = computed(() => warehouses.value?.find(w => w.id === selectedId.value))

function selectWarehouse(id: string) {
  selectedId.value = selectedId.value === id ? null : id
}

// Stock for selected warehouse
const { data: stockItems, isLoading: stockLoading } = useQuery({
  queryKey: computed(() => ['warehouse-stock', selectedId.value]),
  queryFn: () => getWarehouseStock(selectedId.value!),
  enabled: computed(() => !!selectedId.value),
})

// Table filters
const filters = ref({ global: { value: null as string | null, matchMode: 'contains' } })

// Add warehouse dialog
const showDialog = ref(false)
const form = ref({ name: '', type: 'main' as WarehouseType, notes: '' })

const warehouseTypeOptions = [
  { label: 'Main', value: 'main' },
  { label: 'Partner', value: 'partner' },
  { label: 'Other', value: 'other' },
]

const { mutate: doCreate, isPending: creating } = useMutation({
  mutationFn: () => createWarehouse({ name: form.value.name, type: form.value.type, notes: form.value.notes || undefined }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['warehouses'] })
    toast.add({ severity: 'success', summary: 'Warehouse created', life: 3000 })
    showDialog.value = false
    form.value = { name: '', type: 'main', notes: '' }
  },
  onError: () => {
    toast.add({ severity: 'error', summary: 'Failed to create warehouse', life: 4000 })
  },
})

function handleCreate() {
  if (!form.value.name.trim()) return
  doCreate()
}

function typeSeverity(type: string) {
  if (type === 'main') return 'info'
  if (type === 'partner') return 'success'
  return 'secondary'
}
</script>

<style scoped>
.warehouses-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-title {
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}

/* Cards grid */
.grid-3 {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.wh-card {
  background: #fff;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  padding: 18px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.wh-card:hover {
  border-color: #bae6fd;
  box-shadow: 0 4px 12px rgba(8,145,178,0.08);
}

.wh-card.selected {
  border-color: #0891b2;
  box-shadow: 0 4px 16px rgba(8,145,178,0.15);
}

.wh-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.wh-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.wh-type-main    { background: #e0f2fe; color: #0369a1; }
.wh-type-partner { background: #dcfce7; color: #15803d; }
.wh-type-other   { background: #f1f5f9; color: #475569; }

.wh-name {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  margin-bottom: 8px;
}

.wh-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stock-count {
  font-size: 13px;
  color: #64748b;
}

.inactive-badge {
  font-size: 11px;
  background: #fef9c3;
  color: #854d0e;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
}

.type-tag {
  font-size: 11px;
  text-transform: capitalize;
}

/* Empty state */
.empty-state {
  background: #fff;
  border: 2px dashed #e2e8f0;
  border-radius: 12px;
  padding: 60px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  color: #cbd5e1;
  display: block;
  margin-bottom: 12px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #334155;
  margin: 0 0 6px;
}

.empty-sub {
  font-size: 14px;
  color: #94a3b8;
  margin: 0 0 20px;
}

/* Stock section */
.stock-section {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
}

.stock-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #f1f5f9;
}

.stock-title {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.stock-count-badge {
  font-size: 13px;
  background: #f0f9ff;
  color: #0369a1;
  padding: 3px 10px;
  border-radius: 20px;
  font-weight: 500;
}

.stock-table {
  border: none;
}

.table-toolbar {
  display: flex;
  justify-content: flex-end;
  padding: 4px 0;
}

.table-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 14px;
  padding: 24px;
  justify-content: center;
}

.bin-badge {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-family: monospace;
}

.qty-badge {
  font-weight: 600;
  font-size: 14px;
  color: #0f172a;
}

.qty-low   { color: #d97706; }
.qty-zero  { color: #dc2626; }

.text-muted { color: #94a3b8; }
.mr-2 { margin-right: 8px; }

/* Dialog form */
.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.req { color: #dc2626; }

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
</style>
