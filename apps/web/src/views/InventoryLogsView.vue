<template>
  <div class="logs-view">
    <div class="view-header">
      <div class="header-left">
        <Button icon="pi pi-arrow-left" text rounded size="small" @click="router.push('/inventory')" />
        <i class="pi pi-history header-icon" />
        <div>
          <h2 class="view-title">Inventory Logs</h2>
          <span class="view-subtitle">Every stock change, fully auditable</span>
        </div>
      </div>
    </div>

    <LogFilterBar
      :model-value="activeAction"
      :warehouse="activeWarehouse"
      :search="search"
      :warehouses="warehouseOptions"
      @update:model-value="activeAction = $event"
      @update:warehouse="activeWarehouse = $event"
      @update:search="search = $event"
    />

    <LogStatsStrip :logs="logs" />

    <div class="table-card">
      <DataTable
        class="logs-datatable"
        :value="filteredLogs"
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
        <Column field="createdAt" header="Date / Time" style="width: 170px" sortable>
          <template #body="{ data }">
            <span class="log-date">{{ formatDate(data.createdAt) }}</span>
          </template>
        </Column>

        <Column field="actionType" header="Action" style="width: 130px" sortable>
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

        <Column field="warehouseName" header="Warehouse / Store" style="width: 160px" sortable>
          <template #body="{ data }">
            <span class="warehouse-name">{{ data.warehouseName ?? '—' }}</span>
          </template>
        </Column>

        <Column field="quantityDelta" header="Qty Change" style="width: 100px; text-align:right" sortable>
          <template #body="{ data }">
            <span v-if="isWooType(data.actionType)" class="qty-delta qty-neutral">
              {{ data.quantityDelta > 0 ? data.quantityDelta : '—' }}
            </span>
            <span v-else class="qty-delta" :class="data.quantityDelta > 0 ? 'qty-pos' : 'qty-neg'">
              {{ data.quantityDelta > 0 ? '+' : '' }}{{ data.quantityDelta }}
            </span>
          </template>
        </Column>

        <Column field="notes" header="Details" style="min-width: 200px">
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
            <p>No log entries match the current filters</p>
          </div>
        </template>
      </DataTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import Button from 'primevue/button'
import { apiClient } from '@/api/client'
import { getWarehouses } from '@/api/warehouses'
import LogFilterBar  from '@/components/logs/LogFilterBar.vue'
import LogStatsStrip from '@/components/logs/LogStatsStrip.vue'

const router = useRouter()

type ActionType = 'receive' | 'transfer_in' | 'transfer_out' | 'sale' | 'return' | 'adjustment' | 'woo_push_success' | 'woo_push_failed'

interface LogEntry {
  id:            string
  createdAt:     string
  actionType:    ActionType
  quantityDelta: number
  referenceType: string | null
  referenceId:   string | null
  notes:         string | null
  productId:     string
  productSku:    string | null
  productName:   string | null
  warehouseId:   string | null
  warehouseName: string | null
}

const activeAction    = ref<ActionType | undefined>(undefined)
const activeWarehouse = ref<string | undefined>(undefined)
const search          = ref('')

const { data: logsData, isLoading } = useQuery({
  queryKey: ['inventory-logs', activeAction, activeWarehouse, search],
  queryFn:  () => apiClient.get<LogEntry[]>('/inventory/logs', {
    params: {
      limit: 500,
      actionType: activeAction.value,
      warehouseId: activeWarehouse.value,
      q: search.value.trim() || undefined,
    },
  }).then(r => r.data),
  staleTime: 30_000,
})

const { data: warehousesData } = useQuery({ queryKey: ['warehouses'], queryFn: getWarehouses })
const warehouseOptions = computed(() => warehousesData.value ?? [])
const logs             = computed(() => logsData.value ?? [])
const filteredLogs     = computed(() => logs.value)

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isWooType(type: ActionType): boolean {
  return type === 'woo_push_success' || type === 'woo_push_failed'
}

function actionLabel(type: ActionType): string {
  const map: Record<ActionType, string> = {
    receive: 'Receive', sale: 'Sale', transfer_in: 'Transfer In', transfer_out: 'Transfer Out',
    adjustment: 'Adjustment', return: 'Return',
    woo_push_success: 'Woo Push ✓', woo_push_failed: 'Woo Push ✗',
  }
  return map[type] ?? type
}

function actionIcon(type: ActionType): string {
  const map: Record<ActionType, string> = {
    receive: 'pi pi-download', sale: 'pi pi-shopping-cart', transfer_in: 'pi pi-arrow-down',
    transfer_out: 'pi pi-arrow-up', adjustment: 'pi pi-pencil', return: 'pi pi-refresh',
    woo_push_success: 'pi pi-check-circle', woo_push_failed: 'pi pi-times-circle',
  }
  return map[type] ?? 'pi pi-circle'
}
</script>

<style scoped>
.logs-view {
  display: flex; flex-direction: column; height: 100%; padding: 0; gap: 12px;
}

.view-header { display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.header-icon { font-size: 26px; color: var(--p-primary-color); }
.view-title  { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.table-card {
  flex: 1; background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column; min-height: 0;
}

:deep(.logs-datatable .p-datatable-tbody td),
:deep(.logs-datatable .p-datatable-thead th) {
  padding: 6px 8px;
}

:deep(.logs-datatable .p-paginator) {
  padding: 6px 8px;
}

.log-date { font-size: 12px; color: var(--p-text-muted-color); font-variant-numeric: tabular-nums; white-space: nowrap; }

.action-badge {
  display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 700;
  padding: 3px 9px; border-radius: 5px; text-transform: uppercase; letter-spacing: 0.03em; white-space: nowrap;
}
.action-receive      { background: #f0fdf4; color: #15803d; }
.action-sale         { background: #eff6ff; color: #1d4ed8; }
.action-transfer_in  { background: #ecfeff; color: #0e7490; }
.action-transfer_out { background: #fff7ed; color: #c2410c; }
.action-adjustment   { background: #f5f3ff; color: #6d28d9; }
.action-return       { background: #f8fafc; color: #475569; }
.action-woo_push_success { background: #f0fdf4; color: #15803d; }
.action-woo_push_failed  { background: #fef2f2; color: #dc2626; }

.qty-neutral { color: var(--p-text-muted-color); }

.product-cell { display: flex; flex-direction: column; gap: 1px; }
.product-sku  { font-family: monospace; font-size: 12px; font-weight: 700; color: var(--p-primary-color); }
.product-name { font-size: 12px; color: var(--p-text-muted-color); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 240px; }

.warehouse-name { font-size: 13px; font-weight: 500; }

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

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .logs-view { gap: 10px; }

  .header-left .header-icon { display: none; }

  .view-title { font-size: 18px; }
  .view-subtitle { font-size: 12px; }

  .table-card { border-radius: 10px; }

  .product-name { max-width: 140px; }

  .empty-state { padding: 32px 12px; }
  .empty-icon { font-size: 32px; }

  :deep(.logs-datatable .p-datatable-tbody td),
  :deep(.logs-datatable .p-datatable-thead th) {
    padding: 6px 8px;
    font-size: 12px;
  }

  :deep(.logs-datatable .p-paginator) {
    padding: 6px 8px;
    gap: 4px;
  }

  :deep(.logs-datatable .p-paginator .p-paginator-pages .p-button) {
    min-width: 28px;
    height: 28px;
    padding: 0 4px;
  }
}
</style>
