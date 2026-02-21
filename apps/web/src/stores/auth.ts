import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient } from '@/api/client'
import type { AuthUser } from '@ob-inventory/types'

export const useAuthStore = defineStore('auth', () => {
  const storedUser = localStorage.getItem('user')
  const user = ref<AuthUser | null>(storedUser ? JSON.parse(storedUser) : null)
  const accessToken = ref<string | null>(localStorage.getItem('accessToken'))
  const isAuthenticated = computed(() => !!accessToken.value && !!user.value)

  function setAuth(token: string, userData: AuthUser) {
    accessToken.value = token
    user.value = userData
    localStorage.setItem('accessToken', token)
    localStorage.setItem('user', JSON.stringify(userData))
  }

  function clearAuth() {
    accessToken.value = null
    user.value = null
    localStorage.removeItem('accessToken')
    localStorage.removeItem('user')
  }

  async function login(email: string, password: string) {
    const { data } = await apiClient.post('/auth/login', { email, password })
    setAuth(data.accessToken, data.user)
  }

  async function logout() {
    try { await apiClient.post('/auth/logout') } catch { /* ignore */ }
    clearAuth()
  }

  async function fetchMe() {
    if (!accessToken.value) return
    try {
      const { data } = await apiClient.get('/auth/me')
      user.value = data
    } catch {
      clearAuth()
    }
  }

  async function refreshToken(): Promise<string> {
    const { data } = await apiClient.post('/auth/refresh')
    accessToken.value = data.accessToken
    user.value = data.user
    localStorage.setItem('accessToken', data.accessToken)
    return data.accessToken
  }

  async function updateProfile(payload: { name?: string; password?: string; oldPassword?: string }) {
    const { data } = await apiClient.put('/auth/profile', payload)
    if (user.value) {
      user.value = { ...user.value, ...data }
      localStorage.setItem('user', JSON.stringify(user.value))
    }
  }

  return { user, accessToken, isAuthenticated, login, logout, fetchMe, refreshToken, setAuth, clearAuth, updateProfile }
})
