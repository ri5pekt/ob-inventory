<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="visible" class="modal-overlay" @click.self="$emit('update:visible', false)">
        <div class="profile-dialog" @click.stop>

          <div class="dialog-header">
            <div class="dialog-avatar">{{ initials }}</div>
            <div>
              <div class="dialog-title">My Profile</div>
              <div class="dialog-sub">{{ auth.user?.email }}</div>
            </div>
            <button class="close-btn" @click="$emit('update:visible', false)">
              <i class="pi pi-times"></i>
            </button>
          </div>

          <!-- ── Name section ── -->
          <section class="profile-section">
            <h4 class="section-title"><i class="pi pi-user"></i> Display Name</h4>
            <div class="field-row">
              <input v-model="nameVal" class="pf-input" placeholder="Your display name" @keyup.enter="saveName" />
              <button class="pf-btn primary" :disabled="savingName || !nameVal.trim() || nameVal === auth.user?.name" @click="saveName">
                <i v-if="savingName" class="pi pi-spin pi-spinner"></i>
                <span v-else>Save</span>
              </button>
            </div>
            <p v-if="nameSuccess" class="success-msg"><i class="pi pi-check-circle"></i> Name updated</p>
            <p v-if="nameError"   class="error-msg"><i class="pi pi-exclamation-circle"></i> {{ nameError }}</p>
          </section>

          <div class="section-divider"></div>

          <!-- ── Password section ── -->
          <section class="profile-section">
            <h4 class="section-title"><i class="pi pi-lock"></i> Change Password</h4>

            <div class="field-col">
              <label class="pf-label">Current Password</label>
              <div class="pass-row">
                <input v-model="oldPass" :type="showOld ? 'text' : 'password'" class="pf-input" placeholder="Your current password" />
                <button class="icon-btn" @click="showOld = !showOld" tabindex="-1">
                  <i :class="showOld ? 'pi pi-eye-slash' : 'pi pi-eye'"></i>
                </button>
              </div>
            </div>

            <div class="field-col">
              <label class="pf-label">New Password</label>
              <div class="pass-row">
                <input v-model="newPass" :type="showNew ? 'text' : 'password'" class="pf-input" placeholder="Min. 6 characters" />
                <button class="icon-btn" @click="showNew = !showNew" tabindex="-1">
                  <i :class="showNew ? 'pi pi-eye-slash' : 'pi pi-eye'"></i>
                </button>
                <button class="icon-btn" title="Generate password" @click="fillRandom" tabindex="-1">
                  <i class="pi pi-refresh"></i>
                </button>
              </div>
            </div>

            <button class="pf-btn primary" :disabled="savingPass || !oldPass || newPass.length < 6" style="margin-top:4px" @click="savePassword">
              <i v-if="savingPass" class="pi pi-spin pi-spinner"></i>
              <span v-else>Update Password</span>
            </button>

            <p v-if="passSuccess" class="success-msg"><i class="pi pi-check-circle"></i> Password changed successfully</p>
            <p v-if="passError"   class="error-msg"><i class="pi pi-exclamation-circle"></i> {{ passError }}</p>
          </section>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ visible: boolean; initials: string }>()
defineEmits<{ 'update:visible': [val: boolean] }>()

const auth = useAuthStore()

const nameVal     = ref('')
const savingName  = ref(false)
const nameSuccess = ref(false)
const nameError   = ref('')

const oldPass     = ref('')
const newPass     = ref('')
const showOld     = ref(false)
const showNew     = ref(false)
const savingPass  = ref(false)
const passSuccess = ref(false)
const passError   = ref('')

watch(() => props.visible, (v) => {
  if (v) {
    nameVal.value = auth.user?.name ?? ''
    nameSuccess.value = nameError.value = ''
    oldPass.value = newPass.value = ''
    passSuccess.value = passError.value = ''
    showOld.value = showNew.value = false
  }
})

function genPass(len = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from(crypto.getRandomValues(new Uint8Array(len))).map(b => chars[b % chars.length]).join('')
}
function fillRandom() { newPass.value = genPass(); showNew.value = true }

