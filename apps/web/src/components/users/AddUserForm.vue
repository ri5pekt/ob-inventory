<template>
  <div class="add-card">
    <h3 class="card-title">Add New User</h3>
    <form @submit.prevent="submit" novalidate>
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Display Name <span class="req">*</span></label>
          <InputText v-model="form.name" placeholder="John Doe" :invalid="touched && !form.name" class="w-full" />
          <span v-if="touched && !form.name" class="field-error">Required</span>
        </div>

        <div class="field">
          <label class="field-label">Email <span class="req">*</span></label>
          <InputText v-model="form.email" placeholder="user@example.com" type="email" :invalid="touched && !form.email" class="w-full" />
          <span v-if="touched && !form.email" class="field-error">Required</span>
        </div>

        <div class="field">
          <label class="field-label">Password <span class="req">*</span></label>
          <div class="pass-row">
            <InputText
              v-model="form.password"
              :type="showPass ? 'text' : 'password'"
              placeholder="Min. 6 characters"
              :invalid="touched && form.password.length < 6"
              class="w-full"
            />
            <Button icon="pi pi-eye" text severity="secondary" size="small" @click="showPass = !showPass" />
            <Button icon="pi pi-refresh" text severity="secondary" size="small" title="Generate password" @click="generatePassword" />
          </div>
          <span v-if="touched && form.password.length < 6" class="field-error">Min. 6 characters</span>
        </div>

        <div class="field">
          <label class="field-label">Role</label>
          <Select v-model="form.role" :options="roleOptions" option-label="label" option-value="value" class="w-full" append-to="body" />
        </div>
      </div>

      <div v-if="createError" class="error-banner">
        <i class="pi pi-exclamation-circle" /> {{ createError }}
      </div>

      <Button type="submit" label="Add User" icon="pi pi-user-plus" :loading="creating" style="margin-top: 4px" />
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { usersApi } from '@/api/users'

const emit = defineEmits<{ created: [] }>()

const roleOptions = [
  { label: 'Staff', value: 'staff' },
  { label: 'Admin', value: 'admin' },
]

const emptyForm = () => ({ name: '', email: '', password: '', role: 'staff' as 'admin' | 'staff' })
const form       = ref(emptyForm())
const touched    = ref(false)
const creating   = ref(false)
const createError = ref('')
const showPass   = ref(false)

function genPass(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from(crypto.getRandomValues(new Uint8Array(len))).map(b => chars[b % chars.length]).join('')
}
function generatePassword() { form.value.password = genPass(); showPass.value = true }

async function submit() {
  touched.value = true
  if (!form.value.name || !form.value.email || form.value.password.length < 6) return
  creating.value = true; createError.value = ''
  try {
    await usersApi.create({ ...form.value })
    form.value   = emptyForm()
    touched.value = false
    showPass.value = false
    emit('created')
  } catch (err: unknown) {
    createError.value = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create user'
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.add-card {
  background: #f0fdf9; border: 1px solid #d1fae5; border-radius: 12px; padding: 20px 24px 24px;
}
.card-title { font-size: 14px; font-weight: 600; color: #0f172a; margin: 0 0 16px; }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; margin-bottom: 16px; }

@media (max-width: 768px) {
  .add-card { padding: 14px 16px 18px; }
  .form-grid { grid-template-columns: 1fr; gap: 12px 0; margin-bottom: 14px; }
}

.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 13px; font-weight: 500; color: #475569; }
.req         { color: #ef4444; }
.field-error { font-size: 12px; color: #ef4444; }

.pass-row { display: flex; gap: 4px; align-items: center; }
.pass-row .w-full { flex: 1; min-width: 0; }

.error-banner {
  display: flex; align-items: center; gap: 8px;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 4px;
}
.w-full { width: 100%; }
</style>
