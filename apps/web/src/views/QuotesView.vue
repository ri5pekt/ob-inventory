<template>
  <div class="quotes-view">
    <div class="view-header">
      <div class="header-left">
        <Button icon="pi pi-arrow-left" text rounded size="small" @click="router.push('/sales')" />
        <i class="pi pi-file-edit header-icon" />
        <div class="header-text">
          <h2 class="view-title">Price Quotes</h2>
          <span class="view-subtitle">Quotes do not reduce stock until converted to a sale</span>
        </div>
      </div>
      <div class="header-actions">
        <button class="panels-toggle" :aria-label="panelsOpen ? 'Collapse filters' : 'Expand filters'" @click="panelsOpen = !panelsOpen">
          <i :class="panelsOpen ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
        </button>
        <Button label="New Quote" icon="pi pi-plus" size="small" @click="openCreate" />
      </div>
    </div>

    <div class="collapsible-panels" :class="{ expanded: panelsOpen }">
      <div class="collapsible-inner">
        <div class="filter-bar">
          <div class="filter-chips">
            <button
              v-for="f in statusFilters"
              :key="f.value ?? 'all'"
              class="chip"
              :class="{ active: statusFilter === f.value }"
              @click="statusFilter = f.value"
            >
              {{ f.label }}
              <span class="chip-count">{{ f.count }}</span>
            </button>
          </div>
          <InputText v-model="search" placeholder="Search customer or quote #…" size="small" class="filter-search" />
        </div>

        <div class="summary-bar">
          <span class="summary-count">
            <i class="pi pi-list" />
            {{ filteredQuotes.length }} quote{{ filteredQuotes.length !== 1 ? 's' : '' }}
          </span>
        </div>
      </div>
    </div>

    <div class="table-card">
      <DataTable
        class="quotes-datatable"
        :value="filteredQuotes"
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
        <Column field="quoteNumber" header="#" sortable class="col-num">
          <template #body="{ data }">
            <span class="quote-num">#{{ data.quoteNumber }}</span>
          </template>
        </Column>
        <Column field="quoteDate" header="Date" sortable class="col-date">
          <template #body="{ data }">
            <span class="date-text">{{ formatDate(data.quoteDate) }}</span>
          </template>
        </Column>
        <Column field="customerName" header="Customer" sortable class="col-customer">
          <template #body="{ data }">
            <div v-if="data.customerName" class="customer-cell">
              <span class="customer-name">{{ data.customerName }}</span>
              <span v-if="data.customerEmail" class="customer-email">{{ data.customerEmail }}</span>
            </div>
            <span v-else class="no-value">—</span>
          </template>
        </Column>
        <Column field="itemCount" header="Items" sortable class="col-items">
          <template #body="{ data }"><span class="item-count">{{ data.itemCount }}</span></template>
        </Column>
        <Column field="totalPrice" header="Total" sortable class="col-total">
          <template #body="{ data }">
            <span v-if="data.totalPrice" class="total-price">
              {{ parseFloat(data.totalPrice).toFixed(2) }} {{ data.currency }}
            </span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>
        <Column field="status" header="Status" sortable class="col-status">
          <template #body="{ data }">
            <Tag :value="statusLabel(data.status)" :severity="statusSeverity(data.status)" />
          </template>
        </Column>
        <template #empty>
          <div class="empty-state">
            <i class="pi pi-file-edit empty-icon" />
            <p>No quotes yet</p>
          </div>
        </template>
      </DataTable>
    </div>

    <QuoteDetailDialog
      v-model:visible="showDetail"
      :quote="selectedQuote"
      @edit="onEdit"
      @changed="refresh"
      @converted="onConverted"
      @open-sale="openSale"
    />
    <CreateQuoteModal v-model="showForm" :quote="editingQuote" @saved="onSaved" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { getQuotes, getQuote, type Quote, type QuoteDetail, type QuoteStatus } from '@/api/quotes'
import QuoteDetailDialog from '@/components/quotes/QuoteDetailDialog.vue'
import CreateQuoteModal from '@/components/quotes/CreateQuoteModal.vue'

const router = useRouter()
const queryClient = useQueryClient()
const panelsOpen = ref(true)
const search = ref('')
const statusFilter = ref<QuoteStatus | null>(null)
const showDetail = ref(false)
const showForm = ref(false)
const selectedQuote = ref<QuoteDetail | null>(null)
const editingQuote = ref<QuoteDetail | null>(null)

const { data: quotes, isLoading } = useQuery({
  queryKey: ['quotes'],
  queryFn: () => getQuotes(),
})

const statusFilters = computed(() => {
  const list = quotes.value ?? []
  return [
    { value: null, label: 'All', count: list.length },
    { value: 'open' as const, label: 'Open', count: list.filter(q => q.status === 'open').length },
    { value: 'converted' as const, label: 'Converted', count: list.filter(q => q.status === 'converted').length },
    { value: 'cancelled' as const, label: 'Cancelled', count: list.filter(q => q.status === 'cancelled').length },
  ]
})

const filteredQuotes = computed(() => {
  let list = quotes.value ?? []
  if (statusFilter.value) list = list.filter(q => q.status === statusFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) {
    list = list.filter(row =>
      String(row.quoteNumber).includes(q)
      || row.customerName?.toLowerCase().includes(q)
      || row.customerEmail?.toLowerCase().includes(q)
      || row.customerPhone?.toLowerCase().includes(q),
    )
  }
  return list
})

