<template>
  <div class="app-shell">

    <!-- Mobile backdrop -->
    <Transition name="backdrop">
      <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false" />
    </Transition>

    <!-- Sidebar -->
    <aside class="sidebar" :class="{ 'sidebar-open': sidebarOpen }">
      <div class="sidebar-brand">
        <RouterLink :to="mainWarehouseLink" class="brand-link" @click="sidebarOpen = false">
          <div class="brand-icon"><i class="pi pi-box"></i></div>
          <span class="brand-name">OB Inventory</span>
        </RouterLink>
        <!-- Close button (mobile only) -->
        <button class="sidebar-close" @click="sidebarOpen = false">
          <i class="pi pi-times"></i>
        </button>
      </div>

      <nav class="sidebar-nav">
        <template v-for="item in navItems" :key="item.label">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="nav-item"
            :class="{ active: route.path === item.to || (item.to !== '/inventory' && route.path.startsWith(item.to)) }"
            @click="sidebarOpen = false"
          >
            <i :class="`pi ${item.icon}`"></i>
            <span>{{ item.label }}</span>
          </RouterLink>

          <template v-else>
            <button
              class="nav-item nav-group"
              :class="{ active: item.matchPath && route.path.startsWith(item.matchPath) }"
              @click="toggleGroup(item.label)"
            >
              <i :class="`pi ${item.icon}`"></i>
              <span>{{ item.label }}</span>
              <i class="pi pi-chevron-down nav-chevron" :class="{ rotated: openGroups.has(item.label) }"></i>
            </button>
            <Transition name="subnav">
              <div v-if="openGroups.has(item.label)" class="subnav">
                <RouterLink
                  v-for="child in item.children"
                  :key="child.to"
                  :to="child.to"
                  class="nav-item subnav-item"
                  :class="{ active: route.path === child.to || (child.to !== '/inventory' && route.path.startsWith(child.to)) }"
                  @click="sidebarOpen = false"
                >
                  <i :class="`pi ${child.icon}`"></i>
                  <span>{{ child.label }}</span>
                </RouterLink>
              </div>
            </Transition>
          </template>
        </template>
      </nav>
    </aside>

    <!-- Main area -->
    <div class="main-area">
      <header class="app-header">
        <div class="header-left">
          <!-- Hamburger (mobile only) -->
          <button class="hamburger" @click="sidebarOpen = true" aria-label="Open menu">
            <i class="pi pi-bars"></i>
          </button>
          <span class="page-title">{{ pageTitle }}</span>
        </div>
        <div class="header-right">
          <StoreSelector />
          <div class="header-divider"></div>
          <UserMenu />
        </div>
      </header>

      <main class="page-content">
        <RouterView />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterView, RouterLink, useRoute } from 'vue-router'
import { useQuery } from '@tanstack/vue-query'
import { getWarehouses } from '@/api/warehouses'
import StoreSelector from '@/components/layout/StoreSelector.vue'
import UserMenu from '@/components/layout/UserMenu.vue'

const route       = useRoute()
const sidebarOpen = ref(false)

const { data: warehouseList } = useQuery({ queryKey: ['warehouses'], queryFn: getWarehouses })

const mainWarehouseLink = computed(() => {
  const main = warehouseList.value?.find(w => w.type === 'main')
  return main ? `/inventory/${main.id}` : '/inventory'
})

const openGroups = ref<Set<string>>(new Set(
  route.path.startsWith('/inventory') ? ['Inventory'] :
  route.path.startsWith('/settings')  ? ['Settings']  : [],
))

function toggleGroup(label: string) {
  if (openGroups.value.has(label)) openGroups.value.delete(label)
  else openGroups.value.add(label)
}

interface NavChild { to: string; label: string; icon: string }
interface NavItem  { to?: string; label: string; icon: string; matchPath?: string; children?: NavChild[] }

const navItems = computed((): NavItem[] => [
  {
    label: 'Inventory', icon: 'pi-box', matchPath: '/inventory',
    children: [
      { to: mainWarehouseLink.value, label: 'Main Warehouse', icon: 'pi-home'       },
      { to: '/inventory',            label: 'All Warehouses', icon: 'pi-th-large'   },
      { to: '/inventory/logs',       label: 'Logs',           icon: 'pi-history'    },
    ],
  },
  { to: '/transfers', label: 'Stock Transfers', icon: 'pi-arrow-right-arrow-left' },
  { to: '/sales',     label: 'Sales',           icon: 'pi-shopping-cart' },
  {
    label: 'Settings', icon: 'pi-cog', matchPath: '/settings',
    children: [
      { to: '/settings/parameters',  label: 'Parameters',  icon: 'pi-sliders-h' },
      { to: '/settings/woocommerce', label: 'WooCommerce', icon: 'pi-shop'       },
      { to: '/settings/users',       label: 'Users',       icon: 'pi-users'      },
    ],
  },
])

