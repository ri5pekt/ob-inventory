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
        <button class="panels-toggle" :aria-label="panelsOpen ? 'Collapse filters' : 'Expand filters'" @click="panelsOpen = !panelsOpen">
          <i :class="panelsOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
        </button>
        <Button label="New Sale" icon="pi pi-plus" size="small" @click="showCreate = true" />
      </div>
    </div>

    <!-- Collapsible top panels (mobile: toggleable; desktop: always open) -->
    <div class="collapsible-panels" :class="{ expanded: panelsOpen }">
      <div class="collapsible-inner">
        <SalePeriodStats @date-range-change="onDateRangeChange" />

        <!-- Filter chips + merge controls + search -->
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

            <div class="merge-controls">
              <template v-if="mergeMode">
                <span class="merge-indicator">
                  {{ selectedSaleIds.length }} sale{{ selectedSaleIds.length !== 1 ? 's' : '' }} selected
                </span>
                <Button label="Cancel" severity="secondary" outlined size="small" @click="exitMergeMode" />
                <Button
                  label="Create Merged Sale"
                  icon="pi pi-share-alt"
                  size="small"
                  :disabled="selectedSaleIds.length < 2"
                  @click="openMergeModal"
                />
              </template>
              <button
                v-else
                class="chip chip-merge"
                @click="enterMergeMode"
              >
                <i class="pi pi-share-alt chip-icon" />
                Create Merged Sale
              </button>
            </div>
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
            <Select
              v-model="filterPaymentMethod"
              :options="filterPaymentOptions"
              option-label="name"
              option-value="id"
              placeholder="All Payment Methods"
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

        <!-- Summary bar -->
        <div class="summary-bar">
          <span class="summary-count">
            <i class="pi pi-list summary-icon" />
            {{ filteredSales.length }} sale{{ filteredSales.length !== 1 ? 's' : '' }}
          </span>
          <span class="summary-sep">·</span>
          <span class="summary-totals">
            <span class="summary-metric-label">Revenue</span>
            <template v-if="filteredPeriodSums.length">
              <span v-for="(t, i) in filteredPeriodSums" :key="'r-' + t.currency" class="summary-total">
                <span v-if="i > 0" class="summary-currency-sep">+</span>
                <span class="summary-amount">{{ t.revenue }}</span>
                <span class="summary-currency">{{ t.currency }}</span>
              </span>
            </template>
            <span v-else class="summary-zero">—</span>
          </span>
          <button
            v-if="auth.isAdmin"
            type="button"
            class="summary-expand"
            :aria-expanded="financeOpen"
            :aria-label="financeOpen ? 'Hide cost and profit' : 'Show cost and profit'"
            @click="financeOpen = !financeOpen"
          >
            <i :class="financeOpen ? 'pi pi-chevron-down' : 'pi pi-chevron-right'" />
          </button>
          <template v-if="auth.isAdmin && financeOpen">
            <span class="summary-sep">·</span>
            <span class="summary-totals summary-cogs">
              <span class="summary-metric-label">Cost of goods</span>
              <template v-if="filteredPeriodSums.length">
                <span v-for="(t, i) in filteredPeriodSums" :key="'c-' + t.currency" class="summary-total">
                  <span v-if="i > 0" class="summary-currency-sep">+</span>
                  <span class="summary-amount">{{ t.cost }}</span>
                  <span class="summary-currency">{{ t.currency }}</span>
                </span>
              </template>
              <span v-else class="summary-zero">—</span>
            </span>
            <span class="summary-sep">·</span>
            <span class="summary-totals summary-profit">
              <span class="summary-metric-label">Profit</span>
              <template v-if="filteredPeriodSums.length">
                <span v-for="(t, i) in filteredPeriodSums" :key="'p-' + t.currency" class="summary-total">
                  <span v-if="i > 0" class="summary-currency-sep">+</span>
                  <span class="summary-amount" :class="{ negative: t.profitNegative }">{{ t.profit }}</span>
                  <span class="summary-currency">{{ t.currency }}</span>
                </span>
              </template>
              <span v-else class="summary-zero">—</span>
            </span>
          </template>
        </div>
      </div>
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
        data-key="id"
        @row-click="onRowClick"
      >
        <Column
          v-if="mergeMode"
          :frozen="true"
          header=""
          class="col-select"
        >
          <template #body="{ data }">
            <Checkbox
              :model-value="isSelected(data.id)"
              :binary="true"
              :disabled="!isSelectable(data) && !isSelected(data.id)"
              :title="selectableTitle(data)"
              @click.stop
              @update:model-value="(v) => toggleSale(data, !!v)"
            />
          </template>
        </Column>

        <Column field="saleDate" header="Date" sortable class="col-date">
          <template #body="{ data }">
            <span class="date-text">{{ formatDate(data.saleDate) }}</span>
          </template>
        </Column>

        <Column field="customerName" header="Customer" class="col-customer" sortable>
          <template #body="{ data }">
            <div v-if="data.customerName" class="customer-cell">
              <span class="customer-name">{{ data.customerName }}</span>
              <span v-if="data.customerEmail" class="customer-email">{{ data.customerEmail }}</span>
            </div>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="warehouseName" header="Warehouse" class="col-warehouse" sortable>
          <template #body="{ data }">
            <span class="warehouse-text">{{ data.warehouseName ?? '—' }}</span>
          </template>
        </Column>

        <Column field="createdByName" header="Admin" class="col-admin" sortable>
          <template #body="{ data }">
            <span v-if="data.createdByName" class="admin-name">{{ data.createdByName }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="saleType" header="Type" class="col-type" sortable>
          <template #body="{ data }">
            <Tag :value="typeLabel(data.saleType)" :severity="typeSeverity(data.saleType)" />
          </template>
        </Column>

        <Column field="targetName" header="Target" class="col-meta" sortable>
          <template #body="{ data }">
            <Tag v-if="data.targetName" :value="data.targetName" severity="secondary" />
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="invoiceStatusName" header="Invoice" class="col-meta" sortable>
          <template #body="{ data }">
            <Tag v-if="data.invoiceStatusName" :value="data.invoiceStatusName" severity="info" />
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="paymentMethods" header="Payment" class="col-payment">
          <template #body="{ data }">
            <div v-if="data.paymentMethods?.length" class="payment-methods">
              <span v-for="m in data.paymentMethods" :key="m.id" class="payment-badge">{{ m.name }}</span>
            </div>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="wooOrderId" header="Order #" class="col-order">
          <template #body="{ data }">
            <span v-if="data.wooOrderId" class="order-ref">#{{ data.wooOrderId }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="itemCount" header="Items" class="col-items" sortable>
          <template #body="{ data }">
            <span class="item-count">{{ data.itemCount }}</span>
          </template>
        </Column>

        <Column field="totalPrice" header="Total" class="col-total" sortable>
          <template #body="{ data }">
            <span v-if="data.totalPrice" class="total-price">
              {{ parseFloat(data.totalPrice).toFixed(2) }} {{ data.currency }}
            </span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="status" header="Status" class="col-status" sortable>
          <template #body="{ data }">
            <Tag :value="statusLabel(data.status)" :severity="statusSeverity(data.status)" />
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
      @refreshed="refreshKey++"
    />
    <CreateSaleModal v-model="showCreate" @created="onSaleCreated" />
    <EditSaleModal v-model="showEdit" :sale="editingSale" @updated="onSaleUpdated" />
    <MergeSalesModal
      v-model="showMerge"
      :sale-ids="selectedSaleIds"
      @created="onMergedCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getSales, getSale, type Sale, type SaleDetail, type SaleType } from '@/api/sales'
import { getSaleTargets, getSaleInvoiceStatuses, getSalePaymentMethods, type SaleMetaItem } from '@/api/saleMeta'
import Checkbox from 'primevue/checkbox'
import SalePeriodStats from '@/components/sales/SalePeriodStats.vue'
import SaleDetailDialog from '@/components/sales/SaleDetailDialog.vue'
import CreateSaleModal from '@/components/sales/CreateSaleModal.vue'
import EditSaleModal from '@/components/sales/EditSaleModal.vue'
import MergeSalesModal from '@/components/sales/MergeSalesModal.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const financeOpen = ref(false)

// ── Collapsible panels toggle (mobile) ───────────────────────────────────────
const panelsOpen = ref(true)

// ── Date range (driven by SalePeriodStats) ────────────────────────────────────
const dateRange = ref<{ from: string; to: string } | null>(null)

function onDateRangeChange(range: { from: string; to: string } | null) {
  dateRange.value = range
}

// ── Data ──────────────────────────────────────────────────────────────────────
const activeFilter      = ref<SaleType | undefined>(undefined)
const filterTarget        = ref<string | null>(null)
const filterInvoiceStatus = ref<string | null>(null)
const filterPaymentMethod = ref<string | null>(null)
const filterTargetOptions  = ref<SaleMetaItem[]>([])
const filterInvoiceOptions = ref<SaleMetaItem[]>([])
const filterPaymentOptions = ref<SaleMetaItem[]>([])
const search       = ref('')

onMounted(async () => {
  try {
    [filterTargetOptions.value, filterInvoiceOptions.value, filterPaymentOptions.value] = await Promise.all([
      getSaleTargets(),
      getSaleInvoiceStatuses(),
      getSalePaymentMethods(),
    ])
  } catch { /* non-critical */ }
})
const showCreate   = ref(false)
const showDetail   = ref(false)
const showEdit     = ref(false)
const showMerge    = ref(false)
const selectedSale = ref<SaleDetail | null>(null)
const editingSale  = ref<SaleDetail | null>(null)
const refreshKey   = ref(0)

// ── Merge selection mode ──────────────────────────────────────────────────────
const mergeMode        = ref(false)
const selectedSales    = ref<Sale[]>([])
const selectedSaleIds  = ref<string[]>([])

function enterMergeMode() {
  mergeMode.value = true
  selectedSales.value = []
  selectedSaleIds.value = []
  panelsOpen.value = true
}

function exitMergeMode() {
  mergeMode.value = false
  selectedSales.value = []
  selectedSaleIds.value = []
  showMerge.value = false
}

function openMergeModal() {
  if (selectedSaleIds.value.length < 2) return
  showMerge.value = true
}

function isSelected(id: string) {
  return selectedSaleIds.value.includes(id)
}

function isSelectable(sale: Sale) {
  if (sale.status === 'superseded') return false
  if (selectedSaleIds.value.length === 0) return true
  const first = selectedSales.value[0] ?? sales.value.find(s => s.id === selectedSaleIds.value[0])
  if (!first) return true
  return sale.warehouseId === first.warehouseId && sale.currency === first.currency
}

function selectableTitle(sale: Sale) {
  if (sale.status === 'superseded') return 'Already merged into another sale'
  if (isSelectable(sale)) return undefined
  return 'Must match warehouse and currency of the first selected sale'
}

function toggleSale(sale: Sale, checked: boolean) {
  if (checked) {
    if (!isSelectable(sale)) return
    if (!selectedSaleIds.value.includes(sale.id)) {
      selectedSaleIds.value = [...selectedSaleIds.value, sale.id]
      selectedSales.value = [...selectedSales.value, sale]
    }
  } else {
    selectedSaleIds.value = selectedSaleIds.value.filter(id => id !== sale.id)
    selectedSales.value = selectedSales.value.filter(s => s.id !== sale.id)
  }
}

function onRowClick(e: { data: Sale }) {
  if (mergeMode.value) {
    const sale = e.data
    if (!isSelectable(sale) && !isSelected(sale.id)) return
    toggleSale(sale, !isSelected(sale.id))
    return
  }
  openDetail(e.data)
}

function onMergedCreated() {
  exitMergeMode()
  onSaleCreated()
}

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
const route = useRoute()

watch(
  () => route.query.open,
  async (id) => {
    if (typeof id !== 'string') return
    try {
      selectedSale.value = await getSale(id)
      showDetail.value = true
    } catch { /* sale may not exist */ }
    router.replace({ path: '/sales' })
  },
  { immediate: true },
)

const typeFilters = computed(() => [
  { value: undefined,                  label: 'All',         icon: 'pi pi-list',      count: sales.value.length },
  { value: 'woocommerce' as SaleType,  label: 'WooCommerce', icon: 'pi pi-globe',     count: sales.value.filter(s => s.saleType === 'woocommerce').length },
  { value: 'direct' as SaleType,       label: 'Direct',      icon: 'pi pi-user',      count: sales.value.filter(s => s.saleType === 'direct').length },
  { value: 'partner' as SaleType,      label: 'Partner',     icon: 'pi pi-building',  count: sales.value.filter(s => s.saleType === 'partner').length },
  { value: 'merged' as SaleType,       label: 'Merged',      icon: 'pi pi-share-alt', count: sales.value.filter(s => s.saleType === 'merged').length },
])

const filteredSales = computed(() => {
  let list = sales.value
  if (activeFilter.value)        list = list.filter(s => s.saleType === activeFilter.value)
  if (filterTarget.value)        list = list.filter(s => s.targetId === filterTarget.value)
  if (filterInvoiceStatus.value) list = list.filter(s => s.invoiceStatusId === filterInvoiceStatus.value)
  if (filterPaymentMethod.value) list = list.filter(s => s.paymentMethods?.some(m => m.id === filterPaymentMethod.value))
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(s =>
      s.customerName?.toLowerCase().includes(q) ||
      s.customerEmail?.toLowerCase().includes(q) ||
      s.wooOrderId?.toLowerCase().includes(q) ||
      s.warehouseName?.toLowerCase().includes(q) ||
      s.createdByName?.toLowerCase().includes(q),
    )
  }
  return list
})

