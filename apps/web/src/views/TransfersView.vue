<template>
  <div class="transfers-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-left">
        <Button icon="pi pi-arrow-left" text rounded size="small" @click="router.push('/inventory')" />
        <i class="pi pi-arrows-h header-icon" />
        <div>
          <h2 class="view-title">Stock Transfers</h2>
          <span class="view-subtitle">Move inventory between warehouses</span>
        </div>
      </div>
      <Button label="New Transfer" icon="pi pi-plus" size="small" class="btn-new-transfer" @click="showCreate = true" />
    </div>

    <TransferStatsSection :transfers="transfers" @date-range-change="dateRange = $event" />

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search-wrap">
        <InputText v-model="search" placeholder="Search by reference, warehouse…" size="small" class="search-input" />
      </div>
    </div>

    <!-- Table -->
    <div class="table-card transfers-table-wrap">
      <DataTable
        :value="filteredTransfers"
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
        class="transfers-datatable"
        @row-click="openDetail($event.data)"
      >
        <Column field="createdAt" header="Date" :frozen="!isMobile" sortable class="col-date">
          <template #body="{ data }"><span class="date-text">{{ formatDate(data.createdAt) }}</span></template>
        </Column>

        <Column header="Route" :frozen="!isMobile" class="col-route">
          <template #body="{ data }">
            <div class="route-cell">
              <span class="wh-badge wh-from">{{ data.fromWarehouseName ?? '—' }}</span>
              <i class="pi pi-arrow-right route-arrow" />
              <span class="wh-badge wh-to">{{ data.toWarehouseName ?? '—' }}</span>
            </div>
          </template>
        </Column>

        <Column field="reference" header="Reference" style="width: 140px">
          <template #body="{ data }">
            <span v-if="data.reference" class="ref-text">{{ data.reference }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="itemCount" header="Products" style="width: 90px; text-align:right" sortable>
          <template #body="{ data }">
            <span class="item-count">{{ data.itemCount }}</span>
          </template>
        </Column>

        <Column field="notes" header="Notes" style="min-width: 160px">
          <template #body="{ data }">
            <span class="notes-text">{{ data.notes ?? '—' }}</span>
          </template>
        </Column>

        <Column field="status" header="Status" :frozen="!isMobile" align-frozen="right" style="width: 100px">
          <template #body="{ data }">
            <Tag :value="data.status" :severity="data.status === 'completed' ? 'success' : 'danger'" />
          </template>
        </Column>

        <template #empty>
          <div class="empty-state">
            <i class="pi pi-arrows-h empty-icon" />
            <p>No transfers yet</p>
            <p class="empty-sub">Click "New Transfer" to move stock between warehouses</p>
          </div>
        </template>
      </DataTable>
    </div>

    <TransferDetailDialog
      v-model:visible="showDetail"
      :transfer="selectedTransfer"
      @deleted="onTransferDeleted"
      @edit="onEditTransfer"
    />
    <CreateTransferModal v-model="showCreate" @created="onTransferCreated" />
    <EditTransferModal v-model="showEdit" :transfer="editingTransfer" @updated="onTransferUpdated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getTransfers, getTransfer, type TransferSummary, type TransferDetail } from '@/api/transfers'
import TransferStatsSection  from '@/components/transfers/TransferStatsSection.vue'
import TransferDetailDialog  from '@/components/transfers/TransferDetailDialog.vue'
import CreateTransferModal   from '@/components/transfers/CreateTransferModal.vue'
import EditTransferModal     from '@/components/transfers/EditTransferModal.vue'

const router = useRouter()
const showCreate        = ref(false)
const showEdit          = ref(false)
const editingTransfer   = ref<TransferDetail | null>(null)
const isMobile          = ref(false)
const mobileQuery      = window.matchMedia('(max-width: 768px)')
function setMobile() { isMobile.value = mobileQuery.matches }
onMounted(() => { setMobile(); mobileQuery.addEventListener('change', setMobile) })
onUnmounted(() => mobileQuery.removeEventListener('change', setMobile))
const showDetail       = ref(false)
const selectedTransfer = ref<TransferDetail | null>(null)
const search           = ref('')
const dateRange        = ref<{ from: Date; to: Date } | null>(null)
const refreshKey       = ref(0)

const { data: transfersData, isLoading } = useQuery({
  queryKey: computed(() => ['transfers', dateRange.value?.from.toISOString(), dateRange.value?.to.toISOString(), refreshKey.value]),
  queryFn:  () => getTransfers({
    limit:    1000,
    dateFrom: dateRange.value?.from.toISOString(),
    dateTo:   dateRange.value?.to.toISOString(),
  }),
})

function onTransferDeleted() {
  selectedTransfer.value = null
  refreshKey.value++
}

function onEditTransfer(transfer: TransferDetail) {
  editingTransfer.value = transfer
  showEdit.value        = true
}

function onTransferUpdated() {
  showEdit.value          = false
  showDetail.value        = false
  selectedTransfer.value  = null
  refreshKey.value++
}

function onTransferCreated() {
  if (dateRange.value) {
    // Push dateTo 60s into the future to cover any client/server clock skew
    dateRange.value = { from: dateRange.value.from, to: new Date(Date.now() + 60_000) }
  }
  refreshKey.value++
}

const transfers = computed(() => transfersData.value ?? [])

const filteredTransfers = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return transfers.value
  return transfers.value.filter(t =>
    t.reference?.toLowerCase().includes(q) ||
    t.fromWarehouseName?.toLowerCase().includes(q) ||
    t.toWarehouseName?.toLowerCase().includes(q) ||
    t.notes?.toLowerCase().includes(q),
  )
})

