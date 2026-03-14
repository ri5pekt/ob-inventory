<template>
  <div class="sales-view">
    <div class="view-header">
      <div class="header-left">
        <Button icon="pi pi-arrow-left" text rounded size="small" @click="router.push('/inventory')" />
        <i class="pi pi-shopping-cart header-icon" />
        <div>
          <h2 class="view-title">Sales</h2>
          <span class="view-subtitle">All sales across all channels</span>
        </div>
      </div>
      <div class="header-actions">
        <Button label="New Sale" icon="pi pi-plus" size="small" @click="showCreate = true" />
      </div>
    </div>

    <SalePeriodStats @date-range-change="onDateRangeChange" />

    <!-- Filter chips + search -->
    <div class="filter-bar">
      <div class="filter-chips">
        <button
          v-for="f in typeFilters"
          :key="f.value ?? 'all'"
          class="chip"
          :class="{ active: activeFilter === f.value }"
          @click="activeFilter = f.value"
        >
          <i :class="f.icon" class="chip-icon" />
          {{ f.label }}
          <span class="chip-count">{{ f.count }}</span>
        </button>
      </div>
      <div class="filter-selects-row">
        <Select
          v-model="filterTarget"
          :options="filterTargetOptions"
          option-label="name"
          option-value="id"
          placeholder="All Targets"
          show-clear
          size="small"
          class="filter-select"
          append-to="body"
        />
        <Select
          v-model="filterInvoiceStatus"
          :options="filterInvoiceOptions"
          option-label="name"
          option-value="id"
          placeholder="All Invoice Statuses"
          show-clear
          size="small"
          class="filter-select"
          append-to="body"
        />
      </div>
      <InputText
        v-model="search"
        placeholder="Search customer, SKU, order…"
        size="small"
        class="filter-search"
      />
    </div>

    <!-- Table -->
    <div class="table-card">
      <DataTable
        class="sales-datatable"
        :value="filteredSales"
        :loading="isLoading"
        striped-rows
        size="small"
        paginator
        paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
        :rows="50"
        :rows-per-page-options="[25, 50, 100]"
        scrollable
        scroll-height="flex"
        row-hover
        @row-click="openDetail($event.data)"
      >
        <Column field="createdAt" header="Date" style="width:160px; white-space:nowrap" sortable>
          <template #body="{ data }">
            <span style="white-space:nowrap">{{ formatDate(data.createdAt) }}</span>
          </template>
        </Column>

        <Column field="customerName" header="Customer" sortable>
          <template #body="{ data }">
            <div v-if="data.customerName" class="customer-cell">
              <span>{{ data.customerName }}</span>
              <span v-if="data.customerEmail" class="customer-email">{{ data.customerEmail }}</span>
            </div>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="warehouseName" header="Warehouse" style="width:180px; white-space:nowrap" sortable>
          <template #body="{ data }">
            <span style="white-space:nowrap">{{ data.warehouseName ?? '—' }}</span>
          </template>
        </Column>

        <Column field="saleType" header="Type" style="width:130px" sortable>
          <template #body="{ data }">
            <Tag :value="typeLabel(data.saleType)" :severity="typeSeverity(data.saleType)" />
          </template>
        </Column>

        <Column field="targetName" header="Target" style="width:130px; white-space:nowrap" sortable>
          <template #body="{ data }">
            <Tag v-if="data.targetName" :value="data.targetName" severity="secondary" style="white-space:nowrap" />
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="invoiceStatusName" header="Invoice" style="width:130px; white-space:nowrap" sortable>
          <template #body="{ data }">
            <Tag v-if="data.invoiceStatusName" :value="data.invoiceStatusName" severity="info" style="white-space:nowrap" />
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="wooOrderId" header="Order #" style="width:110px">
          <template #body="{ data }">
            <span v-if="data.wooOrderId" class="order-ref">#{{ data.wooOrderId }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="itemCount" header="Items" style="width:70px; text-align:right" sortable>
          <template #body="{ data }">
            <span class="item-count">{{ data.itemCount }}</span>
          </template>
        </Column>

        <Column field="totalPrice" header="Total" style="width:110px; text-align:right; white-space:nowrap" sortable>
          <template #body="{ data }">
            <span v-if="data.totalPrice" class="total-price" style="white-space:nowrap">
              {{ parseFloat(data.totalPrice).toFixed(2) }} {{ data.currency }}
            </span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="status" header="Status" style="width:110px" sortable>
          <template #body="{ data }">
            <Tag :value="data.status" :severity="statusSeverity(data.status)" />
          </template>
        </Column>

        <template #empty>
          <div class="empty-state">
            <i class="pi pi-shopping-cart empty-icon" />
            <p>No sales found</p>
            <p v-if="activeFilter" class="empty-sub">Try selecting "All" to see all sales</p>
          </div>
        </template>
      </DataTable>
    </div>

    <SaleDetailDialog
      v-model:visible="showDetail"
      :sale="selectedSale"
      @deleted="onSaleDeleted"
      @edit="onEditSale"
    />
    <CreateSaleModal v-model="showCreate" @created="onSaleCreated" />
    <EditSaleModal v-model="showEdit" :sale="editingSale" @updated="onSaleUpdated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getSales, getSale, type Sale, type SaleDetail, type SaleType } from '@/api/sales'
