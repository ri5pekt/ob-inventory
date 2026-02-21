<template>
  <div class="woo-view">
    <div class="page-header">
      <div class="page-header-icon">
        <i class="pi pi-shop"></i>
      </div>
      <div>
        <h2 class="page-title">WooCommerce Integration</h2>
        <p class="page-subtitle">Connect your WooCommerce store to sync products and orders.</p>
      </div>
    </div>

    <div v-if="wooStores.length > 1" class="store-selector-bar">
      <label class="field-label">Manage store</label>
      <Select
        v-model="selectedStoreId"
        :options="wooStores"
        option-label="name"
        option-value="id"
        style="min-width: 220px"
      />
    </div>

    <!-- Custom tab bar -->
    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        <i :class="`pi ${t.icon}`"></i>
        {{ t.label }}
      </button>
    </div>

    <!-- Tab panels -->
    <div class="tab-body">
      <WooConnectionTab
        v-if="activeTab === 'connection'"
        :store="currentStore"
        :loading="loadingStore"
        @updated="currentStore = $event"
      />
      <WooProductSyncTab
        v-else-if="activeTab === 'sync'"
        :store="currentStore"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getStores, getStore } from '@/api/stores'
import type { Store } from '@/api/stores'
import WooConnectionTab  from '@/components/woo/WooConnectionTab.vue'
import WooProductSyncTab from '@/components/woo/WooProductSyncTab.vue'

const { data: storesData } = useQuery({ queryKey: ['stores'], queryFn: getStores })
const stores    = computed(() => storesData.value ?? [])
const wooStores = computed(() => stores.value.filter(s => s.platform === 'woocommerce'))

const selectedStoreId = ref<string | null>(null)
const loadingStore    = ref(false)
const currentStore    = ref<Store | null>(null)

const tabs = [
  { key: 'connection', label: 'Connection',    icon: 'pi-link' },
  { key: 'sync',       label: 'Products Sync', icon: 'pi-arrows-h' },
] as const
type TabKey = typeof tabs[number]['key']
const activeTab = ref<TabKey>('connection')

watch(wooStores, (list) => {
  if (!selectedStoreId.value && list.length > 0) selectedStoreId.value = list[0].id
}, { immediate: true })

watch(selectedStoreId, async (id) => {
  if (!id) return
  loadingStore.value = true
  try {
    currentStore.value = await getStore(id)
  } finally {
    loadingStore.value = false
  }
}, { immediate: true })
</script>

<style scoped>
.woo-view {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.page-header { display: flex; align-items: center; gap: 16px; }

.page-header-icon {
  width: 48px; height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  color: #fff; font-size: 22px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.page-title    { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 2px; }
.page-subtitle { font-size: 13px; color: #64748b; margin: 0; }

.store-selector-bar { display: flex; align-items: center; gap: 12px; }
.field-label { font-size: 13px; font-weight: 500; color: #374151; }

/* ── Custom tab bar ── */
.tab-bar {
  display: flex;
  gap: 0;
  border-bottom: 2px solid #e2e8f0;
}

.tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 10px 20px;
  border: none;
  background: none;
  font-size: 13px;
  font-weight: 600;
  color: #64748b;
  cursor: pointer;
  position: relative;
  transition: color 0.15s;
  margin-bottom: -2px;   /* sits on top of the border-bottom */
  border-bottom: 2px solid transparent;
}

.tab-btn:hover { color: #0891b2; }

.tab-btn.active {
  color: #0891b2;
  border-bottom: 2px solid #0891b2;
}

.tab-btn .pi { font-size: 13px; }

/* ── Tab panel body ── */
.tab-body {
  flex: 1;
}
</style>
