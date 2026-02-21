<template>
  <div class="stats-section">
    <!-- Period selector row -->
    <div class="period-bar">
      <span class="period-label">
        <i class="pi pi-calendar" />
        Period:
      </span>
      <div class="period-presets">
        <button
          v-for="p in periodPresets"
          :key="p.value"
          class="period-chip"
          :class="{ active: activePeriod === p.value }"
          @click="activePeriod = p.value"
        >
          {{ p.label }}
        </button>
      </div>

      <Transition name="fade">
        <div v-if="activePeriod === 'custom'" class="custom-range">
          <DatePicker
            v-model="customFrom"
            placeholder="From"
            date-format="dd M yy"
            show-button-bar
            :max-date="customTo ?? new Date()"
            input-style="width:130px; font-size:13px"
          />
          <span class="range-sep">→</span>
          <DatePicker
            v-model="customTo"
            placeholder="To"
            date-format="dd M yy"
            show-button-bar
            :min-date="customFrom ?? undefined"
            input-style="width:130px; font-size:13px"
          />
        </div>
      </Transition>

      <span class="period-desc">{{ periodDescription }}</span>
    </div>

    <!-- Stat cards -->
    <div class="stats-cards">
      <div class="stat-card stat-total">
        <div class="stat-top">
          <span class="stat-label">Total</span>
          <i class="pi pi-chart-bar stat-icon" />
        </div>
        <span class="stat-count">{{ sales.length }}</span>
        <span class="stat-revenue">{{ formatRevenue(totalRevenue(sales)) }}</span>
      </div>
      <div class="stat-card stat-woo">
        <div class="stat-top">
          <span class="stat-label">WooCommerce</span>
          <i class="pi pi-globe stat-icon" />
        </div>
        <span class="stat-count">{{ byType('woocommerce').length }}</span>
        <span class="stat-revenue">{{ formatRevenue(totalRevenue(byType('woocommerce'))) }}</span>
      </div>
      <div class="stat-card stat-direct">
        <div class="stat-top">
          <span class="stat-label">Direct</span>
          <i class="pi pi-user stat-icon" />
        </div>
        <span class="stat-count">{{ byType('direct').length }}</span>
        <span class="stat-revenue">{{ formatRevenue(totalRevenue(byType('direct'))) }}</span>
      </div>
      <div class="stat-card stat-partner">
        <div class="stat-top">
          <span class="stat-label">Partner</span>
          <i class="pi pi-building stat-icon" />
        </div>
        <span class="stat-count">{{ byType('partner').length }}</span>
        <span class="stat-revenue">{{ formatRevenue(totalRevenue(byType('partner'))) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { Sale, SaleType } from '@/api/sales'

const props = defineProps<{ sales: Sale[] }>()

type PeriodPreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

const activePeriod = ref<PeriodPreset>('month')
const customFrom   = ref<Date | null>(null)
const customTo     = ref<Date | null>(null)

const periodPresets: { value: PeriodPreset; label: string }[] = [
  { value: 'today',   label: 'Today' },
  { value: 'week',    label: 'This Week' },
  { value: 'month',   label: 'This Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'year',    label: 'This Year' },
  { value: 'custom',  label: 'Custom' },
]

function startOf(unit: 'day' | 'week' | 'month' | 'quarter' | 'year'): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (unit === 'day')     return d
  if (unit === 'week')    { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d }
  if (unit === 'month')   { d.setDate(1); return d }
  if (unit === 'quarter') { d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1); return d }
  if (unit === 'year')    { d.setMonth(0, 1); return d }
  return d
}

const dateRange = computed<{ from: Date; to: Date } | null>(() => {
  const now = new Date()
  if (activePeriod.value === 'today')   return { from: startOf('day'),     to: now }
  if (activePeriod.value === 'week')    return { from: startOf('week'),    to: now }
  if (activePeriod.value === 'month')   return { from: startOf('month'),   to: now }
  if (activePeriod.value === 'quarter') return { from: startOf('quarter'), to: now }
  if (activePeriod.value === 'year')    return { from: startOf('year'),    to: now }
  if (activePeriod.value === 'custom' && customFrom.value) {
    const to = customTo.value ? new Date(customTo.value) : now
    to.setHours(23, 59, 59, 999)
    return { from: customFrom.value, to }
  }
  return null
})

const periodDescription = computed(() => {
  const r = dateRange.value
  if (!r) return ''
  const fmt = (d: Date) => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return `${fmt(r.from)} – ${fmt(r.to)}`
})

const emit = defineEmits<{
  (e: 'dateRangeChange', range: { from: string; to: string } | null): void
}>()

watch(dateRange, (r) => {
  emit('dateRangeChange', r ? { from: r.from.toISOString(), to: r.to.toISOString() } : null)
}, { immediate: true })

watch([activePeriod, customFrom, customTo], () => {
  const r = dateRange.value
  emit('dateRangeChange', r ? { from: r.from.toISOString(), to: r.to.toISOString() } : null)
})

function byType(type: SaleType) {
  return props.sales.filter(s => s.saleType === type)
}

function totalRevenue(list: Sale[]) {
  return list.reduce((sum, s) => sum + (s.totalPrice ? parseFloat(s.totalPrice) : 0), 0)
}

function formatRevenue(amount: number) {
  if (amount === 0) return '—'
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(amount)
}
</script>

<style scoped>
.stats-section {
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.period-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.period-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  display: flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.period-presets { display: flex; gap: 4px; flex-wrap: wrap; }

.period-chip {
  padding: 4px 12px;
  border-radius: 16px;
  border: 1px solid var(--p-content-border-color);
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  cursor: pointer;
  transition: all 0.13s;
}

.period-chip:hover { border-color: var(--p-primary-color); color: var(--p-primary-color); }

.period-chip.active {
  background: var(--p-primary-color);
  border-color: var(--p-primary-color);
  color: #fff;
}

.custom-range { display: flex; align-items: center; gap: 8px; }
.range-sep { font-size: 13px; color: var(--p-text-muted-color); }

.period-desc {
  font-size: 11px;
  color: var(--p-text-muted-color);
  margin-left: 4px;
  white-space: nowrap;
}

.fade-enter-active, .fade-leave-active { transition: opacity 0.15s, transform 0.15s; }
.fade-enter-from, .fade-leave-to       { opacity: 0; transform: translateX(-6px); }

.stats-cards { display: flex; gap: 12px; }

.stat-card {
  flex: 1;
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid transparent;
}

.stat-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-icon { font-size: 14px; opacity: 0.5; }

.stat-count {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.stat-revenue {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  opacity: 0.75;
}

.stat-total   { background: #f8fafc; border-color: #e2e8f0; color: #0f172a; }
.stat-woo     { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
.stat-direct  { background: #f0fdf4; border-color: #bbf7d0; color: #15803d; }
.stat-partner { background: #fff7ed; border-color: #fed7aa; color: #c2410c; }
</style>
