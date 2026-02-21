<template>
  <div class="user-menu" ref="rootRef" @click="open = !open">
    <div class="user-avatar">{{ initials }}</div>
    <div class="user-info">
      <span class="user-name">{{ auth.user?.name }}</span>
      <span class="user-email">{{ auth.user?.email }}</span>
    </div>
    <i class="pi pi-chevron-down chevron" :class="{ rotated: open }"></i>

    <Transition name="dropdown">
      <div v-if="open" class="user-dropdown" @click.stop>
        <div class="dropdown-header">
          <div class="dropdown-avatar">{{ initials }}</div>
          <div class="dropdown-identity">
            <div class="dropdown-name">{{ auth.user?.name }}</div>
            <div class="dropdown-email">{{ auth.user?.email }}</div>
            <span class="role-chip" :class="`role-${auth.user?.role}`">{{ auth.user?.role }}</span>
          </div>
        </div>

        <div class="dropdown-divider"></div>

        <button class="dropdown-item" @click="openProfile">
          <i class="pi pi-user-edit"></i>
          <span>My Profile</span>
        </button>

        <div class="dropdown-divider"></div>

        <button class="dropdown-item logout-item" @click="logout">
          <i class="pi pi-sign-out"></i>
          <span>Logout</span>
        </button>
      </div>
    </Transition>
  </div>

  <UserProfileDialog v-model:visible="profileOpen" :initials="initials" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import UserProfileDialog from '@/components/layout/UserProfileDialog.vue'

const auth    = useAuthStore()
const router  = useRouter()
const open    = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const profileOpen = ref(false)

const initials = computed(() => {
  const name = auth.user?.name ?? ''
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
})

function handleClickOutside(e: MouseEvent) {
  if (rootRef.value && !rootRef.value.contains(e.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))

async function logout() {
  open.value = false
  await auth.logout()
  router.push('/login')
}

function openProfile() {
  open.value    = false
  profileOpen.value = true
}
</script>

<style scoped>
.user-menu {
  position: relative; display: flex; align-items: center; gap: 10px;
  padding: 5px 10px 5px 5px; border-radius: 8px; cursor: pointer;
  transition: background 0.15s; user-select: none;
}
.user-menu:hover { background: #f1f5f9; }

.user-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  color: #fff; font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}

.user-info  { display: flex; flex-direction: column; line-height: 1.2; }
.user-name  { font-size: 13px; font-weight: 600; color: #0f172a; }
.user-email { font-size: 11px; color: #94a3b8; }

.chevron { font-size: 11px; color: #94a3b8; transition: transform 0.2s; }
.chevron.rotated { transform: rotate(180deg); }

@media (max-width: 600px) {
  .user-info, .chevron { display: none; }
  .user-menu { padding: 5px; gap: 0; }
}

.user-dropdown {
  position: absolute; top: calc(100% + 6px); right: 0; width: 240px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.10); z-index: 200; overflow: hidden;
}

.dropdown-header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.dropdown-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  color: #fff; font-size: 13px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.dropdown-identity { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dropdown-name  { font-size: 13px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dropdown-email { font-size: 11px; color: #64748b;  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.role-chip {
  display: inline-block; font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em;
  padding: 1px 7px; border-radius: 20px; margin-top: 2px; width: fit-content;
}
.role-admin { background: #fee2e2; color: #b91c1c; }
.role-staff { background: #dbeafe; color: #1d4ed8; }

.dropdown-divider { height: 1px; background: #f1f5f9; }

.dropdown-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 11px 16px; border: none; background: none;
  cursor: pointer; font-size: 13px; color: #475569; text-align: left;
  transition: background 0.12s, color 0.12s;
}
.dropdown-item:hover { background: #f8fafc; color: #0f172a; }
.dropdown-item .pi  { font-size: 14px; width: 16px; text-align: center; }
.logout-item:hover  { background: #fef2f2; color: #ef4444; }

.dropdown-enter-active, .dropdown-leave-active { transition: opacity 0.15s, transform 0.15s; }
.dropdown-enter-from,   .dropdown-leave-to     { opacity: 0; transform: translateY(-6px); }
</style>
