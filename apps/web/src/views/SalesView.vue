<template>
  <div class="sales-view">
    <div class="view-header">
      <div class="header-left">
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

    <SalePeriodStats :sales="sales" @date-range-change="onDateRangeChange" />

    <!-- Filter chips + search -->
    <div class="filter-bar">
      <button
        v-for="f in typeFilters"
        :key="f.value ?? 'all'"
        class="chip"
        :class="{ active: activeFilter === f.value }"
        @click="activeFilter = f.value"
      >
        <i :class="f.icon" />
        {{ f.label }}
      </button>
      <div style="flex:1" />
      <InputText
        v-model="search"
        placeholder="Search customer, SKU, order…"
        size="small"
        style="width: 260px"
      />
    </div>

    <!-- Table -->
    <div class="table-card">
      <DataTable
        :value="filteredSales"
        :loading="isLoading"
        striped-rows
        size="small"
        paginator
        :rows="50"
        :rows-per-page-options="[25, 50, 100]"
        scrollable
        scroll-height="flex"
        row-hover
        @row-click="openDetail($event.data)"
      >
        <Column field="createdAt" header="Date" style="width:160px" sortable>
          <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
        </Column>

        <Column field="saleType" header="Type" style="width:130px" sortable>
          <template #body="{ data }">
            <Tag :value="typeLabel(data.saleType)" :severity="typeSeverity(data.saleType)" />
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

        <Column field="warehouseName" header="Warehouse" style="width:150px" sortable>
          <template #body="{ data }">
            <span>{{ data.warehouseName ?? '—' }}</span>
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

        <Column field="totalPrice" header="Total" style="width:110px; text-align:right" sortable>
          <template #body="{ data }">
            <span v-if="data.totalPrice" class="total-price">
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

    <SaleDetailDialog v-model:visible="showDetail" :sale="selectedSale" @deleted="onSaleDeleted" />
    <CreateSaleModal v-model="showCreate" @created="onSaleCreated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getSales, getSale, type Sale, type SaleDetail, type SaleType } from '@/api/sales'
import SalePeriodStats from '@/components/sales/SalePeriodStats.vue'
import SaleDetailDialog from '@/components/sales/SaleDetailDialog.vue'
import CreateSaleModal from '@/components/sales/CreateSaleModal.vue'

// ── Date range (driven by SalePeriodStats) ────────────────────────────────────
const dateRange = ref<{ from: string; to: string } | null>(null)

function onDateRangeChange(range: { from: string; to: string } | null) {
  dateRange.value = range
}

// ── Data ──────────────────────────────────────────────────────────────────────
const activeFilter = ref<SaleType | undefined>(undefined)
const search       = ref('')
const showCreate   = ref(false)
const showDetail   = ref(false)
const selectedSale = ref<SaleDetail | null>(null)
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

const sales = computed(() => salesData.value ?? [])

const typeFilters = [
  { value: undefined,                  label: 'All',         icon: 'pi pi-list' },
  { value: 'woocommerce' as SaleType,  label: 'WooCommerce', icon: 'pi pi-globe' },
  { value: 'direct' as SaleType,       label: 'Direct',      icon: 'pi pi-user' },
  { value: 'partner' as SaleType,      label: 'Partner',     icon: 'pi pi-building' },
]

const filteredSales = computed(() => {
  let list = sales.value
  if (activeFilter.value) list = list.filter(s => s.saleType === activeFilter.value)
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
  padding: 24px;
  gap: 16px;
}

.view-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left { display: flex; align-items: center; gap: 14px; }

.header-icon { font-size: 26px; color: var(--p-primary-color); }

.view-title    { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.filter-bar { display: flex; align-items: center; gap: 8px; }

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
</style>
