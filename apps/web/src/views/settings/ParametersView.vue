<template>
  <div class="params-view">
    <div class="params-header">
      <h2 class="params-title">Parameters</h2>
      <p class="params-desc">Manage static parameters (categories, brands) and custom product attributes.</p>
    </div>

    <Tabs v-model:value="activeTab">
      <TabList>
        <Tab value="static"><i class="pi pi-list"></i> Static Parameters</Tab>
        <Tab value="attributes"><i class="pi pi-sliders-h"></i> Custom Attributes</Tab>
      </TabList>

      <TabPanels>
        <TabPanel value="static">
          <div class="tab-panel-pad">
            <StaticParamsTab />
          </div>
        </TabPanel>
        <TabPanel value="attributes">
          <div class="tab-panel-pad">
            <CustomAttributesTab />
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanel from 'primevue/tabpanel'
import TabPanels from 'primevue/tabpanels'
import StaticParamsTab from '@/components/settings/StaticParamsTab.vue'
import CustomAttributesTab from '@/components/settings/CustomAttributesTab.vue'

const activeTab = ref('static')
</script>

<style scoped>
.params-view { display: flex; flex-direction: column; gap: 20px; padding: 0; }
.params-title { font-size: 20px; font-weight: 600; color: #0f172a; margin: 0 0 4px; }
.params-desc  { font-size: 13px; color: #64748b; margin: 0; }

.tab-panel-pad { padding-top: 20px; }

@media (max-width: 768px) {
  .params-view { gap: 14px; }
  .params-title { font-size: 18px; }
  .params-desc { font-size: 12px; }
  .tab-panel-pad { padding-top: 14px; }
}
</style>
