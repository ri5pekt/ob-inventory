<template>
  <div class="stock-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-left">
        <Button icon="pi pi-arrow-left" text rounded size="small" @click="router.push('/inventory')" />
        <div>
          <!-- Skeleton while warehouse meta loads -->
          <template v-if="!warehouse">
            <Skeleton width="160px" height="22px" border-radius="6px" class="title-skeleton" />
            <Skeleton width="52px" height="16px" border-radius="4px" style="margin-top:4px" />
          </template>
          <template v-else>
            <div class="title-row">
              <h2 class="view-title">{{ warehouse.name }}</h2>
              <button class="edit-wh-btn" title="Edit warehouse" @click="showEditWarehouse = true">
                <i class="pi pi-pencil"></i>
              </button>
            </div>
            <span class="wh-type-badge" :class="`type-${warehouse.type}`">{{ warehouse.type }}</span>
          </template>
        </div>
      </div>
      <div class="header-right-actions">
        <Button
          label="Add Product"
          icon="pi pi-plus"
          size="small"
          @click="showAddProduct = true"
        />
      </div>
    </div>

    <!-- Search + count bar -->
    <div class="toolbar">
      <InputText
        v-model="search"
        placeholder="Search SKU, name, brand, color…"
        size="small"
        class="search-input"
        :disabled="isLoading"
      />
      <span v-if="isLoading" class="loading-pill">
        <i class="pi pi-spin pi-spinner"></i> Loading…
      </span>
      <span v-else-if="isFetching" class="refresh-pill">
        <i class="pi pi-spin pi-spinner"></i> Refreshing
      </span>
      <span v-else class="stock-count-label">
        {{ filteredStock.length }}<span class="count-of"> of {{ stockItems?.length ?? 0 }}</span> SKUs
      </span>
    </div>

    <!-- ── TABLE (all screen sizes) ── -->
    <div class="table-card">

      <!-- Skeleton rows while loading -->
      <div v-if="isLoading" class="skeleton-table">
        <div class="skeleton-thead">
          <Skeleton v-for="col in 6" :key="col" height="13px" border-radius="4px" />
        </div>
        <div v-for="row in 10" :key="row" class="skeleton-row" :style="{ opacity: 1 - row * 0.07 }">
          <Skeleton width="52px"  height="14px" border-radius="4px" />
          <Skeleton width="110px" height="14px" border-radius="4px" />
          <Skeleton :width="`${120 + (row % 3) * 30}px`" height="14px" border-radius="4px" />
          <Skeleton width="64px"  height="18px" border-radius="4px" />
          <Skeleton width="90px"  height="14px" border-radius="4px" />
          <Skeleton width="32px"  height="16px" border-radius="4px" style="margin-left:auto" />
        </div>
      </div>

      <StockTable v-else :items="filteredStock" @edit="openEdit" />
    </div>

    <AddProductModal
      :visible="showAddProduct"
      :warehouse-id="warehouseId"
      @close="showAddProduct = false"
    />

    <EditProductModal
      :visible="showEditProduct"
      :warehouse-id="warehouseId"
      :item="editItem"
      @close="showEditProduct = false"
    />

    <EditWarehouseModal
      v-model:visible="showEditWarehouse"
      :warehouse="warehouse"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Skeleton from 'primevue/skeleton'
import { getWarehouses, getWarehouseStock } from '@/api/warehouses'
import StockTable        from '@/components/warehouse/StockTable.vue'
import AddProductModal   from '@/components/warehouse/AddProductModal.vue'
import EditProductModal  from '@/components/warehouse/EditProductModal.vue'
import EditWarehouseModal from '@/components/warehouse/EditWarehouseModal.vue'
import type { StockItemDTO } from '@ob-inventory/types'

const route       = useRoute()
const router      = useRouter()
const warehouseId = computed(() => route.params.id as string)

const { data: allWarehouses } = useQuery({ queryKey: ['warehouses'], queryFn: getWarehouses })
const warehouse = computed(() => allWarehouses.value?.find(w => w.id === warehouseId.value))

const { data: stockItems, isLoading, isFetching } = useQuery({
  queryKey: computed(() => ['warehouse-stock', warehouseId.value]),
  queryFn:  () => getWarehouseStock(warehouseId.value),
})

const search            = ref('')
const showAddProduct    = ref(false)
const showEditProduct   = ref(false)
const showEditWarehouse = ref(false)
const editItem        = ref<StockItemDTO | null>(null)

function openEdit(item: StockItemDTO) {
  editItem.value       = item
  showEditProduct.value = true
}


const filteredStock = computed(() => {
  if (!stockItems.value) return []
  const q = search.value.trim().toLowerCase()
  if (!q) return stockItems.value
  return stockItems.value.filter(s =>
    (s.sku      ?? '').toLowerCase().includes(q) ||
    (s.name     ?? '').toLowerCase().includes(q) ||
    (s.brand    ?? '').toLowerCase().includes(q) ||
    (s.category ?? '').toLowerCase().includes(q) ||
    (s.model    ?? '').toLowerCase().includes(q) ||
    (s.color    ?? '').toLowerCase().includes(q) ||
    (s.size     ?? '').toLowerCase().includes(q) ||
    (s.boxNumber ?? '').toLowerCase().includes(q),
  )
})
</script>

<style scoped>
.stock-view {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* ── Header ── */
.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.view-title {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.edit-wh-btn {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: none;
  background: none;
  color: #94a3b8;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  margin-bottom: 2px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.edit-wh-btn:hover { background: #f1f5f9; color: #0891b2; }

.wh-type-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 4px;
}

.type-main    { background: #e0f2fe; color: #0369a1; }
.type-partner { background: #dcfce7; color: #15803d; }
.type-other   { background: #f1f5f9; color: #475569; }

/* ── Toolbar ── */
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.search-input { flex: 1; min-width: 0; }

.stock-count-label {
  font-size: 13px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  flex-shrink: 0;
}

.count-of { font-weight: 400; color: #94a3b8; }

/* Loading / refresh pill */
.loading-pill,
.refresh-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  padding: 3px 9px;
  border-radius: 20px;
}
.loading-pill {
  color: #0ea5e9;
  background: #e0f2fe;
}
.refresh-pill {
  color: #64748b;
  background: #f1f5f9;
}

/* ── Skeleton table ── */
.skeleton-table {
  padding: 0 12px 12px;
}
.skeleton-thead {
  display: flex;
  gap: 16px;
  padding: 14px 0 10px;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 4px;
}
.skeleton-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid #f1f5f9;
}

/* Header title skeleton */
.title-skeleton { display: block; }

/* Skeleton card (mobile) */
.skeleton-card {
  pointer-events: none;
}

/* ── Desktop table ── */
.table-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #fff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
}


/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .stock-view { gap: 10px; }
  .view-title { font-size: 16px; }
  .header-right-actions .p-button-label { display: none; }
  .toolbar { gap: 8px; }
  .stock-count-label { font-size: 12px; }

  /* Tighter text inside cells on small screens */
  :deep(.p-datatable-tbody td),
  :deep(.p-datatable-thead th) {
    padding: 6px 8px;
    font-size: 12px;
  }
}

@media (max-width: 480px) {
  .stock-view { gap: 8px; }
  .view-title { font-size: 15px; }
}
</style>