function formatMoney(n: number) {
  return n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const filteredPeriodSums = computed(() => {
  const byCurrency: Record<string, { total: number; cost: number }> = {}
  for (const s of filteredSales.value) {
    const total = s.totalPrice ? parseFloat(s.totalPrice) : 0
    const cost  = s.costOfGoods != null ? parseFloat(String(s.costOfGoods)) : 0
    if (!total && !cost) continue
    const cur = s.currency ?? 'ILS'
    if (!byCurrency[cur]) byCurrency[cur] = { total: 0, cost: 0 }
    byCurrency[cur].total += Number.isNaN(total) ? 0 : total
    byCurrency[cur].cost  += Number.isNaN(cost)  ? 0 : cost
  }
  return Object.entries(byCurrency)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, v]) => {
      const profit = v.total - v.cost
      return {
        currency,
        revenue: formatMoney(v.total),
        cost:    formatMoney(v.cost),
        profit:  formatMoney(profit),
        profitNegative: profit < 0,
      }
    })
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
  if (type === 'woocommerce') return 'WooCommerce'
  if (type === 'partner')     return 'Partner'
  if (type === 'merged')      return 'Merged'
  return 'Direct'
}

function typeSeverity(type: SaleType) {
  if (type === 'woocommerce') return 'info'
  if (type === 'partner')     return 'warn'
  if (type === 'merged')      return 'contrast'
  return 'success'
}

