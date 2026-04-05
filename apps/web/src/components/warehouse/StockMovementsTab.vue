<template>
  <div class="movements-tab">

    <!-- Filter bar -->
    <div class="filter-bar">
      <Select
        v-model="activeAction"
        :options="actionOptions"
        option-label="label"
        option-value="value"
        placeholder="All actions"
        show-clear
        size="small"
        class="action-select"
        append-to="body"
      />
      <div class="search-wrap">
        <i class="pi pi-search search-icon" />
        <InputText
          v-model="search"
          placeholder="Search SKU, name, notes…"
          size="small"
          class="search-input"
        />
      </div>
    </div>

    <!-- Stats strip -->
    <div class="stats-strip">
      <div v-for="stat in stats" :key="stat.label" class="stat-card">
        <i :class="stat.icon" class="stat-icon" />
        <div class="stat-body">
          <span class="stat-value">{{ stat.value }}</span>
          <span class="stat-label">{{ stat.label }}</span>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="table-wrap">
      <DataTable
        class="movements-table"
        :value="filteredEntries"
        :loading="isLoading"
        striped-rows
        size="small"
        paginator
        paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
        :rows="100"
        :rows-per-page-options="[50, 100, 250]"
        scrollable
        scroll-height="flex"
      >
        <Column field="createdAt" header="Date / Time" style="width:160px" sortable>
          <template #body="{ data }">
            <span class="log-date">{{ formatDate(data.createdAt) }}</span>
          </template>
        </Column>

        <Column field="actionType" header="Action" style="width:130px" sortable>
          <template #body="{ data }">
            <span class="action-badge" :class="`action-${data.actionType}`">
              <i :class="actionIcon(data.actionType)" />
              {{ actionLabel(data.actionType) }}
            </span>
          </template>
        </Column>

        <Column field="productSku" header="Product" sortable>
          <template #body="{ data }">
            <div class="product-cell">
              <span class="product-sku">{{ data.productSku ?? '—' }}</span>
              <span class="product-name">{{ data.productName ?? '' }}</span>
            </div>
          </template>
        </Column>

        <Column field="quantityDelta" header="Qty Change" style="width:100px; text-align:right" sortable>
          <template #body="{ data }">
            <span class="qty-delta" :class="data.quantityDelta > 0 ? 'qty-pos' : 'qty-neg'">
              {{ data.quantityDelta > 0 ? '+' : '' }}{{ data.quantityDelta }}
            </span>
          </template>
        </Column>

        <Column field="notes" header="Details" style="min-width:200px">
          <template #body="{ data }">
            <div class="notes-cell">
              <span v-if="data.referenceType" class="ref-badge" :class="`ref-${data.referenceType}`">
                {{ data.referenceType }}
              </span>
              <span class="notes-text">{{ data.notes ?? '—' }}</span>
            </div>
          </template>
        </Column>

        <template #empty>
          <div class="empty-state">
            <i class="pi pi-history empty-icon" />
            <p>No stock movements found</p>
          </div>
        </template>
      </DataTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getWarehouseLedger, type LedgerActionType } from '@/api/warehouses'

const props = defineProps<{ warehouseId: string }>()

const activeAction = ref<LedgerActionType | undefined>(undefined)
const search       = ref('')

const { data, isLoading } = useQuery({
  queryKey: computed(() => ['warehouse-ledger', props.warehouseId, activeAction.value, search.value]),
  queryFn:  () => getWarehouseLedger(props.warehouseId, {
    actionType: activeAction.value,
    q:          search.value.trim() || undefined,
    limit:      500,
  }),
  staleTime: 30_000,
  enabled:   computed(() => !!props.warehouseId),
})

const entries       = computed(() => data.value ?? [])
const filteredEntries = computed(() => entries.value)

// ── Stats ─────────────────────────────────────────────────────────────────────
const stats = computed(() => {
  const l = entries.value
  return [
    { icon: 'pi pi-list',           label: 'Total Events',   value: l.length },
    { icon: 'pi pi-download',       label: 'Units Received', value: l.filter(x => x.actionType === 'receive').reduce((s, x) => s + x.quantityDelta, 0) },
    { icon: 'pi pi-shopping-cart',  label: 'Units Sold',     value: l.filter(x => x.actionType === 'sale').reduce((s, x) => s + Math.abs(x.quantityDelta), 0) },
    { icon: 'pi pi-arrows-h',       label: 'Transfers',      value: l.filter(x => x.actionType === 'transfer_in' || x.actionType === 'transfer_out').length },
    { icon: 'pi pi-pencil',         label: 'Adjustments',    value: l.filter(x => x.actionType === 'adjustment').length },
  ]
})

