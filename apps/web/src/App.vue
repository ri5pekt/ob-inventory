<template>
  <RouterView />
  <Toast position="top-right" class="app-toast" />
</template>

<style>
@media (max-width: 640px) {
  .app-toast.p-toast {
    left: 50% !important;
    right: auto !important;
    transform: translateX(-50%) !important;
    width: calc(100vw - 24px) !important;
    max-width: 400px !important;
  }
}
</style>

<script setup lang="ts">
import { onMounted } from 'vue'
import { RouterView } from 'vue-router'
import Toast from 'primevue/toast'
import { useAuthStore } from '@/stores/auth'
import { useShopStore } from '@/stores/shop'

const auth = useAuthStore()
const shop = useShopStore()

onMounted(async () => {
  if (auth.accessToken && !auth.user) {
    await auth.fetchMe()
  }
  if (auth.accessToken) {
    await shop.loadStores()
  }
})
</script>