const pageTitles: Record<string, string> = {
  '/inventory/logs':       'Inventory · Logs',
  '/inventory':            'Inventory',
  '/transfers':            'Stock Transfers',
  '/sales':                'Sales',
  '/settings/parameters':  'Settings · Parameters',
  '/settings/woocommerce': 'Settings · WooCommerce',
  '/settings/users':       'Settings · Users',
}

const pageTitle = computed(() => {
  for (const [path, title] of Object.entries(pageTitles)) {
    if (route.path.startsWith(path)) return title
  }
  if (route.path.startsWith('/inventory/')) return 'Warehouse Stock'
  return 'OB Inventory'
})
</script>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #f1f5f9;
}

/* ── Backdrop (mobile overlay) ── */
.sidebar-backdrop {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 299;
}

.backdrop-enter-active, .backdrop-leave-active { transition: opacity 0.25s; }
.backdrop-enter-from,   .backdrop-leave-to     { opacity: 0; }

/* ── Sidebar ── */
.sidebar {
  width: 240px;
  flex-shrink: 0;
  background: #0f172a;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 300;
}

.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 16px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

.brand-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  flex: 1;
  min-width: 0;
  border-radius: 6px;
  transition: opacity 0.15s;
}
.brand-link:hover { opacity: 0.85; }

.brand-icon {
  width: 34px;
  height: 34px;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 15px;
  flex-shrink: 0;
}

.brand-name { font-size: 15px; font-weight: 600; color: #f8fafc; letter-spacing: 0.01em; flex: 1; }

.sidebar-close {
  display: none;
  background: none;
  border: none;
  color: #64748b;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  line-height: 1;
  transition: color 0.15s;
}
.sidebar-close:hover { color: #e2e8f0; }

.sidebar-nav {
  flex: 1;
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 7px;
  font-size: 14px;
  color: #94a3b8;
  text-decoration: none;
  transition: background 0.15s, color 0.15s;
  border: none;
  background: none;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.nav-item:hover          { background: rgba(255,255,255,0.06); color: #e2e8f0; }
.nav-item.active         { background: rgba(34,211,238,0.12); color: #22d3ee; }
.nav-item .pi            { font-size: 15px; width: 18px; text-align: center; flex-shrink: 0; }
.nav-group               { justify-content: flex-start; }

.nav-chevron {
  font-size: 10px !important;
  margin-left: auto;
  transition: transform 0.2s;
  width: auto !important;
}
.nav-chevron.rotated { transform: rotate(180deg); }

.subnav      { display: flex; flex-direction: column; gap: 1px; }
.subnav-item { padding-left: 34px !important; font-size: 13px !important; }

.subnav-enter-active, .subnav-leave-active { transition: opacity 0.15s, transform 0.15s; }
.subnav-enter-from,   .subnav-leave-to     { opacity: 0; transform: translateY(-4px); }

/* ── Main area ── */
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.app-header {
  height: 56px;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  flex-shrink: 0;
  gap: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.hamburger {
  display: none;
  background: none;
  border: none;
  color: #475569;
  font-size: 18px;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  line-height: 1;
  flex-shrink: 0;
  transition: background 0.15s;
}
.hamburger:hover { background: #f1f5f9; }

.page-title {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.header-right { display: flex; align-items: center; flex-shrink: 0; }

.header-divider { width: 1px; height: 26px; background: #e2e8f0; margin: 0 6px; }

.page-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  -webkit-overflow-scrolling: touch;
}

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  /* Show backdrop element */
  .sidebar-backdrop { display: block; }

  /* Hamburger visible */
  .hamburger { display: flex; }

  /* Close button visible */
  .sidebar-close { display: flex; }

  /* Sidebar off-screen by default */
  .sidebar {
    position: fixed;
    top: 0;
    left: 0;
    height: 100vh;
    width: 260px;
    transform: translateX(-100%);
    transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  }

  /* Slide in when open */
  .sidebar.sidebar-open {
    transform: translateX(0);
    box-shadow: 4px 0 24px rgba(0,0,0,0.25);
  }

  /* Tighter page padding */
  .page-content { padding: 12px; }

  /* Header smaller padding */
  .app-header { padding: 0 12px; height: 52px; }
}

/* ═══════════════════════════════════════════════
   VERY SMALL  ≤ 480px
════════════════════════════════════════════════ */
@media (max-width: 480px) {
  .page-title { font-size: 14px; }
}
</style>
