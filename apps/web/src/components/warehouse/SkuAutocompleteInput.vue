<template>
  <div class="sku-autocomplete">
    <div class="input-wrap">
      <InputText
        :value="modelValue"
        placeholder="e.g. BGSA-RDBK-8"
        :invalid="invalid"
        class="w-full"
        autocomplete="off"
        @input="onInput"
        @focus="onFocus"
        @blur="onBlur"
      />
      <i v-if="searching" class="pi pi-spin pi-spinner search-spinner" />
    </div>

    <Transition name="fade-drop">
      <div v-if="showResults && results.length > 0" class="results-list">
        <div
          v-for="r in results"
          :key="r.productId"
          class="result-row"
          @mousedown.prevent="pick(r)"
        >
          <div class="result-main">
            <span class="result-sku">{{ r.sku }}</span>
            <span class="result-name">{{ r.wooTitle || r.name }}</span>
            <div v-if="r.model || r.sizeLabel || r.colorLabel" class="result-attrs">
              <span v-if="r.model"      class="result-attr">{{ r.model }}</span>
              <span v-if="r.sizeLabel"  class="result-attr">{{ r.sizeLabel }}</span>
              <span v-if="r.colorLabel" class="result-attr">{{ r.colorLabel }}</span>
            </div>
          </div>
          <div class="result-meta">
            <span v-if="r.brandName"    class="result-brand">{{ r.brandName }}</span>
            <span v-if="r.categoryName" class="result-cat">{{ r.categoryName }}</span>
          </div>
        </div>
      </div>
      <div
        v-else-if="showResults && (modelValue?.length ?? 0) >= 1 && !searching && results.length === 0"
        class="results-empty"
      >
        No existing products match "{{ modelValue }}" — you can still add it as new.
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import InputText from 'primevue/inputtext'
import { searchCatalog, type CatalogSearchResult } from '@/api/transfers'

defineProps<{
  modelValue: string
  invalid?:   boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: string): void
  (e: 'select', result: CatalogSearchResult): void
}>()

const results     = ref<CatalogSearchResult[]>([])
const searching   = ref(false)
const showResults = ref(false)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onFocus() {
  if (results.value.length > 0) showResults.value = true
}

function onInput(e: Event) {
  const val = (e.target as HTMLInputElement).value
  emit('update:modelValue', val)

  if (debounceTimer) clearTimeout(debounceTimer)

  if (!val.trim()) {
    results.value   = []
    showResults.value = false
    searching.value = false
    return
  }

  showResults.value = true
  searching.value   = true

  debounceTimer = setTimeout(async () => {
    try {
      results.value = await searchCatalog(val.trim())
    } catch {
      results.value = []
    } finally {
      searching.value = false
    }
  }, 280)
}

function onBlur() {
  setTimeout(() => { showResults.value = false }, 200)
}

function pick(result: CatalogSearchResult) {
  emit('update:modelValue', result.sku)
  emit('select', result)
  results.value     = []
  showResults.value = false
}
</script>

<style scoped>
.sku-autocomplete {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.input-wrap {
  position: relative;
}

.search-spinner {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-text-muted-color);
  font-size: 14px;
  pointer-events: none;
}

.results-list,
.results-empty {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 100;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  max-height: 260px;
  overflow-y: auto;
}

.results-empty {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--p-text-muted-color);
}

.result-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  border-bottom: 1px solid var(--p-content-border-color);
  transition: background 0.12s;
}
.result-row:last-child  { border-bottom: none; }
.result-row:hover       { background: var(--p-surface-hover); }

.result-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

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

.result-attrs {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.result-attr {
  font-size: 11px;
  background: var(--p-surface-100);
  color: var(--p-text-muted-color);
  border-radius: 4px;
  padding: 2px 6px;
  white-space: nowrap;
}

.result-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  flex-shrink: 0;
}

.result-brand {
  font-size: 11px;
  font-weight: 600;
  color: var(--p-text-muted-color);
}

.result-cat {
  font-size: 11px;
  color: var(--p-text-muted-color);
}

.w-full { width: 100%; }

.fade-drop-enter-active,
.fade-drop-leave-active { transition: opacity 0.15s, transform 0.15s; }
.fade-drop-enter-from,
.fade-drop-leave-to     { opacity: 0; transform: translateY(-4px); }
</style>
