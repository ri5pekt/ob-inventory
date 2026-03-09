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
  const ledger = l.filter(x => x.actionType !== 'woo_push_success' && x.actionType !== 'woo_push_failed')
  const received  = ledger.filter(x => x.actionType === 'receive').reduce((s, x) => s + x.quantityDelta, 0)
  const sold      = ledger.filter(x => x.actionType === 'sale').reduce((s, x) => s + Math.abs(x.quantityDelta), 0)
  const transfers = ledger.filter(x => x.actionType === 'transfer_in' || x.actionType === 'transfer_out').length
  const adjusts   = ledger.filter(x => x.actionType === 'adjustment').length
  const wooSyncs  = l.filter(x => x.actionType === 'woo_push_success' || x.actionType === 'woo_push_failed').length

  return [
    { icon: 'pi pi-list',          label: 'Total Events',   value: l.length },
    { icon: 'pi pi-download',      label: 'Units Received', value: received },
    { icon: 'pi pi-shopping-cart', label: 'Units Sold',    value: sold },
    { icon: 'pi pi-arrows-h',      label: 'Transfers',      value: transfers },
    { icon: 'pi pi-pencil',        label: 'Adjustments',    value: adjusts },
    { icon: 'pi pi-cloud-upload',  label: 'Woo Syncs',      value: wooSyncs },
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

@media (max-width: 768px) {
  .stats-strip {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .stat-card {
    min-width: 0;
    padding: 6px 8px;
    gap: 6px;
  }

  .stat-icon { font-size: 14px; }
  .stat-value { font-size: 15px; }
  .stat-label { font-size: 10px; }
}
</style>