function statusLabel(status: string) {
  if (status === 'superseded') return 'Merged'
  return status
}

function statusSeverity(status: string) {
  if (status === 'completed') return 'success'
  if (status === 'cancelled') return 'danger'
  if (status === 'superseded') return 'secondary'
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
.header-actions { display: flex; align-items: center; gap: 8px; }

.header-icon { font-size: 26px; color: var(--p-primary-color); }

.view-title    { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

/* Toggle button */
.panels-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-surface-card);
  color: var(--p-text-muted-color);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  flex-shrink: 0;
}
.panels-toggle:hover { background: var(--p-surface-hover); color: var(--p-primary-color); }

/* Collapsible panels — same grid trick on all screen sizes */
.collapsible-panels {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.28s ease;
}
.collapsible-panels.expanded {
  grid-template-rows: 1fr;
}
.collapsible-inner {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: hidden;
  min-height: 0;
}

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

/* ── Summary bar ── */
.summary-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  flex-wrap: wrap;
}

.summary-icon { font-size: 12px; color: #94a3b8; margin-right: 2px; }

.summary-count { font-weight: 500; color: #64748b; display: flex; align-items: center; gap: 4px; }

.summary-sep { color: #cbd5e1; }

.summary-totals { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.summary-metric-label {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-right: 2px;
}

.summary-cogs .summary-amount { color: #475569; }

.summary-profit .summary-amount { color: #047857; }
.summary-profit .summary-amount.negative { color: #b91c1c; }

.summary-expand {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-left: 2px;
  padding: 0;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  flex-shrink: 0;
}

.summary-expand:hover {
  border-color: #0891b2;
  color: #0891b2;
}

.summary-expand .pi { font-size: 10px; }

.summary-total { display: inline-flex; align-items: baseline; gap: 3px; }

.summary-amount {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #0f172a;
  font-size: 14px;
}

.summary-currency { font-size: 12px; font-weight: 600; color: #64748b; }

.summary-currency-sep { color: #94a3b8; font-size: 12px; }

.summary-zero { color: #94a3b8; }

.merge-controls {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.chip-merge {
  border-style: dashed;
  color: var(--p-primary-color);
  border-color: var(--p-primary-200, #bfdbfe);
  background: var(--p-primary-50, #eff6ff);
}

.chip-merge:hover {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
  background: var(--p-primary-50, #eff6ff);
}

.merge-indicator {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-primary-color);
  padding: 4px 10px;
  background: var(--p-primary-50, #eff6ff);
  border: 1px solid var(--p-primary-200, #bfdbfe);
  border-radius: 20px;
  white-space: nowrap;
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

/* ── Column widths ── */
:deep(.col-select)    { width: 48px; min-width: 48px; text-align: center; }
:deep(.col-date)      { width: 150px; min-width: 150px; }
:deep(.col-customer)  { min-width: 160px; }
:deep(.col-warehouse) { width: 140px; min-width: 110px; }
:deep(.col-admin)     { width: 120px; min-width: 100px; }
:deep(.col-type)      { width: 110px; min-width: 100px; }
:deep(.col-meta)      { width: 120px; min-width: 100px; }
:deep(.col-payment)   { width: 140px; min-width: 110px; }
:deep(.col-order)     { width: 100px; min-width: 90px; }
:deep(.col-items)     { width: 70px;  min-width: 60px;  text-align: right; }
:deep(.col-total)     { width: 120px; min-width: 100px; text-align: right; white-space: nowrap; }
:deep(.col-status)    { width: 100px; min-width: 90px; }

/* ── Cell styles ── */
.date-text {
  font-size: 12px;
  color: var(--p-text-color);
  white-space: nowrap;
}

.customer-cell  { display: flex; flex-direction: column; gap: 1px; }
.customer-name  { font-size: 13px; }
.customer-email { font-size: 11px; color: var(--p-text-muted-color); }

.warehouse-text { font-size: 12px; white-space: nowrap; }
.admin-name     { font-size: 12px; white-space: nowrap; color: var(--p-text-color); }

.order-ref  { font-family: monospace; font-size: 12px; color: var(--p-primary-color); }
.item-count { font-weight: 700; font-size: 13px; }
.total-price {
  font-weight: 700;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.payment-methods { display: flex; flex-wrap: wrap; gap: 3px; }
.payment-badge   { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: #f0fdf4; color: #15803d; white-space: nowrap; }

.no-value { color: var(--p-text-muted-color); font-size: 12px; }

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

  :deep(.col-date)      { width: 130px; min-width: 130px; }
  :deep(.col-warehouse) { width: 130px; min-width: 100px; }
  :deep(.col-meta)      { width: 100px; min-width: 90px; }
  .date-text { font-size: 11px; }
}
</style>