import { getSaleTargets, getSaleInvoiceStatuses, type SaleMetaItem } from '@/api/saleMeta'
import SalePeriodStats from '@/components/sales/SalePeriodStats.vue'
import SaleDetailDialog from '@/components/sales/SaleDetailDialog.vue'
import CreateSaleModal from '@/components/sales/CreateSaleModal.vue'
import EditSaleModal from '@/components/sales/EditSaleModal.vue'

// ── Date range (driven by SalePeriodStats) ────────────────────────────────────
const dateRange = ref<{ from: string; to: string } | null>(null)

function onDateRangeChange(range: { from: string; to: string } | null) {
  dateRange.value = range
}

// ── Data ──────────────────────────────────────────────────────────────────────
const activeFilter      = ref<SaleType | undefined>(undefined)
const filterTarget      = ref<string | null>(null)
const filterInvoiceStatus = ref<string | null>(null)
const filterTargetOptions   = ref<SaleMetaItem[]>([])
const filterInvoiceOptions  = ref<SaleMetaItem[]>([])
const search       = ref('')

onMounted(async () => {
  try {
    [filterTargetOptions.value, filterInvoiceOptions.value] = await Promise.all([
      getSaleTargets(),
      getSaleInvoiceStatuses(),
    ])
  } catch { /* non-critical */ }
})
const showCreate   = ref(false)
const showDetail   = ref(false)
const showEdit     = ref(false)
const selectedSale = ref<SaleDetail | null>(null)
const editingSale  = ref<SaleDetail | null>(null)
const refreshKey   = ref(0)

const { data: salesData, isLoading } = useQuery({
  queryKey: computed(() => ['sales', dateRange.value?.from, dateRange.value?.to, refreshKey.value]),
  queryFn:  () => getSales({ dateFrom: dateRange.value?.from, dateTo: dateRange.value?.to, limit: 1000 }),
})

function onSaleCreated() {
  if (dateRange.value) {
    const to = new Date(Date.now() + 60_000)
    dateRange.value = { from: dateRange.value.from, to: to.toISOString() }
  }
  refreshKey.value++
}

function onSaleDeleted() {
  selectedSale.value = null
  refreshKey.value++
}

function onEditSale(sale: SaleDetail) {
  editingSale.value = sale
  showEdit.value    = true
}

async function onSaleUpdated() {
  showEdit.value    = false
  showDetail.value  = false
  selectedSale.value = null
  refreshKey.value++
}

const sales = computed(() => salesData.value ?? [])

