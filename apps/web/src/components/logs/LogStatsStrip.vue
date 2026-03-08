<template>
  <div class="stats-strip">
    <div v-for="stat in stats" :key="stat.label" class="stat-card">
      <i :class="stat.icon" class="stat-icon" />
      <div class="stat-body">
        <span class="stat-value">{{ stat.value }}</span>
        <span class="stat-label">{{ stat.label }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface LogEntry {
  actionType:    string
  quantityDelta: number
}

const props = defineProps<{ logs: LogEntry[] }>()

const stats = computed(() => {
  const l = props.logs
  const received  = l.filter(x => x.actionType === 'receive').reduce((s, x) => s + x.quantityDelta, 0)
  const sold      = l.filter(x => x.actionType === 'sale').reduce((s, x) => s + Math.abs(x.quantityDelta), 0)
  const transfers = l.filter(x => x.actionType === 'transfer_in' || x.actionType === 'transfer_out').length
  const adjusts   = l.filter(x => x.actionType === 'adjustment').length

  return [
    { icon: 'pi pi-list',          label: 'Total Events',  value: l.length },
    { icon: 'pi pi-download',      label: 'Units Received', value: received },
    { icon: 'pi pi-shopping-cart', label: 'Units Sold',    value: sold },
    { icon: 'pi pi-arrows-h',      label: 'Transfers',     value: transfers },
    { icon: 'pi pi-pencil',        label: 'Adjustments',   value: adjusts },
  ]
})
</script>

<style scoped>
.stats-strip {
  display: flex; gap: 10px; flex-wrap: wrap;
}
.stat-card {
  display: flex; align-items: center; gap: 10px;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px; padding: 10px 16px;
  flex: 1; min-width: 130px;
}
.stat-icon  { font-size: 18px; color: var(--p-primary-color); flex-shrink: 0; }
.stat-body  { display: flex; flex-direction: column; }
.stat-value { font-size: 20px; font-weight: 700; line-height: 1.2; }
.stat-label { font-size: 11px; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.04em; }
</style>
