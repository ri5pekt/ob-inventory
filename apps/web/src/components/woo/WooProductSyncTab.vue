<template>
  <div class="tab-body">
    <!-- Toolbar -->
    <div class="sync-toolbar">
      <div class="sync-toolbar-left">
        <Button
          label="Run Comparison"
          icon="pi pi-refresh"
          :loading="syncLoading"
          :disabled="!store?.url || !store?.hasToken"
          @click="runSyncPreview"
        />
        <span v-if="!store?.url || !store?.hasToken" class="field-hint">
          Configure connection first.
        </span>
        <span v-if="syncPreview" class="field-hint">
          {{ syncPreview.meta.obTotal }} OB SKUs · {{ syncPreview.meta.wooTotal }} Woo SKUs
        </span>
      </div>

      <div class="sync-toolbar-right">
        <div v-if="syncPreview" class="sync-filter-chips">
          <button
            v-for="f in filterOptions"
            :key="f.value"
            class="chip"
            :class="{ 'chip-active': syncFilter === f.value }"
            @click="syncFilter = f.value"
          >
            <span class="chip-dot" :class="`dot-${f.value}`"></span>
            {{ f.label }}
            <span class="chip-count">{{ f.count }}</span>
          </button>
        </div>

        <Button
          v-if="syncPreview"
          label="Export CSV"
          icon="pi pi-download"
          severity="secondary"
          outlined
          size="small"
          :loading="exporting"
          @click="exportAllCSV"
        />
      </div>
    </div>

    <!-- Error -->
    <div v-if="syncError" class="error-banner">
      <i class="pi pi-exclamation-circle" />
      {{ syncError }}
    </div>

    <!-- Summary cards -->
    <div v-if="syncPreview" class="summary-row">
      <div v-for="s in summaryCards" :key="s.label" class="summary-card" :class="`card-${s.type}`">
        <span class="summary-num">{{ s.value }}</span>
        <span class="summary-label">{{ s.label }}</span>
      </div>
    </div>

    <!-- Results table -->
    <div v-if="syncPreview" class="sync-table-wrap">
      <DataTable
        :value="filteredItems"
        size="small"
        striped-rows
        paginator
        :rows="50"
        :rows-per-page-options="[25, 50, 100]"
        scrollable
        scroll-height="calc(100vh - 420px)"
      >
        <template #empty>
          <div class="table-empty"><i class="pi pi-inbox" /> No items for this filter</div>
        </template>

        <Column field="sku" header="SKU" sortable style="min-width: 170px">
          <template #body="{ data }">
            <span class="sku-mono">{{ data.sku }}</span>
          </template>
        </Column>

        <Column header="Product Name" sortable sort-field="obName" style="min-width: 200px">
          <template #body="{ data }">
            <div class="name-cell">
              <span class="name-main">{{ data.obName ?? data.wooName ?? '—' }}</span>
              <span v-if="data.wooAttrs" class="name-attrs">{{ data.wooAttrs }}</span>
            </div>
          </template>
        </Column>

        <Column header="Type" style="width: 80px">
          <template #body="{ data }">
            <span class="type-badge" :class="`type-${data.wooType ?? 'ob'}`">
              {{ data.wooType ?? '—' }}
            </span>
          </template>
        </Column>

        <Column field="obQty" header="OB Qty" sortable style="width: 90px">
          <template #body="{ data }">
            <span v-if="data.obQty !== null" class="qty-val">{{ data.obQty }}</span>
            <span v-else class="muted">—</span>
          </template>
        </Column>

        <Column field="wooQty" header="Woo Qty" sortable style="width: 90px">
          <template #body="{ data }">
            <span v-if="data.wooQty !== null" class="qty-val">{{ data.wooQty }}</span>
            <span v-else class="muted">—</span>
          </template>
        </Column>

        <Column header="Diff" style="width: 70px">
          <template #body="{ data }">
            <span
              v-if="data.obQty !== null && data.wooQty !== null"
              class="diff-val"
              :class="data.obQty - data.wooQty === 0 ? 'diff-zero' : data.obQty - data.wooQty > 0 ? 'diff-pos' : 'diff-neg'"
            >
              {{ data.obQty - data.wooQty > 0 ? '+' : '' }}{{ data.obQty - data.wooQty }}
            </span>
            <span v-else class="muted">—</span>
          </template>
        </Column>

        <Column field="status" header="Status" sortable style="width: 130px">
          <template #body="{ data }">
            <span class="status-badge" :class="`status-${data.status}`">
              {{ statusLabel(data.status) }}
            </span>
          </template>
        </Column>

        <Column header="Edit" style="width: 56px; text-align: center">
          <template #body="{ data }">
            <a
              v-if="data.wooId && store?.url"
              :href="wooEditUrl(data)"
              target="_blank"
              rel="noopener noreferrer"
              class="woo-edit-link"
              :title="data.wooParentId ? 'Edit parent product in WooCommerce' : 'Edit in WooCommerce'"
            >
              <i class="pi pi-external-link"></i>
            </a>
            <span v-else class="muted">—</span>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- Empty state before first run -->
    <div v-if="!syncPreview && !syncLoading && !syncError" class="sync-empty">
      <i class="pi pi-arrows-h sync-empty-icon"></i>
      <p class="sync-empty-title">Ready to compare</p>
      <p class="sync-empty-sub">Click "Run Comparison" to load products from both systems and match them by SKU.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { getSyncPreview } from '@/api/stores'