async function saveName() {
  if (!nameVal.value.trim() || nameVal.value === auth.user?.name) return
  savingName.value = true; nameSuccess.value = false; nameError.value = ''
  try {
    await auth.updateProfile({ name: nameVal.value.trim() })
    nameSuccess.value = true
    setTimeout(() => { nameSuccess.value = false }, 3000)
  } catch (err: unknown) {
    nameError.value = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update name'
  } finally { savingName.value = false }
}

async function savePassword() {
  if (!oldPass.value || newPass.value.length < 6) return
  savingPass.value = true; passSuccess.value = false; passError.value = ''
  try {
    await auth.updateProfile({ password: newPass.value, oldPassword: oldPass.value })
    passSuccess.value = true
    oldPass.value = newPass.value = ''
    showOld.value = showNew.value = false
    setTimeout(() => { passSuccess.value = false }, 4000)
  } catch (err: unknown) {
    passError.value = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to change password'
  } finally { savingPass.value = false }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(15,23,42,0.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000; padding: 16px;
}
.modal-fade-enter-active, .modal-fade-leave-active { transition: opacity 0.2s; }
.modal-fade-enter-active .profile-dialog,
.modal-fade-leave-active .profile-dialog { transition: transform 0.2s, opacity 0.2s; }
.modal-fade-enter-from, .modal-fade-leave-to { opacity: 0; }
.modal-fade-enter-from .profile-dialog,
.modal-fade-leave-to   .profile-dialog  { transform: scale(0.96); opacity: 0; }

.profile-dialog {
  background: #fff; border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.15);
  width: 100%; max-width: 440px; overflow: hidden;
}

.dialog-header {
  display: flex; align-items: center; gap: 14px;
  padding: 20px 20px 16px; border-bottom: 1px solid #f1f5f9;
}
.dialog-avatar {
  width: 46px; height: 46px; border-radius: 50%;
  background: linear-gradient(135deg, #0891b2, #22d3ee);
  color: #fff; font-size: 15px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.dialog-title { font-size: 16px; font-weight: 700; color: #0f172a; }
.dialog-sub   { font-size: 12px; color: #64748b; margin-top: 1px; }
.close-btn {
  margin-left: auto; width: 30px; height: 30px; border-radius: 6px;
  border: none; background: none; cursor: pointer; color: #94a3b8;
  display: flex; align-items: center; justify-content: center; font-size: 13px;
  transition: background 0.12s, color 0.12s;
}
.close-btn:hover { background: #f1f5f9; color: #475569; }

.profile-section { padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; }
.section-title { font-size: 13px; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 7px; margin: 0; }
.section-title .pi { font-size: 13px; color: #0891b2; }
.section-divider { height: 1px; background: #f1f5f9; }

.pf-label { font-size: 12px; color: #64748b; font-weight: 500; }
.field-row { display: flex; gap: 8px; }
.field-col { display: flex; flex-direction: column; gap: 5px; }

.pf-input {
  flex: 1; min-width: 0; height: 36px; padding: 0 12px;
  border: 1px solid #e2e8f0; border-radius: 7px;
  font-size: 13px; font-family: inherit; color: #0f172a;
  background: #fff; outline: none; transition: border-color 0.15s, box-shadow 0.15s;
}
.pf-input:focus { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,0.12); }

.pass-row { display: flex; gap: 4px; align-items: center; }
.icon-btn {
  width: 34px; height: 36px; border-radius: 7px;
  border: 1px solid #e2e8f0; background: #f8fafc;
  color: #64748b; cursor: pointer; font-size: 13px;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.icon-btn:hover { background: #e2e8f0; color: #0f172a; }

.pf-btn {
  height: 36px; padding: 0 16px; border-radius: 7px; border: none; cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: inherit;
  display: flex; align-items: center; gap: 6px; transition: background 0.15s, opacity 0.15s;
}
.pf-btn.primary { background: #0891b2; color: #fff; }
.pf-btn.primary:hover:not(:disabled) { background: #0e7490; }
.pf-btn:disabled { opacity: 0.45; cursor: not-allowed; }

.success-msg { font-size: 12px; color: #059669; display: flex; align-items: center; gap: 5px; margin: 0; }
.error-msg   { font-size: 12px; color: #dc2626; display: flex; align-items: center; gap: 5px; margin: 0; }
</style>