const router = useRouter()
const typeFilters = computed(() => [
  { value: undefined,                  label: 'All',         icon: 'pi pi-list',      count: sales.value.length },
  { value: 'woocommerce' as SaleType,  label: 'WooCommerce', icon: 'pi pi-globe',     count: sales.value.filter(s => s.saleType === 'woocommerce').length },
  { value: 'direct' as SaleType,       label: 'Direct',      icon: 'pi pi-user',      count: sales.value.filter(s => s.saleType === 'direct').length },
  { value: 'partner' as SaleType,      label: 'Partner',     icon: 'pi pi-building',  count: sales.value.filter(s => s.saleType === 'partner').length },
])

const filteredSales = computed(() => {
  let list = sales.value
  if (activeFilter.value)       list = list.filter(s => s.saleType === activeFilter.value)
  if (filterTarget.value)       list = list.filter(s => s.targetId === filterTarget.value)
  if (filterInvoiceStatus.value) list = list.filter(s => s.invoiceStatusId === filterInvoiceStatus.value)
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(s =>
      s.customerName?.toLowerCase().includes(q) ||
      s.customerEmail?.toLowerCase().includes(q) ||
      s.wooOrderId?.toLowerCase().includes(q) ||
      s.warehouseName?.toLowerCase().includes(q),
    )
  }
  return list
})

async function openDetail(sale: Sale) {
  selectedSale.value = null
  showDetail.value   = true
  selectedSale.value = await getSale(sale.id)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function typeLabel(type: SaleType) {
  return type === 'woocommerce' ? 'WooCommerce' : type === 'partner' ? 'Partner' : 'Direct'
}

function typeSeverity(type: SaleType) {
  if (type === 'woocommerce') return 'info'
  if (type === 'partner')     return 'warn'
  return 'success'
}

function statusSeverity(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'danger'
  return 'secondary'
}
</script>

<style scoped>
.sales-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0;
  gap: 12px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }

.header-icon { font-size: 26px; color: var(--p-primary-color); }

.view-title    { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.filter-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.filter-search { flex: 1; min-width: 180px; }
.filter-select { width: 160px; flex-shrink: 0; }
.filter-selects-row { display: contents; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid var(--p-content-border-color);
  background: var(--p-surface-card);
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-muted-color);
  cursor: pointer;
  transition: all 0.15s;
}

.chip:hover { border-color: var(--p-primary-color); color: var(--p-primary-color); }
.chip.active { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }

.chip-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.08);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.chip.active .chip-count {
  background: rgba(255, 255, 255, 0.25);
}

.table-card {
  flex: 1;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.customer-cell { display: flex; flex-direction: column; }
.customer-email { font-size: 11px; color: var(--p-text-muted-color); }
.order-ref { font-family: monospace; font-size: 13px; color: var(--p-primary-color); }
.item-count { font-weight: 600; }
.total-price { font-weight: 700; font-variant-numeric: tabular-nums; }
.no-value { color: var(--p-text-muted-color); }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
  color: var(--p-text-muted-color);
}

.empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }
.empty-sub  { font-size: 13px; }

:deep(.sales-datatable .p-datatable-tbody td),
:deep(.sales-datatable .p-datatable-thead th) { padding: 6px 8px; }
:deep(.sales-datatable .p-paginator) { padding: 6px 8px; }
:deep(.sales-datatable .p-tag) { white-space: nowrap; }

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .sales-view { gap: 10px; }

  .header-left .header-icon { display: none; }

  .view-title { font-size: 18px; }
  .view-subtitle { font-size: 12px; }

  .header-actions .p-button-label { display: none; }

  .filter-bar { flex-direction: column; align-items: stretch; gap: 6px; }
  .filter-chips { width: 100%; }
  .filter-search { min-width: 0; width: 100%; }

  .chip { padding: 4px 10px; font-size: 12px; }
  .chip-icon { display: none; }

  .filter-selects-row { display: flex; gap: 6px; width: 100%; }
  .filter-selects-row .filter-select { width: 0; flex: 1; }

  .empty-state { padding: 40px 16px; }
  .empty-icon { font-size: 32px; }

  :deep(.sales-datatable .p-datatable-tbody td),
  :deep(.sales-datatable .p-datatable-thead th) {
    padding: 6px 8px;
    font-size: 12px;
  }
}
</style>