function statusLabel(status: QuoteStatus) {
  if (status === 'converted') return 'Converted'
  if (status === 'cancelled') return 'Cancelled'
  return 'Open'
}
function statusSeverity(status: QuoteStatus) {
  if (status === 'converted') return 'success'
  if (status === 'cancelled') return 'secondary'
  return 'info'
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function refresh() {
  queryClient.invalidateQueries({ queryKey: ['quotes'] })
  if (selectedQuote.value) {
    getQuote(selectedQuote.value.id).then(q => { selectedQuote.value = q }).catch(() => {})
  }
}

function openCreate() {
  editingQuote.value = null
  showForm.value = true
}

async function onRowClick(e: { data: Quote }) {
  selectedQuote.value = await getQuote(e.data.id)
  showDetail.value = true
}

function onEdit(quote: QuoteDetail) {
  editingQuote.value = quote
  showDetail.value = false
  showForm.value = true
}

function onSaved() {
  editingQuote.value = null
  refresh()
}

async function onConverted(saleId: string) {
  showDetail.value = false
  refresh()
  queryClient.invalidateQueries({ queryKey: ['sales'] })
  router.push({ path: '/sales', query: { open: saleId } })
}

function openSale(saleId: string) {
  router.push({ path: '/sales', query: { open: saleId } })
}
</script>

<style scoped>
.quotes-view {
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
  gap: 8px;
}

.header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.header-text { min-width: 0; }
.header-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.header-icon { font-size: 26px; color: var(--p-primary-color); }
.view-title    { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

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
  flex-shrink: 0;
}
.panels-toggle:hover { background: var(--p-surface-hover); color: var(--p-primary-color); }

.collapsible-panels {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.28s ease;
}
.collapsible-panels.expanded { grid-template-rows: 1fr; }
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
  white-space: nowrap;
}
.chip.active { background: var(--p-primary-color); border-color: var(--p-primary-color); color: #fff; }
.chip-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: rgba(0, 0, 0, 0.08);
  font-size: 11px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.chip.active .chip-count { background: rgba(255, 255, 255, 0.25); }

.summary-bar {
  display: flex;
  align-items: center;
  padding: 7px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 13px;
  color: #64748b;
}
.summary-count { display: flex; align-items: center; gap: 6px; font-weight: 500; }

.table-card {
  flex: 1;
  min-height: 0;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

:deep(.col-num)      { width: 64px;  min-width: 64px; }
:deep(.col-date)     { width: 130px; min-width: 120px; }
:deep(.col-customer) { min-width: 160px; }
:deep(.col-items)    { width: 70px;  min-width: 60px; text-align: right; }
:deep(.col-total)    { width: 120px; min-width: 100px; text-align: right; white-space: nowrap; }
:deep(.col-status)   { width: 110px; min-width: 100px; }

.quote-num { font-weight: 700; }
.date-text { font-size: 12px; color: var(--p-text-color); white-space: nowrap; }
.customer-cell { display: flex; flex-direction: column; gap: 1px; }
.customer-name { font-size: 13px; font-weight: 600; }
.customer-email { font-size: 11px; color: var(--p-text-muted-color); }
.item-count { font-weight: 700; font-size: 13px; }
.total-price { font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.no-value { color: var(--p-text-muted-color); font-size: 12px; }

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 20px;
  color: var(--p-text-muted-color);
}
.empty-icon { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }

:deep(.quotes-datatable) { height: 100%; }
:deep(.quotes-datatable .p-datatable-row) { cursor: pointer; }
:deep(.quotes-datatable .p-datatable-tbody td),
:deep(.quotes-datatable .p-datatable-thead th) { padding: 6px 8px; }
:deep(.quotes-datatable .p-paginator) { padding: 6px 8px; }
:deep(.quotes-datatable .p-tag) { white-space: nowrap; }

@media (max-width: 768px) {
  .quotes-view { gap: 10px; }
  .header-left .header-icon { display: none; }
  .view-title { font-size: 18px; }
  .view-subtitle { font-size: 12px; display: none; }
  .header-actions :deep(.p-button-label) { display: none; }

  .filter-bar { flex-direction: column; align-items: stretch; gap: 6px; }
  .filter-chips {
    width: 100%;
    flex-wrap: nowrap;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    padding-bottom: 2px;
  }
  .filter-search { min-width: 0; width: 100%; }
  .chip { padding: 4px 10px; font-size: 12px; flex-shrink: 0; }

  .empty-state { padding: 40px 16px; }
  .empty-icon { font-size: 32px; }

  :deep(.quotes-datatable .p-datatable-tbody td),
  :deep(.quotes-datatable .p-datatable-thead th) {
    padding: 6px 8px;
    font-size: 12px;
  }

  :deep(th.col-items),
  :deep(td.col-items) { display: none; }
  :deep(.col-date)  { width: 110px; min-width: 110px; }
  :deep(.col-num)   { width: 52px; min-width: 52px; }
  :deep(.col-total) { width: 100px; min-width: 90px; }
  :deep(.col-status) { width: 96px; min-width: 90px; }
  .date-text { font-size: 11px; }
}

@media (max-width: 480px) {
  :deep(.quotes-datatable .p-paginator) {
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
  }
}
</style>
