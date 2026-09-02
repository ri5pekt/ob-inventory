<template>
  <Dialog
    v-model:visible="visible"
    modal
    header="More Actions"
    :style="{ width: '360px', maxWidth: '96vw' }"
    :breakpoints="{ '480px': 'calc(100vw - 16px)' }"
  >
    <div class="actions-list">
      <button class="action-row" :disabled="!sale" @click="pick('pdf')">
        <i class="pi pi-file-pdf action-icon" />
        <span class="action-label">Download PDF</span>
        <i class="pi pi-chevron-right action-chevron" />
      </button>

      <button class="action-row" :disabled="!sale" @click="pick('cardcom')">
        <i class="pi pi-file action-icon" />
        <span class="action-label">Cardcom Documents</span>
        <i class="pi pi-chevron-right action-chevron" />
      </button>

      <button class="action-row" :disabled="!sale || !sale.totalPrice" @click="pick('charge')">
        <i class="pi pi-credit-card action-icon" />
        <span class="action-label">Charge Card</span>
        <i class="pi pi-chevron-right action-chevron" />
      </button>

      <div class="action-divider" />

      <button
        class="action-row action-warn"
        :disabled="!sale || sale.status !== 'completed'"
        @click="pick('convert')"
      >
        <i class="pi pi-truck action-icon" />
        <span class="action-label">Convert to Stock Transfer</span>
        <i class="pi pi-chevron-right action-chevron" />
      </button>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { SaleDetail } from '@/api/sales'

const props = defineProps<{
  visible: boolean
  sale:    SaleDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'pick', action: 'pdf' | 'cardcom' | 'charge' | 'convert'): void
}>()

const visible = computed({
  get: () => props.visible,
  set: (v: boolean) => emit('update:visible', v),
})

function pick(action: 'pdf' | 'cardcom' | 'charge' | 'convert') {
  visible.value = false
  emit('pick', action)
}
</script>

<style scoped>
.actions-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.action-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  font-size: 14px;
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
  font-size: 16px;
  width: 20px;
  text-align: center;
  color: var(--p-primary-color);
  flex-shrink: 0;
}

.action-warn .action-icon {
  color: var(--p-orange-500, #f59e0b);
}

.action-label { flex: 1; }

.action-chevron {
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.action-divider {
  height: 1px;
  background: var(--p-content-border-color);
  margin: 4px 0;
}
</style>
