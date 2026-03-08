<template>
  <div class="transfers-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-left">
        <i class="pi pi-arrows-h header-icon" />
        <div>
          <h2 class="view-title">Stock Transfers</h2>
          <span class="view-subtitle">Move inventory between warehouses</span>
        </div>
      </div>
      <Button label="New Transfer" icon="pi pi-plus" size="small" @click="showCreate = true" />
    </div>

    <TransferStatsSection :transfers="transfers" @date-range-change="dateRange = $event" />

    <!-- Toolbar -->
    <div class="toolbar">
      <InputText v-model="search" placeholder="Search by reference, warehouse…" size="small" style="width: 280px" />
    </div>

    <!-- Table -->
    <div class="table-card">
      <DataTable
        :value="filteredTransfers"
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
        <Column field="createdAt" header="Date" style="width: 160px" sortable>
          <template #body="{ data }">{{ formatDate(data.createdAt) }}</template>
        </Column>

        <Column header="Route" style="min-width: 240px">
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

        <Column field="status" header="Status" style="width: 100px">
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

    <TransferDetailDialog v-model:visible="showDetail" :transfer="selectedTransfer" @deleted="onTransferDeleted" />
    <CreateTransferModal v-model="showCreate" @created="onTransferCreated" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getTransfers, getTransfer, type TransferSummary, type TransferDetail } from '@/api/transfers'
import TransferStatsSection  from '@/components/transfers/TransferStatsSection.vue'
import TransferDetailDialog  from '@/components/transfers/TransferDetailDialog.vue'
import CreateTransferModal   from '@/components/transfers/CreateTransferModal.vue'

const showCreate       = ref(false)
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
  display: flex; flex-direction: column; height: 100%; padding: 24px; gap: 16px;
}

.view-header { display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 14px; }
.header-icon { font-size: 26px; color: var(--p-primary-color); }
.view-title  { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.toolbar { display: flex; align-items: center; gap: 8px; }

.table-card {
  flex: 1; background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column;
}

.route-cell { display: flex; align-items: center; gap: 8px; }
.wh-badge { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 6px; white-space: nowrap; }
.wh-from { background: var(--p-orange-50, #fff7ed); color: var(--p-orange-700, #c2410c); }
.wh-to   { background: var(--p-green-50, #f0fdf4);  color: var(--p-green-700, #15803d); }
.route-arrow { color: var(--p-text-muted-color); font-size: 12px; }
.ref-text    { font-family: monospace; font-size: 12px; color: var(--p-primary-color); }
.item-count  { font-weight: 700; }
.notes-text  { font-size: 12px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; display: block; }
.no-value    { color: var(--p-text-muted-color); }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; color: var(--p-text-muted-color); }
.empty-icon  { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }
.empty-sub   { font-size: 13px; }
</style>
