import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/AppLayout.vue'),
    children: [
      { path: '', redirect: '/inventory' },
      { path: 'inventory', name: 'inventory', component: () => import('@/views/InventoryView.vue') },
      { path: 'inventory/logs', name: 'inventory-logs', component: () => import('@/views/InventoryLogsView.vue') },
      { path: 'inventory/:id', name: 'warehouse-stock', component: () => import('@/views/WarehouseStockView.vue') },
      { path: 'transfers', name: 'transfers', component: () => import('@/views/TransfersView.vue') },
      { path: 'sales', name: 'sales', component: () => import('@/views/SalesView.vue') },
      { path: 'settings', redirect: '/settings/parameters' },
      { path: 'settings/parameters',   name: 'settings-parameters',   component: () => import('@/views/settings/ParametersView.vue') },
      { path: 'settings/woocommerce',  name: 'settings-woocommerce',  component: () => import('@/views/settings/WooCommerceView.vue') },
      { path: 'settings/users',        name: 'settings-users',        component: () => import('@/views/settings/UsersView.vue') },
    ],
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  if (!to.meta.public && !auth.isAuthenticated) return '/login'
  if (to.path === '/login' && auth.isAuthenticated) return '/inventory'
})
