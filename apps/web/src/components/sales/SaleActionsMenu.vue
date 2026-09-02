<template>
  <Popover ref="popover" append-to="body" class="sale-actions-popover">
    <div class="actions-list">
      <button class="action-row" :disabled="!sale" @click="pick('pdf')">
        <i class="pi pi-file-pdf action-icon" />
        <span class="action-label">Download PDF</span>
      </button>

      <button class="action-row" :disabled="!sale" @click="pick('cardcom')">
        <i class="pi pi-file action-icon" />
        <span class="action-label">Cardcom Documents</span>
      </button>

      <button class="action-row" :disabled="!sale || !sale.totalPrice" @click="pick('charge')">
        <i class="pi pi-credit-card action-icon" />
        <span class="action-label">Charge Card</span>
      </button>

      <div class="action-divider" />

      <button
        class="action-row action-warn"
        :disabled="!sale || sale.status !== 'completed'"
        @click="pick('convert')"
      >
        <i class="pi pi-truck action-icon" />
        <span class="action-label">Convert to Stock Transfer</span>
      </button>
    </div>
  </Popover>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Popover from 'primevue/popover'
import type { SaleDetail } from '@/api/sales'

defineProps<{
  sale: SaleDetail | null
}>()

const emit = defineEmits<{
  (e: 'pick', action: 'pdf' | 'cardcom' | 'charge' | 'convert'): void
}>()

const popover = ref<InstanceType<typeof Popover> | null>(null)

function toggle(event: Event) {
  popover.value?.toggle(event)
}

function pick(action: 'pdf' | 'cardcom' | 'charge' | 'convert') {
  popover.value?.hide()
  emit('pick', action)
}

defineExpose({ toggle })
</script>

<style scoped>
.actions-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 220px;
  padding: 4px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  border: none;
  background: transparent;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s;
}

.action-row:hover:not(:disabled) {
  background: var(--p-surface-100, #f1f5f9);
}

.action-row:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-icon {
  font-size: 14px;
  width: 18px;
  text-align: center;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.action-warn .action-icon {
  color: var(--p-orange-500, #f59e0b);
}

.action-label { flex: 1; }

.action-divider {
  height: 1px;
  background: var(--p-content-border-color);
  margin: 4px 6px;
}
</style>
