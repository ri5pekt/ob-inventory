<template>
  <div class="store-menu" ref="rootRef" @click="open = !open">
    <div class="store-icon"><i class="pi pi-shop"></i></div>
    <div class="store-info">
      <span class="store-name">{{ shop.currentStore?.name ?? 'No store' }}</span>
      <span class="store-platform">{{ shop.currentStore?.platform ?? '' }}</span>
    </div>
    <i class="pi pi-chevron-down chevron" :class="{ rotated: open }"></i>

    <Transition name="dropdown">
      <div v-if="open" class="store-dropdown" @click.stop>
        <div class="dropdown-section-label">Switch store</div>
        <button
          v-for="s in shop.stores"
          :key="s.id"
          class="store-option"
          :class="{ active: s.id === shop.currentStore?.id }"
          @click="selectStore(s)"
        >
          <div class="store-option-info">
            <span class="store-option-name">{{ s.name }}</span>
            <span class="store-option-url">{{ s.url }}</span>
          </div>
          <i v-if="s.id === shop.currentStore?.id" class="pi pi-check store-check"></i>
        </button>
        <div class="dropdown-divider"></div>
        <a
          v-if="shop.currentStore?.url"
          :href="shop.currentStore.url"
          target="_blank"
          rel="noopener"
          class="dropdown-item store-link"
          @click.stop
        >
          <i class="pi pi-external-link"></i>
          <span>Open store website</span>
        </a>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useShopStore } from '@/stores/shop'
import type { Store } from '@/api/stores'

const shop  = useShopStore()
const open  = ref(false)
const rootRef = ref<HTMLElement | null>(null)

function selectStore(s: Store) {
  shop.selectStore(s.id)
  open.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))
</script>

<style scoped>
.store-menu {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 5px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}
.store-menu:hover { background: #f1f5f9; }

.store-icon {
  width: 30px;
  height: 30px;
  border-radius: 7px;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 13px;
  flex-shrink: 0;
}

.store-info { display: flex; flex-direction: column; line-height: 1.2; }
.store-name { font-size: 13px; font-weight: 600; color: #0f172a; }
.store-platform { font-size: 10px; color: #94a3b8; text-transform: capitalize; }

.chevron { font-size: 11px; color: #94a3b8; transition: transform 0.2s; }
.chevron.rotated { transform: rotate(180deg); }

@media (max-width: 600px) {
  .store-info,
  .chevron { display: none; }
  .store-menu { padding: 5px; }
}

.store-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  width: 260px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10);
  z-index: 200;
  overflow: hidden;
}

.dropdown-section-label {
  padding: 8px 14px 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
}

.store-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 14px;
  border: none;
  background: none;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s;
}
.store-option:hover  { background: #f8fafc; }
.store-option.active { background: #f0f9ff; }

.store-option-info { display: flex; flex-direction: column; gap: 1px; }
.store-option-name { font-size: 13px; font-weight: 600; color: #0f172a; }
.store-option-url  { font-size: 11px; color: #94a3b8; }
.store-check       { font-size: 12px; color: #0891b2; }

.dropdown-divider  { height: 1px; background: #f1f5f9; }

.dropdown-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 11px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: #475569;
  text-align: left;
  transition: background 0.12s, color 0.12s;
}
.dropdown-item:hover { background: #f8fafc; color: #0891b2; }

.store-link { text-decoration: none; }

.dropdown-enter-active, .dropdown-leave-active { transition: opacity 0.15s, transform 0.15s; }
.dropdown-enter-from,   .dropdown-leave-to     { opacity: 0; transform: translateY(-6px); }
</style>
