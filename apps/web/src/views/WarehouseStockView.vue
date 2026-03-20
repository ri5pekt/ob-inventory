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
      <button
        class="filter-toggle-btn"
        :class="{ 'filter-toggle-active': activeFilterCount > 0 }"
        @click="filtersOpen = !filtersOpen"
        title="Toggle filters"
      >
        <i class="pi pi-filter"></i>
        <span class="filter-toggle-label">Filters<span v-if="activeFilterCount > 0" class="filter-badge">{{ activeFilterCount }}</span></span>
        <i :class="filtersOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" class="filter-chevron"></i>
      </button>
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

    <!-- Filter panel -->
    <div v-if="filtersOpen" class="filter-panel">
      <div class="filter-dropdowns">
        <div class="filter-field">
          <label class="filter-label">Brand</label>
          <MultiSelect
            v-model="filterBrands"
            :options="brandOptions"
            placeholder="All brands"
            display="chip"
            filter
            :max-selected-labels="2"
            class="filter-multiselect"
          />
        </div>
        <div class="filter-field">
          <label class="filter-label">Category</label>
          <MultiSelect
            v-model="filterCategories"
            :options="categoryOptions"
            placeholder="All categories"
            display="chip"
            filter
            :max-selected-labels="2"
            class="filter-multiselect"
          />
        </div>
        <div class="filter-field">
          <label class="filter-label">Model</label>
          <MultiSelect
            v-model="filterModels"
            :options="modelOptions"
            placeholder="All models"
            display="chip"
            filter
            :max-selected-labels="2"
            class="filter-multiselect"
          />
        </div>
        <div class="filter-field">
          <label class="filter-label">Size</label>
          <MultiSelect
            v-model="filterSizes"
            :options="sizeOptions"
            placeholder="All sizes"
            display="chip"
            filter
            :max-selected-labels="3"
            class="filter-multiselect"
          />
        </div>
        <div class="filter-field">
          <label class="filter-label">Color</label>
          <MultiSelect
            v-model="filterColors"
            :options="colorOptions"
            placeholder="All colors"
            display="chip"
            filter
            :max-selected-labels="2"
            class="filter-multiselect"
          />
        </div>
      </div>
      <button v-if="activeFilterCount > 0" class="filter-reset-btn" @click="resetFilters">
        <i class="pi pi-times-circle"></i> Reset filters
      </button>
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
      :warehouse-type="warehouse?.type"
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
import MultiSelect from 'primevue/multiselect'
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
const editItem          = ref<StockItemDTO | null>(null)

// ── Filter panel ──────────────────────────────────────────
const filtersOpen      = ref(false)
const filterBrands     = ref<string[]>([])
const filterCategories = ref<string[]>([])
const filterModels     = ref<string[]>([])
const filterSizes      = ref<string[]>([])
const filterColors     = ref<string[]>([])

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b))
}

const brandOptions    = computed(() => uniqueSorted(stockItems.value?.map(s => s.brand)))
const categoryOptions = computed(() => uniqueSorted(stockItems.value?.map(s => s.category)))
const modelOptions    = computed(() => uniqueSorted(stockItems.value?.map(s => s.model)))
const sizeOptions     = computed(() => uniqueSorted(stockItems.value?.map(s => s.size)))
const colorOptions    = computed(() => uniqueSorted(stockItems.value?.map(s => s.color)))

const activeFilterCount = computed(() =>
  [filterBrands, filterCategories, filterModels, filterSizes, filterColors]
    .filter(f => f.value.length > 0).length
)

function resetFilters() {
  filterBrands.value     = []
  filterCategories.value = []
  filterModels.value     = []
  filterSizes.value      = []
  filterColors.value     = []
}
// ──────────────────────────────────────────────────────────

function openEdit(item: StockItemDTO) {
  editItem.value        = item
  showEditProduct.value = true
}

const filteredStock = computed(() => {
  if (!stockItems.value) return []
  let items = stockItems.value

  // text search
  const q = search.value.trim().toLowerCase()
  if (q) {
    items = items.filter(s =>
      (s.sku       ?? '').toLowerCase().includes(q) ||
      (s.wooTitle  ?? '').toLowerCase().includes(q) ||
      (s.name      ?? '').toLowerCase().includes(q) ||
      (s.brand     ?? '').toLowerCase().includes(q) ||
      (s.category  ?? '').toLowerCase().includes(q) ||
      (s.model     ?? '').toLowerCase().includes(q) ||
      (s.color     ?? '').toLowerCase().includes(q) ||
      (s.size      ?? '').toLowerCase().includes(q) ||
      (s.boxNumber ?? '').toLowerCase().includes(q),
    )
  }

  // dropdown filters (each is AND-combined, multi-select within a field is OR)
  if (filterBrands.value.length)     items = items.filter(s => filterBrands.value.includes(s.brand ?? ''))
  if (filterCategories.value.length) items = items.filter(s => filterCategories.value.includes(s.category ?? ''))
  if (filterModels.value.length)     items = items.filter(s => filterModels.value.includes(s.model ?? ''))
  if (filterSizes.value.length)      items = items.filter(s => filterSizes.value.includes(s.size ?? ''))
  if (filterColors.value.length)     items = items.filter(s => filterColors.value.includes(s.color ?? ''))

  return items
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

/* ── Filter toggle button ── */
.filter-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 7px;
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  height: 34px;
}
.filter-toggle-btn:hover {
  border-color: #0891b2;
  color: #0891b2;
  background: #f0fdff;
}
.filter-toggle-active {
  border-color: #0891b2;
  background: #e0f2fe;
  color: #0369a1;
}
.filter-toggle-label { display: flex; align-items: center; gap: 4px; }
.filter-badge {
  background: #0891b2;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 10px;
  padding: 1px 6px;
  line-height: 1.4;
}
.filter-chevron { font-size: 10px; margin-left: 1px; }

/* ── Filter panel ── */
.filter-panel {
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.filter-dropdowns {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 160px;
  min-width: 140px;
}

.filter-label {
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

:deep(.filter-multiselect) {
  width: 100%;
  font-size: 13px;
}

:deep(.filter-multiselect .p-multiselect-label) {
  font-size: 12px;
  padding: 4px 8px;
}

.filter-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid #fca5a5;
  background: #fff;
  color: #dc2626;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  align-self: flex-start;
  transition: background 0.12s, border-color 0.12s;
}
.filter-reset-btn:hover {
  background: #fef2f2;
  border-color: #dc2626;
}

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

  .filter-toggle-btn { padding: 5px 10px; font-size: 12px; }
  .filter-toggle-label span:not(.filter-badge) { display: none; }

  .filter-panel { padding: 12px; gap: 10px; }
  .filter-dropdowns { gap: 8px; }
  .filter-field { flex: 1 1 calc(50% - 4px); min-width: 0; }

  .filter-reset-btn { align-self: stretch; justify-content: center; }

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
