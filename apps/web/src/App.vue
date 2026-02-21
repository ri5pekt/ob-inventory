<template>
  <RouterView />
  <Toast position="top-right" />
</template>

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
