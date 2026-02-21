<template>
  <div class="settings-shell">
    <div class="settings-header">
      <div>
        <h2 class="settings-title">{{ title }}</h2>
        <p v-if="description" class="settings-desc">{{ description }}</p>
      </div>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
</script>

<style scoped>
.settings-shell {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.settings-title {
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
  margin: 0 0 4px;
}

.settings-desc {
  font-size: 13px;
  color: #64748b;
  margin: 0;
}
</style>
