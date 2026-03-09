<template>
  <div v-if="items.length > 0" class="items-section">
    <div class="items-header">
      <span class="items-title">Items to Transfer</span>
      <span class="items-count">{{ items.length }} product{{ items.length !== 1 ? 's' : '' }}</span>
    </div>

    <div class="items-list">
      <div v-for="(item, idx) in items" :key="item.productId" class="item-row">
        <div class="item-info">
          <span class="item-sku">{{ item.sku }}</span>
          <span class="item-name">{{ item.name }}</span>
          <span v-if="item.model || item.size || item.color" class="item-attrs">
            {{ [item.model, item.size, item.color].filter(Boolean).join(' · ') }}
          </span>
        </div>
        <div class="item-controls">
          <span class="item-available">/ {{ item.availableQty }}</span>
          <div class="qty-stepper">
            <button class="qty-btn" :disabled="item.quantity <= 1" @click="item.quantity = Math.max(1, item.quantity - 1)">−</button>
            <input
              v-model.number="item.quantity"
              type="number"
              class="qty-input"
              :min="1"
              :max="item.availableQty"
              @blur="$emit('clamp', idx)"
            />
            <button class="qty-btn" :disabled="item.quantity >= item.availableQty" @click="item.quantity = Math.min(item.availableQty, item.quantity + 1)">+</button>
          </div>
          <Button
            icon="pi pi-times"
            text rounded
            severity="secondary"
            size="small"
            @click="$emit('remove', idx)"
          />
        </div>
      </div>
    </div>
  </div>

  <div v-else class="items-empty">
    <i class="pi pi-inbox" />
    <span>No products added yet — use the search above</span>
  </div>
</template>

<script setup lang="ts">
import type { ProductSearchResult } from '@/api/transfers'

export interface TransferItemRow extends ProductSearchResult {
  quantity: number
}

defineProps<{ items: TransferItemRow[] }>()

defineEmits<{
  (e: 'remove', idx: number): void
  (e: 'clamp',  idx: number): void
}>()
</script>

<style scoped>
.items-section {
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px;
  overflow: hidden;
}

.items-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--p-surface-50);
  border-bottom: 1px solid var(--p-content-border-color);
}

.items-title {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.items-count { font-size: 12px; font-weight: 600; color: var(--p-primary-color); }

.items-list { display: flex; flex-direction: column; }

.item-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  gap: 10px;
  border-bottom: 1px solid var(--p-content-border-color);
  transition: background 0.1s;
  overflow: hidden;
}
.item-row:last-child { border-bottom: none; }
.item-row:hover      { background: var(--p-surface-50); }

.item-info { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }

.item-sku {
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--p-primary-color);
  white-space: nowrap;
  flex-shrink: 0;
}

.item-name {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-attrs { font-size: 11px; color: var(--p-text-muted-color); white-space: nowrap; flex-shrink: 0; }
.item-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.item-available { font-size: 11px; color: var(--p-text-muted-color); white-space: nowrap; }

.qty-stepper {
  display: flex;
  align-items: center;
  border: 1px solid var(--p-content-border-color, #e2e8f0);
  border-radius: 6px;
  overflow: hidden;
  height: 30px;
}

.qty-btn {
  width: 26px;
  height: 100%;
  border: none;
  background: var(--p-surface-50, #f8fafc);
  color: var(--p-text-muted-color, #64748b);
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
  flex-shrink: 0;
  line-height: 1;
  padding: 0;
}
.qty-btn:hover:not(:disabled) { background: var(--p-surface-100, #f1f5f9); color: var(--p-primary-color); }
.qty-btn:disabled { opacity: 0.35; cursor: default; }

.qty-input {
  width: 38px;
  height: 100%;
  border: none;
  border-left: 1px solid var(--p-content-border-color, #e2e8f0);
  border-right: 1px solid var(--p-content-border-color, #e2e8f0);
  text-align: center;
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color, #0f172a);
  background: #fff;
  outline: none;
  -moz-appearance: textfield;
}
.qty-input::-webkit-inner-spin-button,
.qty-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

.items-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 20px;
  border: 1px dashed var(--p-content-border-color);
  border-radius: 10px;
  color: var(--p-text-muted-color);
  font-size: 13px;
}
.items-empty .pi { font-size: 18px; opacity: 0.5; }

@media (max-width: 768px) {
  .items-header { padding: 8px 12px; }
  .items-title,
  .items-count { font-size: 11px; }

  .item-row {
    flex-wrap: wrap;
    padding: 10px 12px;
    gap: 10px;
  }

  .item-info {
    flex: 1 1 100%;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .item-sku { font-size: 11px; }
  .item-name { font-size: 12px; white-space: normal; word-break: break-word; }
  .item-attrs { font-size: 10px; white-space: normal; }

  .item-controls {
    flex: 1 1 100%;
    justify-content: space-between;
    align-items: center;
  }

  .qty-stepper { height: 28px; }
  .qty-btn { width: 24px; }
  .qty-input { width: 34px; font-size: 12px; }

  .items-empty { padding: 14px 12px; font-size: 12px; }
}
</style>
