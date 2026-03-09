<template>
  <div class="search-section" :class="{ disabled: !warehouseId }">
    <label>Add Products</label>
    <div class="search-wrap">
      <InputText
        v-model="searchQuery"
        :placeholder="warehouseId ? 'Search by SKU, name, brand, category…' : 'Select a source warehouse first'"
        :disabled="!warehouseId"
        fluid
        autocomplete="off"
        @input="onSearchInput"
        @focus="onFocus"
        @blur="onBlur"
      />
      <i v-if="searching" class="pi pi-spin pi-spinner search-spinner" />
    </div>

    <Transition name="fade-drop">
      <div v-if="showResults && searchResults.length > 0" class="search-results">
        <div
          v-for="result in searchResults"
          :key="result.productId"
          class="search-result-row"
          :class="{ 'already-added': addedIds.includes(result.productId) }"
          @mousedown.prevent="pick(result)"
        >
          <div class="result-main">
            <span class="result-sku">{{ result.sku }}</span>
            <span class="result-name">{{ result.name }}</span>
            <div v-if="result.model || result.size || result.color" class="result-attrs">
              <span v-if="result.model" class="result-attr">{{ result.model }}</span>
              <span v-if="result.size"  class="result-attr">{{ result.size }}</span>
              <span v-if="result.color" class="result-attr">{{ result.color }}</span>
            </div>
          </div>
          <div class="result-meta">
            <span v-if="result.brandName" class="result-brand">{{ result.brandName }}</span>
            <span class="result-stock" :class="{ 'stock-low': result.availableQty <= 3 }">
              {{ result.availableQty }} in stock
            </span>
            <i v-if="addedIds.includes(result.productId)" class="pi pi-check already-check" />
          </div>
        </div>
      </div>
      <div
        v-else-if="showResults && searchQuery.length >= 1 && !searching && searchResults.length === 0"
        class="search-empty"
      >
        No products found in this warehouse matching "{{ searchQuery }}"
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { searchProducts, type ProductSearchResult } from '@/api/transfers'

const props = defineProps<{
  warehouseId: string | null
  addedIds:    string[]
}>()

const emit = defineEmits<{
  (e: 'select', result: ProductSearchResult): void
}>()

const searchQuery    = ref('')
const searchResults  = ref<ProductSearchResult[]>([])
const defaultResults = ref<ProductSearchResult[]>([])
const searching      = ref(false)
const showResults    = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onFocus() {
  if (!searchQuery.value.trim()) {
    searchResults.value = defaultResults.value
  }
  showResults.value = true
}

function onSearchInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  showResults.value = true

  if (!searchQuery.value.trim()) {
    searchResults.value = defaultResults.value
    searching.value = false
    return
  }

  searching.value = true
  debounceTimer = setTimeout(async () => {
    if (!props.warehouseId) { searching.value = false; return }
    try {
      searchResults.value = await searchProducts(searchQuery.value, props.warehouseId)
    } catch {
      searchResults.value = []
    } finally {
      searching.value = false
    }
  }, 280)
}

function onBlur() {
  setTimeout(() => { showResults.value = false }, 200)
}

function pick(result: ProductSearchResult) {
  if (props.addedIds.includes(result.productId)) return
  emit('select', result)
  searchQuery.value   = ''
  searchResults.value = defaultResults.value
  showResults.value   = false
}

watch(() => props.warehouseId, async (id) => {
  searchQuery.value    = ''
  searchResults.value  = []
  defaultResults.value = []
  if (!id) return
  searching.value = true
  try {
    const results        = await searchProducts('', id, 20)
    defaultResults.value = results
    searchResults.value  = results
  } finally {
    searching.value = false
  }
})
</script>

<style scoped>
.search-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* no relative positioning — dropdown renders in flow, not floating */
}

.search-section.disabled label,
.search-section.disabled .search-wrap { opacity: 0.5; }

label {
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--p-text-muted-color);
}

.search-wrap { position: relative; }

.search-spinner {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-text-muted-color);
  font-size: 14px;
}

.search-results,
.search-empty {
  /* In-flow: expands the dialog body instead of floating over the footer */
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.10);
  max-height: 260px;
  overflow-y: auto;
}

.search-empty {
  padding: 16px;
  font-size: 13px;
  color: var(--p-text-muted-color);
  text-align: center;
}

.search-result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--p-content-border-color);
  transition: background 0.12s;
}
.search-result-row:last-child { border-bottom: none; }
.search-result-row:hover { background: var(--p-surface-hover); }
.search-result-row.already-added { opacity: 0.5; cursor: default; pointer-events: none; }

.result-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; flex-wrap: wrap; }

.result-attrs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

.result-sku {
  font-family: monospace;
  font-size: 12px;
  font-weight: 700;
  color: var(--p-primary-color);
  white-space: nowrap;
  flex-shrink: 0;
}

.result-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-attr {
  font-size: 11px;
  background: var(--p-surface-100);
  color: var(--p-text-muted-color);
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
  flex-shrink: 0;
}

.result-meta { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.result-brand { font-size: 11px; color: var(--p-text-muted-color); }

.result-stock { font-size: 12px; font-weight: 600; color: var(--p-green-600); white-space: nowrap; }
.result-stock.stock-low { color: var(--p-orange-500); }

.already-check { color: var(--p-green-500); font-size: 13px; }

.fade-drop-enter-active, .fade-drop-leave-active { transition: opacity 0.15s; }
.fade-drop-enter-from,   .fade-drop-leave-to     { opacity: 0; }

@media (max-width: 768px) {
  .search-results,
  .search-empty {
    max-height: 220px;
    max-width: 100%;
    overflow-x: hidden;
  }

  .search-result-row {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 10px 12px;
    min-width: 0;
  }

  .result-main {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    min-width: 0;
    width: 100%;
  }

  .result-sku {
    font-size: 11px;
    flex-shrink: 0;
  }

  .result-name {
    font-size: 12px;
    white-space: normal;
    word-wrap: break-word;
    overflow-wrap: break-word;
    max-width: 100%;
    line-height: 1.35;
  }

  .result-attrs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .result-attr {
    font-size: 10px;
    padding: 2px 5px;
  }

  .result-meta {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    min-width: 0;
  }

  .result-brand {
    font-size: 10px;
  }

  .result-stock {
    font-size: 11px;
  }

  .search-empty {
    padding: 12px;
    font-size: 12px;
  }
}
</style>
