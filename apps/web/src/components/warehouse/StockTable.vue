<template>
  <DataTable
    :value="items"
    striped-rows
    size="small"
    paginator
    :rows="50"
    :rows-per-page-options="[25, 50, 100]"
    scrollable
    scroll-height="flex"
  >
    <template #empty>
      <div class="table-empty">
        <i class="pi pi-inbox"></i>
        <span>No stock in this warehouse</span>
      </div>
    </template>

    <!-- Frozen left: edit icon -->
    <Column header="" frozen style="width: 40px; text-align: center; padding: 0 4px">
      <template #body="{ data }">
        <Button
          icon="pi pi-pencil"
          text rounded size="small" severity="secondary"
          class="edit-btn"
          @click="$emit('edit', data)"
        />
      </template>
    </Column>

    <!-- Frozen left: thumbnail -->
    <Column header="" frozen style="width: 44px; padding: 3px 4px; text-align: center">
      <template #body="{ data }">
        <img v-if="data.image" :src="data.image" class="row-thumb" alt="" />
        <span v-else class="row-thumb-empty"><i class="pi pi-image"></i></span>
      </template>
    </Column>

    <Column field="sku" header="SKU" frozen sortable style="width: 140px">
      <template #body="{ data }"><span class="sku-text">{{ data.sku }}</span></template>
    </Column>

    <Column field="name" header="Name" frozen sortable style="width: 160px">
      <template #body="{ data }"><span class="col-name">{{ data.name ?? '—' }}</span></template>
    </Column>

    <!-- Scrollable middle -->
    <Column field="brand" header="Brand" sortable style="width: 90px">
      <template #body="{ data }"><span class="tag tag-brand">{{ data.brand ?? '—' }}</span></template>
    </Column>

    <Column field="category" header="Category" sortable style="width: 110px">
      <template #body="{ data }"><span class="muted-sm">{{ data.category ?? '—' }}</span></template>
    </Column>

    <Column field="model" header="Model" sortable style="width: 120px">
      <template #body="{ data }"><span class="muted-sm">{{ data.model ?? '—' }}</span></template>
    </Column>

    <Column field="size" header="Size" sortable style="width: 70px">
      <template #body="{ data }">
        <span v-if="data.size" class="tag tag-size">{{ data.size }}</span>
        <span v-else class="muted">—</span>
      </template>
    </Column>

    <Column field="color" header="Color" sortable style="width: 90px">
      <template #body="{ data }">
        <span v-if="data.color" class="tag tag-color">{{ data.color }}</span>
        <span v-else class="muted">—</span>
      </template>
    </Column>

    <Column field="unit" header="Unit" style="width: 70px">
      <template #body="{ data }"><span class="muted-sm">{{ data.unit ?? '—' }}</span></template>
    </Column>

    <Column field="dateAdded" header="Date Added" sortable style="width: 110px">
      <template #body="{ data }"><span class="muted-sm">{{ formatDate(data.dateAdded) }}</span></template>
    </Column>

    <Column field="boxNumber" header="Box" sortable style="width: 72px">
      <template #body="{ data }">
        <span v-if="data.boxNumber" class="box-badge">{{ data.boxNumber }}</span>
        <span v-else class="muted">—</span>
      </template>
    </Column>

    <!-- Frozen right: qty -->
    <Column field="quantity" header="Qty" frozen align-frozen="right" sortable style="width: 60px; text-align: right">
      <template #body="{ data }">
        <span class="qty" :class="{ 'qty-low': data.quantity > 0 && data.quantity <= 3, 'qty-zero': data.quantity === 0 }">
          {{ data.quantity }}
        </span>
      </template>
    </Column>
  </DataTable>
</template>

<script setup lang="ts">
import type { StockItemDTO } from '@ob-inventory/types'

defineProps<{ items: StockItemDTO[] }>()
defineEmits<{ edit: [item: StockItemDTO] }>()

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }
  catch { return '—' }
}
</script>

<style scoped>
/* Force the inner table to be wide enough to trigger horizontal scroll */
:deep(.p-datatable-table) {
  min-width: 1126px; /* 40(edit)+44(img)+140+160+90+110+120+70+90+70+110+72+60 */
}

/* Frozen columns must have an opaque background */
:deep(.p-datatable-tbody .p-frozen-column),
:deep(.p-datatable-thead .p-frozen-column) { background: inherit; }
:deep(tr.p-row-odd .p-frozen-column) { background: var(--p-datatable-row-striped-background, #fafafa); }

.table-empty { display: flex; align-items: center; gap: 8px; color: #94a3b8; font-size: 14px; padding: 32px; justify-content: center; }

.row-thumb { width: 36px; height: 36px; object-fit: cover; border-radius: 6px; display: block; border: 1px solid #e2e8f0; }
.row-thumb-empty { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 6px; background: #f1f5f9; color: #cbd5e1; font-size: 14px; }

:deep(.edit-btn) { width: 28px !important; height: 28px !important; padding: 0 !important; color: #94a3b8 !important; }
:deep(.edit-btn:hover) { color: #0891b2 !important; background: #e0f2fe !important; }

.sku-text { font-family: 'Courier New', monospace; font-size: 12px; color: #334155; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-name { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #64748b; font-size: 13px; }

.box-badge { background: #f8fafc; border: 1px solid #e2e8f0; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace; color: #475569; }

.tag { display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.tag-brand { background: #ede9fe; color: #6d28d9; }
.tag-size  { background: #ecfdf5; color: #065f46; }
.tag-color { background: #fef3c7; color: #92400e; font-family: monospace; }

.muted    { color: #94a3b8; font-size: 13px; }
.muted-sm { color: #64748b; font-size: 13px; }
.qty      { font-weight: 700; font-size: 14px; color: #0f172a; }
.qty-low  { color: #d97706; }
.qty-zero { color: #dc2626; }

@media (max-width: 768px) {
  :deep(.p-datatable-tbody td),
  :deep(.p-datatable-thead th) { padding: 6px 8px; font-size: 12px; }
}
</style>