import type { Store, SyncPreview, SyncStatus } from '@/api/stores'
import { useSyncExport } from '@/composables/useSyncExport'

const props = defineProps<{
  store: Store | null
}>()

const syncPreview = ref<SyncPreview | null>(null)
const syncLoading = ref(false)
const syncError   = ref('')
const syncFilter  = ref<SyncStatus | 'all'>('all')

const { exporting, exportAllCSV } = useSyncExport(
  () => props.store?.url,
  () => syncPreview.value?.items,
)

async function runSyncPreview() {
  if (!props.store) return
  syncLoading.value = true
  syncError.value   = ''
  syncPreview.value = null
  syncFilter.value  = 'all'
  try {
    syncPreview.value = await getSyncPreview(props.store.id)
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    syncError.value = msg ?? 'Failed to load comparison data'
  } finally {
    syncLoading.value = false
  }
}

const summaryCards = computed(() => {
  if (!syncPreview.value) return []
  const s = syncPreview.value.summary
  return [
    { label: 'Synced',       value: s.synced,    type: 'synced'    },
    { label: 'Qty Mismatch', value: s.mismatch,  type: 'mismatch'  },
    { label: 'OB Only',      value: s.obOnly,    type: 'ob_only'   },
    { label: 'Woo Only',     value: s.wooOnly,   type: 'woo_only'  },
    { label: 'Not Tracked',  value: s.untracked, type: 'untracked' },
  ]
})

const filterOptions = computed(() => {
  if (!syncPreview.value) return []
  const s = syncPreview.value.summary
  return [
    { label: 'All',         value: 'all'          as const, count: s.total     },
    { label: 'Synced',      value: 'synced'       as const, count: s.synced    },
    { label: 'Mismatch',    value: 'qty_mismatch' as const, count: s.mismatch  },
    { label: 'OB Only',     value: 'ob_only'      as const, count: s.obOnly    },
    { label: 'Woo Only',    value: 'woo_only'     as const, count: s.wooOnly   },
    { label: 'Not Tracked', value: 'untracked'    as const, count: s.untracked },
  ]
})

const filteredItems = computed(() => {
  if (!syncPreview.value) return []
  if (syncFilter.value === 'all') return syncPreview.value.items
  return syncPreview.value.items.filter(i => i.status === syncFilter.value)
})

// ── WooCommerce admin link ───────────────────────────────────────────────────

function wooEditUrl(item: { wooId: number | null; wooParentId: number | null }): string {
  const base   = (props.store?.url ?? '').replace(/\/$/, '')
  const postId = item.wooParentId ?? item.wooId
  return `${base}/wp-admin/post.php?post=${postId}&action=edit`
}

