<template>
  <div class="filter-bar">
    <Select
      :model-value="modelValue"
      :options="actionOptions"
      option-label="label"
      option-value="value"
      placeholder="All actions"
      show-clear
      append-to="body"
      class="filter-select"
      @update:model-value="$emit('update:modelValue', $event)"
    />
    <Select
      :model-value="warehouse"
      :options="warehouses"
      option-label="name"
      option-value="id"
      placeholder="All warehouses"
      show-clear
      append-to="body"
      class="filter-select"
      @update:model-value="$emit('update:warehouse', $event)"
    />
    <span class="p-input-icon-left search-wrap">
      <i class="pi pi-search" />
      <InputText
        :model-value="search"
        placeholder="Search SKU, name, notes..."
        class="filter-search"
        @update:model-value="$emit('update:search', $event as string)"
      />
    </span>
  </div>
</template>

<script setup lang="ts">
import Select    from 'primevue/select'
import InputText from 'primevue/inputtext'

type ActionType = 'receive' | 'transfer_in' | 'transfer_out' | 'sale' | 'return' | 'adjustment' | 'woo_push_success' | 'woo_push_failed'

defineProps<{
  modelValue?: ActionType
  warehouse?:  string
  search:      string
  warehouses:  { id: string; name: string }[]
}>()

defineEmits<{
  (e: 'update:modelValue', v: ActionType | undefined): void
  (e: 'update:warehouse',  v: string   | undefined): void
  (e: 'update:search',     v: string): void
}>()

const actionOptions: { label: string; value: ActionType }[] = [
  { label: 'Receive',       value: 'receive'         },
  { label: 'Sale',          value: 'sale'            },
  { label: 'Transfer In',   value: 'transfer_in'     },
  { label: 'Transfer Out',  value: 'transfer_out'    },
  { label: 'Adjustment',    value: 'adjustment'      },
  { label: 'Return',        value: 'return'          },
  { label: 'Woo Push ✓',    value: 'woo_push_success' },
  { label: 'Woo Push ✗',    value: 'woo_push_failed'  },
]
</script>

<style scoped>
.filter-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 10px; padding: 12px 16px;
}
.filter-select { min-width: 180px; }
.search-wrap   { flex: 1; min-width: 220px; display: flex; align-items: center; position: relative; }
.search-wrap i { position: absolute; left: 10px; color: var(--p-text-muted-color); pointer-events: none; z-index: 1; }
.filter-search { width: 100%; padding-left: 2rem; }

@media (max-width: 768px) {
  .filter-bar {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 8px 10px;
  }

  .filter-select { min-width: 0; width: 100%; }
  .search-wrap { min-width: 0; grid-column: 1 / -1; }
}
</style>