// ── Helpers ───────────────────────────────────────────────────────────────────
const actionOptions: { label: string; value: LedgerActionType }[] = [
  { label: 'Receive',       value: 'receive'       },
  { label: 'Sale',          value: 'sale'          },
  { label: 'Transfer In',   value: 'transfer_in'   },
  { label: 'Transfer Out',  value: 'transfer_out'  },
  { label: 'Adjustment',    value: 'adjustment'    },
  { label: 'Return',        value: 'return'        },
]

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function actionLabel(type: LedgerActionType): string {
  const map: Record<LedgerActionType, string> = {
    receive: 'Receive', sale: 'Sale', transfer_in: 'Transfer In',
    transfer_out: 'Transfer Out', adjustment: 'Adjustment', return: 'Return',
  }
  return map[type] ?? type
}

function actionIcon(type: LedgerActionType): string {
  const map: Record<LedgerActionType, string> = {
    receive:      'pi pi-download',
    sale:         'pi pi-shopping-cart',
    transfer_in:  'pi pi-arrow-down',
    transfer_out: 'pi pi-arrow-up',
    adjustment:   'pi pi-pencil',
    return:       'pi pi-refresh',
  }
  return map[type] ?? 'pi pi-circle'
}
</script>

<style scoped>
.movements-tab {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

/* ── Filter bar ── */
.filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  padding: 10px 14px;
  flex-shrink: 0;
}

.action-select { min-width: 170px; }

.search-wrap {
  flex: 1;
  min-width: 200px;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 10px;
  color: var(--p-text-muted-color);
  pointer-events: none;
  z-index: 1;
  font-size: 13px;
}

.search-input {
  width: 100%;
  padding-left: 2rem !important;
}

/* ── Stats strip ── */
.stats-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  flex-shrink: 0;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  padding: 8px 14px;
  flex: 1;
  min-width: 110px;
}

.stat-icon  { font-size: 16px; color: var(--p-primary-color); flex-shrink: 0; }
.stat-body  { display: flex; flex-direction: column; }
.stat-value { font-size: 18px; font-weight: 700; line-height: 1.2; }
.stat-label { font-size: 10px; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; }

/* ── Table ── */
.table-wrap {
  flex: 1;
  min-height: 0;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

:deep(.movements-table .p-datatable-tbody td),
:deep(.movements-table .p-datatable-thead th) { padding: 6px 8px; }
:deep(.movements-table .p-paginator)           { padding: 6px 8px; }

.log-date {
  font-size: 12px;
  color: var(--p-text-muted-color);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.action-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 5px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}
.action-receive      { background: #f0fdf4; color: #15803d; }
.action-sale         { background: #eff6ff; color: #1d4ed8; }
.action-transfer_in  { background: #ecfeff; color: #0e7490; }
.action-transfer_out { background: #fff7ed; color: #c2410c; }
.action-adjustment   { background: #f5f3ff; color: #6d28d9; }
.action-return       { background: #f8fafc; color: #475569; }

.product-cell   { display: flex; flex-direction: column; gap: 1px; }
.product-sku    { font-family: monospace; font-size: 12px; font-weight: 700; color: var(--p-primary-color); }
.product-name   { font-size: 12px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }

.qty-delta { font-size: 14px; font-weight: 800; font-variant-numeric: tabular-nums; }
.qty-pos   { color: #16a34a; }
.qty-neg   { color: #dc2626; }

.notes-cell { display: flex; align-items: center; gap: 7px; }
.ref-badge  { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; white-space: nowrap; flex-shrink: 0; }
.ref-sale     { background: #eff6ff; color: #1d4ed8; }
.ref-transfer { background: #ecfeff; color: #0e7490; }
.notes-text { font-size: 12px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; color: var(--p-text-muted-color); }
.empty-icon  { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }

/* ── Mobile ── */
@media (max-width: 768px) {
  .movements-tab { gap: 8px; }

  .filter-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 8px 10px;
  }
  .action-select { min-width: 0; }
  .search-wrap   { min-width: 0; grid-column: 1 / -1; }

  .stats-strip {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .stat-card  { min-width: 0; padding: 6px 8px; gap: 6px; }
  .stat-icon  { font-size: 13px; }
  .stat-value { font-size: 14px; }
  .stat-label { font-size: 9px; }

  .product-name { max-width: 140px; }

  :deep(.movements-table .p-datatable-tbody td),
  :deep(.movements-table .p-datatable-thead th) { padding: 5px 6px; font-size: 12px; }
}
</style>
