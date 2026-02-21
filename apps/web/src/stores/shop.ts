import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { getStores, type Store } from '@/api/stores'

export const useShopStore = defineStore('shop', () => {
  const stores = ref<Store[]>([])
  const currentStoreId = ref<string | null>(localStorage.getItem('currentStoreId'))

  const currentStore = computed(() =>
    stores.value.find(s => s.id === currentStoreId.value) ?? stores.value[0] ?? null,
  )

  async function loadStores() {
    try {
      stores.value = await getStores()
      if (!currentStoreId.value && stores.value.length > 0) {
        selectStore(stores.value[0].id)
      }
    } catch {
      // silently ignore if not authenticated yet
    }
  }

  function selectStore(id: string) {
    currentStoreId.value = id
    localStorage.setItem('currentStoreId', id)
  }

  return { stores, currentStore, currentStoreId, loadStores, selectStore }
})
