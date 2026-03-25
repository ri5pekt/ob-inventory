<template>
  <div class="cost-summary">
    <div v-if="!stockItems || stockItems.length === 0" class="summary-empty">
      No stock data available.
    </div>
    <template v-else>
      <div v-for="brand in groupedData" :key="brand.name" class="brand-section">
        <div class="brand-header">{{ brand.name }}</div>
        <table class="summary-table">
          <thead>
            <tr>
              <th class="col-cat">Category</th>
              <th class="col-num">Total Qty</th>
              <th class="col-num">Cost / Unit</th>
              <th class="col-num">Total Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="cat in brand.categories" :key="cat.name" class="data-row">
              <td class="col-cat">{{ cat.name }}</td>
              <td class="col-num qty-cell">{{ cat.totalQty.toLocaleString() }}</td>
              <td class="col-num">{{ cat.costPerUnit > 0 ? fmt(cat.costPerUnit) : '—' }}</td>
              <td class="col-num total-cell">{{ cat.totalCost > 0 ? fmt(cat.totalCost) : '—' }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="brand-total-row">
              <td class="col-cat">Total</td>
              <td class="col-num">{{ brand.totalQty.toLocaleString() }}</td>
              <td class="col-num"></td>
              <td class="col-num">{{ fmt(brand.totalCost) }}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="grand-total-bar">
        <span class="grand-label">Grand Total</span>
        <span class="grand-qty">{{ grandTotalQty.toLocaleString() }} units</span>
        <span class="grand-cost">{{ fmt(grandTotalCost) }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { StockItemDTO } from '@ob-inventory/types'

const props = defineProps<{
  stockItems: StockItemDTO[] | undefined
}>()

interface CategoryRow {
  name: string
  totalQty: number
  costPerUnit: number
  totalCost: number
}

interface BrandGroup {
  name: string
  categories: CategoryRow[]
  totalQty: number
  totalCost: number
}

const groupedData = computed((): BrandGroup[] => {
  if (!props.stockItems?.length) return []

  const brandMap = new Map<string, Map<string, { totalQty: number; totalCost: number }>>()

  for (const item of props.stockItems) {
    const brand    = item.brand    ?? '(No Brand)'
    const category = item.category ?? '(No Category)'
    const cost     = parseFloat(item.costPrice ?? '0') || 0
    const qty      = item.quantity ?? 0

    if (!brandMap.has(brand)) brandMap.set(brand, new Map())
    const catMap = brandMap.get(brand)!

    if (!catMap.has(category)) catMap.set(category, { totalQty: 0, totalCost: 0 })
    const entry = catMap.get(category)!
    entry.totalQty  += qty
    entry.totalCost += qty * cost
  }

  return [...brandMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([brandName, catMap]) => {
      const categories: CategoryRow[] = [...catMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([catName, d]) => ({
          name:        catName,
          totalQty:    d.totalQty,
          costPerUnit: d.totalQty > 0 ? d.totalCost / d.totalQty : 0,
          totalCost:   d.totalCost,
        }))

      return {
        name:       brandName,
        categories,
        totalQty:   categories.reduce((s, c) => s + c.totalQty,  0),
        totalCost:  categories.reduce((s, c) => s + c.totalCost, 0),
      }
    })
})

const grandTotalQty  = computed(() => groupedData.value.reduce((s, b) => s + b.totalQty,  0))
const grandTotalCost = computed(() => groupedData.value.reduce((s, b) => s + b.totalCost, 0))

function fmt(value: number): string {
  return '₪' + Math.round(value).toLocaleString('en-US')
}
</script>

<style scoped>
.cost-summary {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 4px 0 16px;
}

.summary-empty {
  color: #94a3b8;
  font-size: 14px;
  text-align: center;
  padding: 40px 0;
}

/* ── Brand section ── */
.brand-section {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.brand-header {
  background: #0f172a;
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 9px 16px;
}

/* ── Summary table ── */
.summary-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.summary-table thead tr {
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.summary-table thead th {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  padding: 8px 16px;
}

.col-cat { text-align: left; }
.col-num { text-align: right; }

.data-row {
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.1s;
}
.data-row:last-child { border-bottom: none; }
.data-row:hover { background: #f8fafc; }

.summary-table tbody td {
  padding: 9px 16px;
  color: #1e293b;
}

.qty-cell {
  font-weight: 600;
  color: #0f172a;
}

.total-cell {
  font-weight: 600;
  color: #0369a1;
}

/* ── Brand total footer row ── */
.brand-total-row {
  background: #f1f5f9;
  border-top: 2px solid #e2e8f0;
}

.brand-total-row td {
  padding: 9px 16px;
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
}

/* ── Grand total bar ── */
.grand-total-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 24px;
  background: #0f172a;
  color: #fff;
  border-radius: 10px;
  padding: 12px 20px;
  font-size: 14px;
  font-weight: 700;
}

.grand-label { margin-right: auto; letter-spacing: 0.04em; text-transform: uppercase; font-size: 12px; }
.grand-qty   { color: #94a3b8; font-weight: 500; font-size: 13px; }
.grand-cost  { font-size: 16px; color: #38bdf8; }

/* ── Mobile ── */
@media (max-width: 640px) {
  .summary-table { font-size: 12px; }
  .summary-table thead th,
  .summary-table tbody td,
  .brand-total-row td { padding: 7px 10px; }
  .grand-total-bar { gap: 14px; padding: 10px 14px; }
}
</style>
