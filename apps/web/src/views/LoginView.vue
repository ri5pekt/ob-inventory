<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-icon">
          <i class="pi pi-box"></i>
        </div>
        <h1 class="brand-title">OB Inventory</h1>
        <p class="brand-subtitle">Sign in to your account</p>
      </div>

      <form class="login-form" @submit.prevent="handleLogin">
        <div class="field">
          <label for="email">Email</label>
          <InputText
            id="email"
            v-model="email"
            type="email"
            placeholder="admin@local"
            autocomplete="email"
            :disabled="loading"
            fluid
          />
        </div>

        <div class="field">
          <label for="password">Password</label>
          <Password
            id="password"
            v-model="password"
            :feedback="false"
            placeholder="••••••••"
            autocomplete="current-password"
            :disabled="loading"
            fluid
            toggle-mask
          />
        </div>

        <Message v-if="errorMsg" severity="error" :closable="false">{{ errorMsg }}</Message>

        <Button
          type="submit"
          label="Sign In"
          :loading="loading"
          fluid
          class="mt-1"
        />
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorMsg = ref('')

async function handleLogin() {
  errorMsg.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.push('/inventory')
  } catch {
    errorMsg.value = 'Invalid email or password'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0e3a4a 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.login-card {
  background: #fff;
  border-radius: 16px;
  padding: 40px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 25px 50px rgba(0,0,0,0.35);
}

.login-brand {
  text-align: center;
  margin-bottom: 32px;
}

.brand-icon {
  width: 56px;
  height: 56px;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  border-radius: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-size: 24px;
  margin-bottom: 14px;
}

.brand-title {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px;
}

.brand-subtitle {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.mt-1 {
  margin-top: 4px;
}
</style>
