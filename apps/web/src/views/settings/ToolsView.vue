<template>
  <div class="tools-view">
    <div class="page-header">
      <div class="page-header-icon">
        <i class="pi pi-wrench" />
      </div>
      <div>
        <h2 class="page-title">Tools</h2>
        <p class="page-subtitle">Data maintenance utilities and bulk operations.</p>
      </div>
    </div>

    <!-- Tab bar (same style as WooCommerce view) -->
    <div class="tab-bar">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="tab-btn"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        <i :class="`pi ${t.icon}`" />
        {{ t.label }}
      </button>
    </div>

    <div class="tab-body">
      <ToolsCustomersTab v-if="activeTab === 'customers'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import ToolsCustomersTab from '@/components/tools/ToolsCustomersTab.vue'

const tabs = [
  { key: 'customers', label: 'Customers', icon: 'pi-id-card' },
]

const activeTab = ref('customers')
</script>

<style scoped>
.tools-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
  max-width: 860px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.page-header-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--p-primary-50, #eff6ff);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 22px;
  color: var(--p-primary-color);
}

.page-title    { margin: 0 0 4px; font-size: 20px; font-weight: 700; }
.page-subtitle { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }

/* ── Tab bar — identical to WooCommerceView ── */
.tab-bar {
  display: flex;
  gap: 4px;
  border-bottom: 2px solid var(--p-content-border-color);
  padding-bottom: 0;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--p-text-muted-color);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  border-radius: 6px 6px 0 0;
  transition: color 0.15s, border-color 0.15s;
}

.tab-btn:hover { color: var(--p-text-color); background: var(--p-surface-hover); }
.tab-btn.active { color: var(--p-primary-color); border-bottom-color: var(--p-primary-color); font-weight: 600; }

.tab-body { padding-top: 4px; }
</style>