function statusLabel(s: SyncStatus): string {
  return {
    synced: 'Synced', qty_mismatch: 'Mismatch',
    ob_only: 'OB Only', woo_only: 'Woo Only', untracked: 'Not Tracked',
  }[s]
}
</script>

<style scoped>
.tab-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 20px;
}

.field-hint { font-size: 12px; color: #94a3b8; }

.sync-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}

.sync-toolbar-left  { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.sync-toolbar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

.sync-filter-chips { display: flex; gap: 6px; flex-wrap: wrap; }

.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 20px;
  border: 1px solid #e2e8f0;
  background: #f8fafc;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  color: #475569;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.chip:hover { border-color: #0891b2; color: #0891b2; }

.chip-active {
  background: #e0f2fe;
  border-color: #0891b2;
  color: #0369a1;
}

.chip-count {
  background: rgba(0,0,0,0.06);
  border-radius: 10px;
  padding: 0 5px;
  font-size: 11px;
}

.chip-dot { width: 7px; height: 7px; border-radius: 50%; }

.dot-synced      { background: #22c55e; }
.dot-qty_mismatch{ background: #f59e0b; }
.dot-ob_only     { background: #6366f1; }
.dot-woo_only    { background: #ec4899; }
.dot-untracked   { background: #cbd5e1; }
.dot-all         { background: #94a3b8; }

.error-banner {
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 10px 14px;
  color: #b91c1c;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-row { display: flex; gap: 10px; flex-wrap: wrap; }

.summary-card {
  flex: 1;
  min-width: 100px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid #e2e8f0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.summary-num { font-size: 22px; font-weight: 700; line-height: 1; }
.summary-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
}

.card-synced    { background: #f0fdf4; border-color: #bbf7d0; }
.card-synced    .summary-num { color: #15803d; }
.card-mismatch  { background: #fffbeb; border-color: #fde68a; }
.card-mismatch  .summary-num { color: #b45309; }
.card-ob_only   { background: #eef2ff; border-color: #c7d2fe; }
.card-ob_only   .summary-num { color: #4338ca; }
.card-woo_only  { background: #fdf4ff; border-color: #f5d0fe; }
.card-woo_only  .summary-num { color: #9333ea; }
.card-untracked { background: #f8fafc; border-color: #e2e8f0; }
.card-untracked .summary-num { color: #64748b; }

.sync-table-wrap {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  width: 100%;
}

.woo-edit-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #0891b2;
  font-size: 13px;
  padding: 3px;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.woo-edit-link:hover {
  background: #e0f2fe;
  color: #0369a1;
}

.sku-mono { font-family: 'Courier New', monospace; font-size: 12px; color: #334155; }
.name-cell { display: flex; flex-direction: column; gap: 2px; }
.name-main  { font-size: 13px; color: #1e293b; }
.name-attrs { font-size: 11px; color: #94a3b8; }

.type-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #64748b;
}
.type-variation { background: #ede9fe; color: #6d28d9; }
.type-simple    { background: #e0f2fe; color: #0369a1; }

.qty-val { font-weight: 600; color: #1e293b; font-size: 13px; }
.muted   { color: #cbd5e1; }

.diff-val  { font-weight: 700; font-size: 13px; }
.diff-zero { color: #22c55e; }
.diff-pos  { color: #6366f1; }
.diff-neg  { color: #f59e0b; }

.status-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 20px;
}
.status-synced       { background: #dcfce7; color: #15803d; }
.status-qty_mismatch { background: #fef9c3; color: #92400e; }
.status-ob_only      { background: #e0e7ff; color: #3730a3; }
.status-woo_only     { background: #fae8ff; color: #7e22ce; }
.status-untracked    { background: #f1f5f9; color: #64748b; }

.table-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 14px;
  padding: 32px;
  justify-content: center;
}

.sync-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 60px 0;
  gap: 8px;
  color: #94a3b8;
}

.sync-empty-icon  { font-size: 40px; margin-bottom: 8px; color: #cbd5e1; }
.sync-empty-title { font-size: 15px; font-weight: 600; color: #475569; margin: 0; }
.sync-empty-sub   { font-size: 13px; margin: 0; text-align: center; max-width: 380px; }
</style>
