<template>
  <div class="inventory-view">
    <div class="view-header">
      <h2 class="view-title">Warehouses</h2>
      <div class="header-actions">
        <Button label="Import Products" icon="pi pi-file-import" size="small" severity="secondary" @click="showImport = true" />
        <Button label="Add Warehouse" icon="pi pi-plus" size="small" @click="showDialog = true" />
      </div>
    </div>

    <!-- Loading skeletons -->
    <div v-if="isLoading" class="wh-grid">
      <Skeleton v-for="n in 3" :key="n" height="130px" border-radius="12px" />
    </div>

    <!-- Empty state -->
    <div v-else-if="!warehouses?.length" class="empty-state">
      <i class="pi pi-box empty-icon"></i>
      <p class="empty-title">No warehouses yet</p>
      <p class="empty-sub">Add your first warehouse to start tracking inventory.</p>
      <Button label="Add Warehouse" icon="pi pi-plus" @click="showDialog = true" />
    </div>

    <!-- Warehouse cards -->
    <div v-else class="wh-sections">
      <!-- Main warehouses -->
      <div v-if="mainWarehouses.length" class="wh-section">
        <div class="wh-grid">
          <div
            v-for="wh in mainWarehouses"
            :key="wh.id"
            class="wh-card"
            @click="router.push(`/inventory/${wh.id}`)"
          >
            <div class="wh-card-top" :style="{ background: wh.color ?? '#94a3b8' }">
              <img v-if="wh.logo" :src="wh.logo" class="wh-logo" alt="" />
              <div v-else class="wh-icon-fallback">
                <i :class="`pi ${wh.icon ?? 'pi-building'}`"></i>
              </div>
              <div class="wh-header-name">{{ wh.name }}</div>
              <Tag :value="wh.type" :severity="typeSeverity(wh.type)" class="wh-type-tag" />
            </div>
            <div class="wh-meta">
              <span><b>{{ wh.stockCount ?? 0 }}</b> SKUs</span>
              <span v-if="!wh.isActive" class="badge-inactive">Inactive</span>
            </div>
            <div class="wh-arrow"><i class="pi pi-arrow-right"></i></div>
          </div>
        </div>
      </div>

      <!-- Partner / other warehouses -->
      <div v-if="partnerWarehouses.length" class="wh-section">
        <div class="wh-section-label">
          <i class="pi pi-users"></i> Partners
        </div>
        <div class="wh-grid">
          <div
            v-for="wh in partnerWarehouses"
            :key="wh.id"
            class="wh-card"
            @click="router.push(`/inventory/${wh.id}`)"
          >
            <div class="wh-card-top" :style="{ background: wh.color ?? '#94a3b8' }">
              <img v-if="wh.logo" :src="wh.logo" class="wh-logo" alt="" />
              <div v-else class="wh-icon-fallback">
                <i :class="`pi ${wh.icon ?? 'pi-building'}`"></i>
              </div>
              <div class="wh-header-name">{{ wh.name }}</div>
              <Tag :value="wh.type" :severity="typeSeverity(wh.type)" class="wh-type-tag" />
            </div>
            <div class="wh-meta">
              <span><b>{{ wh.stockCount ?? 0 }}</b> SKUs</span>
              <span v-if="!wh.isActive" class="badge-inactive">Inactive</span>
            </div>
            <div class="wh-arrow"><i class="pi pi-arrow-right"></i></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Import Products Modal -->
    <ImportProductsModal v-model="showImport" @done="queryClient.invalidateQueries({ queryKey: ['warehouses'] })" />

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
            :options="typeOptions"
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
import ImportProductsModal from '@/components/warehouse/ImportProductsModal.vue'
import { useRouter } from 'vue-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/vue-query'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { getWarehouses, createWarehouse } from '@/api/warehouses'
import type { WarehouseType } from '@ob-inventory/types'

const router = useRouter()
const toast = useToast()
const queryClient = useQueryClient()

const { data: warehouses, isLoading } = useQuery({
  queryKey: ['warehouses'],
  queryFn: getWarehouses,
})

const mainWarehouses = computed(() => warehouses.value?.filter(w => w.type === 'main') ?? [])
const partnerWarehouses = computed(() => warehouses.value?.filter(w => w.type !== 'main') ?? [])

const showDialog = ref(false)
const showImport = ref(false)
const form = ref({ name: '', type: 'main' as WarehouseType, notes: '' })

const typeOptions = [
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
.inventory-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-actions {
  display: flex;
  gap: 8px;
}

.view-title {
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}

.wh-sections {
  display: flex;
  flex-direction: column;
  gap: 28px;
}

.wh-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wh-section-label {
  font-size: 12px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 6px;
}

.wh-section-label .pi {
  font-size: 12px;
}

.wh-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}

.wh-card {
  background: #fff;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  position: relative;
}

.wh-card:hover {
  border-color: #0891b2;
  box-shadow: 0 4px 16px rgba(8, 145, 178, 0.12);
  transform: translateY(-1px);
}

.wh-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: -20px -20px 14px;
  padding: 16px;
  border-radius: 10px 10px 0 0;
  transition: background 0.2s;
  min-height: 80px;
}

.wh-logo {
  width: 52px;
  height: 52px;
  object-fit: contain;
  border-radius: 10px;
  flex-shrink: 0;
  background: #fff;
  padding: 5px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}

.wh-icon-fallback {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  flex-shrink: 0;
  background: rgba(255,255,255,0.2);
  border: 1px solid rgba(255,255,255,0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  color: #fff;
}

.wh-header-name {
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  line-height: 1.35;
  text-shadow: 0 1px 3px rgba(0,0,0,0.18);
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

/* Lighten the Tag so it reads clearly on any colored background */
:deep(.wh-type-tag) {
  background: rgba(255,255,255,0.25) !important;
  color: #fff !important;
  border: 1px solid rgba(255,255,255,0.35) !important;
  font-size: 10px !important;
  flex-shrink: 0;
}


.wh-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
}

.badge-inactive {
  font-size: 11px;
  background: #fef9c3;
  color: #854d0e;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 500;
}

.wh-arrow {
  position: absolute;
  bottom: 16px;
  right: 16px;
  color: #cbd5e1;
  font-size: 13px;
  transition: color 0.15s;
}

.wh-card:hover .wh-arrow {
  color: #0891b2;
}

/* Empty state */
.empty-state {
  background: #fff;
  border: 2px dashed #e2e8f0;
  border-radius: 12px;
  padding: 64px 24px;
  text-align: center;
}

.empty-icon {
  font-size: 42px;
  color: #cbd5e1;
  display: block;
  margin-bottom: 14px;
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

/* Dialog */
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