async function openDetail(transfer: TransferSummary) {
  selectedTransfer.value = null
  showDetail.value = true
  selectedTransfer.value = await getTransfer(transfer.id)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}
</script>

<style scoped>
.transfers-view {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.view-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.header-icon { font-size: 26px; color: var(--p-primary-color); flex-shrink: 0; }
.view-title  { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.btn-new-transfer :deep(.p-button-label) { white-space: nowrap; }

.toolbar { display: flex; align-items: center; gap: 8px; }
.search-wrap { width: 280px; }
.search-input { width: 100%; }

.table-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
}

/* Table min-width for horizontal scroll */
:deep(.transfers-datatable .p-datatable-table) {
  min-width: 700px;
}

/* Frozen columns opaque background */
:deep(.transfers-datatable .p-datatable-tbody .p-frozen-column),
:deep(.transfers-datatable .p-datatable-thead .p-frozen-column) { background: #fff; }
:deep(.transfers-datatable tr.p-row-odd .p-frozen-column) { background: var(--p-datatable-row-striped-background, #fafafa); }
:deep(.transfers-datatable tr:hover .p-frozen-column) { background: var(--p-datatable-row-hover-background, #f1f5f9); }

/* Date column */
:deep(.col-date) { width: 150px; min-width: 150px; }
.date-text {
  font-size: 12px;
  color: var(--p-text-color);
  white-space: nowrap;
}

/* Route column */
:deep(.col-route) { min-width: 220px; }
.route-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}
.wh-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
  white-space: nowrap;
}
.wh-from { background: var(--p-orange-50, #fff7ed); color: var(--p-orange-700, #c2410c); }
.wh-to   { background: var(--p-green-50, #f0fdf4);  color: var(--p-green-700, #15803d); }
.route-arrow { color: var(--p-text-muted-color); font-size: 10px; flex-shrink: 0; }
.ref-text    { font-family: monospace; font-size: 12px; color: var(--p-primary-color); }
.item-count  { font-weight: 700; }
.notes-text  {
  font-size: 12px;
  color: var(--p-text-muted-color);
}
.no-value    { color: var(--p-text-muted-color); }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; color: var(--p-text-muted-color); }
.empty-icon  { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }
.empty-sub   { font-size: 13px; }

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .transfers-view { gap: 10px; }
  .view-title { font-size: 18px; }
  .view-subtitle { font-size: 12px; }
  .header-left .header-icon { display: none; }
  .view-header .p-button-label { display: none; }

  .search-wrap { flex: 1; min-width: 0; width: auto; }

  :deep(.transfers-datatable .p-datatable-tbody td),
  :deep(.transfers-datatable .p-datatable-thead th) { padding: 6px 8px; font-size: 12px; }
  :deep(.col-date) { width: 130px; min-width: 130px; }
  :deep(.col-route) { min-width: 180px; }
  .date-text { font-size: 11px; }
  .wh-badge { font-size: 10px; padding: 2px 6px; }
}

@media (max-width: 480px) {
  .transfers-view { gap: 8px; }
  .view-title { font-size: 16px; }
}
</style>
