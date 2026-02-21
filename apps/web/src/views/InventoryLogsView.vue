<template>
  <div class="logs-view">
    <div class="view-header">
      <div class="header-left">
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
        :value="filteredLogs"
        :loading="isLoading"
        striped-rows
        size="small"
        paginator
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
              <span class="product-sku">{{ data.productSku }}</span>
              <span class="product-name">{{ data.productName }}</span>
            </div>
          </template>
        </Column>

        <Column field="warehouseName" header="Warehouse" style="width: 160px" sortable>
          <template #body="{ data }">
            <span class="warehouse-name">{{ data.warehouseName ?? '—' }}</span>
          </template>
        </Column>

        <Column field="quantityDelta" header="Qty Change" style="width: 100px; text-align:right" sortable>
          <template #body="{ data }">
            <span class="qty-delta" :class="data.quantityDelta > 0 ? 'qty-pos' : 'qty-neg'">
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
import { useQuery } from '@tanstack/vue-query'
import { apiClient } from '@/api/client'
import { getWarehouses } from '@/api/warehouses'
import LogFilterBar  from '@/components/logs/LogFilterBar.vue'
import LogStatsStrip from '@/components/logs/LogStatsStrip.vue'

type ActionType = 'receive' | 'transfer_in' | 'transfer_out' | 'sale' | 'return' | 'adjustment'

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
  warehouseId:   string
  warehouseName: string | null
}

const activeAction    = ref<ActionType | undefined>(undefined)
const activeWarehouse = ref<string | undefined>(undefined)
const search          = ref('')

const { data: logsData, isLoading } = useQuery({
  queryKey: ['inventory-logs'],
  queryFn:  () => apiClient.get<LogEntry[]>('/inventory/logs', { params: { limit: 500 } }).then(r => r.data),
  staleTime: 30_000,
})

const { data: warehousesData } = useQuery({ queryKey: ['warehouses'], queryFn: getWarehouses })
const warehouseOptions = computed(() => warehousesData.value ?? [])
const logs             = computed(() => logsData.value ?? [])

const filteredLogs = computed(() => {
  let list = logs.value
  if (activeAction.value)    list = list.filter(l => l.actionType  === activeAction.value)
  if (activeWarehouse.value) list = list.filter(l => l.warehouseId === activeWarehouse.value)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter(l =>
    l.productSku?.toLowerCase().includes(q) ||
    l.productName?.toLowerCase().includes(q) ||
    l.notes?.toLowerCase().includes(q),
  )
  return list
})

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function actionLabel(type: ActionType): string {
  const map: Record<ActionType, string> = { receive: 'Receive', sale: 'Sale', transfer_in: 'Transfer In', transfer_out: 'Transfer Out', adjustment: 'Adjustment', return: 'Return' }
  return map[type] ?? type
}

function actionIcon(type: ActionType): string {
  const map: Record<ActionType, string> = { receive: 'pi pi-download', sale: 'pi pi-shopping-cart', transfer_in: 'pi pi-arrow-down', transfer_out: 'pi pi-arrow-up', adjustment: 'pi pi-pencil', return: 'pi pi-refresh' }
  return map[type] ?? 'pi pi-circle'
}
</script>

<style scoped>
.logs-view {
  display: flex; flex-direction: column; height: 100%; padding: 24px; gap: 14px;
}

.view-header { display: flex; align-items: center; justify-content: space-between; }
.header-left { display: flex; align-items: center; gap: 14px; }
.header-icon { font-size: 26px; color: var(--p-primary-color); }
.view-title  { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.table-card {
  flex: 1; background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px; overflow: hidden;
  display: flex; flex-direction: column; min-height: 0;
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
</style>
