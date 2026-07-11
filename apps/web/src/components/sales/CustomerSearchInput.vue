<template>
  <div class="customer-search-section">
    <label>Lookup Existing Customer</label>

    <!-- Selected customer chip -->
    <div v-if="selectedCustomer" class="selected-chip">
      <i class="pi pi-id-card chip-icon" />
      <div class="chip-info">
        <span class="chip-name">{{ selectedCustomer.name }}</span>
        <span v-if="selectedCustomer.email" class="chip-email">{{ selectedCustomer.email }}</span>
      </div>
      <button class="chip-clear" title="Remove customer" @click="clearSelection">
        <i class="pi pi-times" />
      </button>
    </div>

    <!-- Search input -->
    <div v-else class="search-wrap">
      <InputText
        v-model="searchQuery"
        placeholder="Search by name, email, phone, company…"
        fluid
        autocomplete="off"
        @input="onSearchInput"
        @focus="onFocus"
        @blur="onBlur"
      />
      <i v-if="searching" class="pi pi-spin pi-spinner search-spinner" />
    </div>

    <Transition name="fade-drop">
      <div v-if="showResults" class="search-results">
        <div v-if="results.length > 0">
          <div
            v-for="c in results"
            :key="c.id"
            class="result-row"
            @mousedown.prevent="pick(c)"
          >
            <div class="result-main">
              <span class="result-name">{{ c.name }}</span>
              <span v-if="c.company" class="result-company">{{ c.company }}</span>
            </div>
            <div class="result-meta">
              <span v-if="c.email" class="result-email">{{ c.email }}</span>
              <span v-if="c.phone" class="result-phone">{{ c.phone }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="searchQuery.length >= 1 && !searching" class="search-empty">
          No customers found matching "{{ searchQuery }}"
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import InputText from 'primevue/inputtext'
import { getCustomers, type Customer } from '@/api/customers'

const emit = defineEmits<{
  'select': [customer: Customer]
  'clear': []
}>()

const searchQuery      = ref('')
const results          = ref<Customer[]>([])
const searching        = ref(false)
const showResults      = ref(false)
const selectedCustomer = ref<Customer | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function onFocus() {
  if (results.value.length > 0) showResults.value = true
}

function onSearchInput() {
  if (debounceTimer) clearTimeout(debounceTimer)
  const q = searchQuery.value.trim()
  if (!q) { results.value = []; showResults.value = false; return }

  showResults.value = true
  searching.value = true
  debounceTimer = setTimeout(async () => {
    try {
      results.value = await getCustomers({ q, limit: 10 })
      showResults.value = results.value.length > 0 || q.length >= 1
    } catch {
      results.value = []
    } finally {
      searching.value = false
    }
  }, 250)
}

function onBlur() {
  setTimeout(() => { showResults.value = false }, 200)
}

function pick(c: Customer) {
  selectedCustomer.value = c
  searchQuery.value = ''
  results.value = []
  showResults.value = false
  emit('select', c)
}

function clearSelection() {
  selectedCustomer.value = null
  searchQuery.value = ''
  results.value = []
  emit('clear')
}

function reset() {
  selectedCustomer.value = null
  searchQuery.value = ''
  results.value = []
  showResults.value = false
}

defineExpose({ reset })
</script>

<style scoped>
.customer-search-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

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
  pointer-events: none;
}

/* Selected chip */
.selected-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--p-primary-50, #eff6ff);
  border: 1px solid var(--p-primary-200, #bfdbfe);
  border-radius: 8px;
  min-height: 38px;
}

.chip-icon { color: var(--p-primary-color); font-size: 15px; flex-shrink: 0; }

.chip-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.chip-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-text-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-email {
  font-size: 12px;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-clear {
  margin-left: auto;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 4px;
  color: var(--p-text-muted-color);
  font-size: 11px;
  flex-shrink: 0;
  transition: color 0.15s, background 0.15s;
  line-height: 1;
}
.chip-clear:hover { color: var(--p-red-500); background: var(--p-red-50, #fef2f2); }

/* Dropdown results */
.search-results {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
  max-height: 220px;
  overflow-y: auto;
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
.result-row:last-child { border-bottom: none; }
.result-row:hover { background: var(--p-surface-hover); }

.result-main { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.result-name  { font-size: 13px; font-weight: 600; color: var(--p-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.result-company { font-size: 11px; color: var(--p-text-muted-color); white-space: nowrap; }

.result-meta  { display: flex; gap: 10px; flex-shrink: 0; }
.result-email { font-size: 11px; color: var(--p-primary-color); }
.result-phone { font-size: 11px; color: var(--p-text-muted-color); }

.search-empty {
  padding: 14px 16px;
  font-size: 13px;
  color: var(--p-text-muted-color);
  text-align: center;
}

.fade-drop-enter-active, .fade-drop-leave-active { transition: opacity 0.15s; }
.fade-drop-enter-from,   .fade-drop-leave-to     { opacity: 0; }
</style>
