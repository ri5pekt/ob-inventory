<template>
  <div class="tab-body">
    <div v-if="loading" class="loading-state">
      <i class="pi pi-spin pi-spinner"></i> Loading…
    </div>

    <template v-else-if="store">
      <!-- Settings card -->
      <div class="settings-card">
        <div class="card-header">
          <span class="card-title">Settings</span>
        </div>
        <div class="card-body">
          <div class="form-grid">
            <div class="field full-width">
              <label class="field-label">Store URL</label>
              <InputText
                v-model="form.url"
                placeholder="https://yourstore.com"
                class="w-full"
              />
              <span class="field-hint">The root URL of your WooCommerce site.</span>
            </div>

            <div class="field full-width">
              <label class="field-label">
                Secret Token
                <span v-if="store.hasToken" class="has-token-badge">
                  <i class="pi pi-check-circle"></i> Token saved
                </span>
              </label>
              <div class="token-row">
                <InputText
                  v-model="form.secretToken"
                  :type="showToken ? 'text' : 'password'"
                  placeholder="Leave blank to keep current token"
                  class="w-full"
                  autocomplete="new-password"
                />
                <Button
                  :icon="showToken ? 'pi pi-eye-slash' : 'pi pi-eye'"
                  text
                  severity="secondary"
                  size="small"
                  @click="showToken = !showToken"
                />
              </div>
              <span class="field-hint">
                Copy this same token into the plugin's settings page in WordPress
                (Settings → OB Inventory).
              </span>
            </div>
          </div>

          <div class="card-actions">
            <Button
              label="Save Settings"
              icon="pi pi-save"
              :loading="saving"
              @click="saveSettings"
            />
            <span v-if="saveSuccess" class="save-ok">
              <i class="pi pi-check"></i> Saved
            </span>
          </div>
        </div>
      </div>

      <!-- Connection status card -->
      <div class="settings-card">
        <div class="card-header">
          <span class="card-title">Connection Status</span>
          <span v-if="testState === 'success' && bothOk" class="all-ok-badge">
            <i class="pi pi-check-circle"></i> Both directions connected
          </span>
          <span v-else-if="testState === 'success' && !bothOk" class="partial-badge">
            <i class="pi pi-exclamation-triangle"></i> Partial
          </span>
        </div>
        <div class="card-body">

          <WooTestResultCard :test-state="testState" :result="testResult" />

          <div class="card-actions" style="margin-top: 20px">
            <Button
              label="Test Connection"
              icon="pi pi-bolt"
              severity="secondary"
              :loading="testState === 'loading'"
              :disabled="!store.url || !store.hasToken"
              @click="runTest"
            />
            <span v-if="!store.url || !store.hasToken" class="field-hint">
              Save a URL and token first.
            </span>
          </div>
        </div>
      </div>

      <!-- Installation guide -->
      <div class="settings-card guide-card">
        <div class="card-header">
          <span class="card-title">Quick Setup Guide</span>
        </div>
        <div class="card-body">
          <ol class="guide-steps">
            <li>Upload the <code>ob-inventory-sync</code> folder to your WordPress <code>/wp-content/plugins/</code> directory and activate the plugin.</li>
            <li>Go to <strong>WordPress → Settings → OB Inventory</strong>.</li>
            <li>Generate a strong random token, paste it there, and save.</li>
            <li>Copy the same token into the <strong>Secret Token</strong> field above and save.</li>
            <li>Click <strong>Test Connection</strong> to verify everything works.</li>
          </ol>
          <div class="ping-url-box">
            <span class="ping-label">Plugin ping endpoint:</span>
            <code class="ping-code">{{ store.url ? store.url.replace(/\/$/, '') + '/wp-json/ob-inventory/v1/ping' : 'https://yourstore.com/wp-json/ob-inventory/v1/ping' }}</code>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty-state">
      <i class="pi pi-shop empty-icon"></i>
      <p>No WooCommerce store configured.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import { updateStore, testWooConnection } from '@/api/stores'
import type { Store, WooTestResult } from '@/api/stores'
import WooTestResultCard from '@/components/woo/WooTestResultCard.vue'

const props = defineProps<{
  store: Store | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'updated', store: Store): void
}>()

const queryClient = useQueryClient()

// ── Form ──────────────────────────────────────────────────────────────────────
const form = ref({ url: '', secretToken: '' })
const showToken   = ref(false)
const saving      = ref(false)
const saveSuccess = ref(false)

// ── Test connection state (must be declared before the watch that uses it) ───
type TestState = 'idle' | 'loading' | 'success' | 'error'
const testState  = ref<TestState>('idle')
const testResult = ref<WooTestResult | null>(null)
const bothOk     = computed(() => !!(testResult.value?.forward.success && testResult.value?.reverse.success))

const testStorageKey = (id: string) => `ob_woo_test_${id}`

function persistTestState() {
  if (!props.store) return
  localStorage.setItem(testStorageKey(props.store.id), JSON.stringify({
    testState:  testState.value,
    testResult: testResult.value,
  }))
}

function restoreTestState(id: string) {
  const raw = localStorage.getItem(testStorageKey(id))
  if (!raw) { testState.value = 'idle'; testResult.value = null; return }
  try {
    const saved = JSON.parse(raw) as { testState: TestState; testResult: WooTestResult }
    testState.value  = saved.testState
    testResult.value = saved.testResult
  } catch {
    testState.value = 'idle'; testResult.value = null
  }
}

// ── Watch store changes ───────────────────────────────────────────────────────
watch(() => props.store, (s) => {
  if (s) {
    form.value.url         = s.url ?? ''
    form.value.secretToken = ''
    restoreTestState(s.id)
  }
}, { immediate: true })

async function saveSettings() {
  if (!props.store) return
  saving.value = true
  saveSuccess.value = false
  try {
    const payload: { url?: string; secretToken?: string } = {}
    payload.url = form.value.url || undefined
    if (form.value.secretToken) payload.secretToken = form.value.secretToken

    const updated = await updateStore(props.store.id, payload)
    form.value.secretToken = ''
    saveSuccess.value = true
    emit('updated', updated)
    await queryClient.invalidateQueries({ queryKey: ['stores'] })
    setTimeout(() => { saveSuccess.value = false }, 3000)
  } finally {
    saving.value = false
  }
}

async function runTest() {
  if (!props.store) return
  testState.value  = 'loading'
  testResult.value = null
  try {
    const result = await testWooConnection(props.store.id)
    testResult.value = result
    testState.value  = 'success'
  } catch {
    testResult.value = {
      forward: { success: false, error: 'Unexpected error — check API logs' },
      reverse: { success: false, error: 'Skipped — forward request failed' },
    }
    testState.value = 'error'
  }
  persistTestState()
}

</script>

<style scoped>
.tab-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 20px;
}

.settings-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
  max-width: 680px;
}

.card-header {
  padding: 14px 20px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-title {
  font-size: 13px;
  font-weight: 700;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-body { padding: 20px; }

.card-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 20px;
}

.form-grid { display: flex; flex-direction: column; gap: 16px; }

.field { display: flex; flex-direction: column; gap: 5px; }

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 8px;
}

.field-hint { font-size: 12px; color: #94a3b8; }

.has-token-badge {
  font-size: 11px;
  font-weight: 600;
  color: #15803d;
  background: #dcfce7;
  padding: 2px 8px;
  border-radius: 20px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.token-row { display: flex; gap: 6px; align-items: center; }
.w-full { width: 100%; }

.save-ok {
  font-size: 13px;
  color: #15803d;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

/* ── Header badges ── */
.all-ok-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  background: #dcfce7; color: #15803d; padding: 3px 10px; border-radius: 20px;
}
.partial-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  background: #fef9c3; color: #854d0e; padding: 3px 10px; border-radius: 20px;
}

.error-msg {
  font-size: 13px;
  color: #b91c1c;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  padding: 6px 10px;
}

.guide-card { border-style: dashed; background: #fafafa; }

.guide-steps {
  margin: 0 0 16px;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  color: #475569;
  line-height: 1.6;
}

.ping-url-box { display: flex; flex-direction: column; gap: 4px; }
.ping-label { font-size: 12px; font-weight: 600; color: #64748b; }
.ping-code {
  font-size: 12px;
  background: #f1f5f9;
  padding: 6px 10px;
  border-radius: 6px;
  color: #0891b2;
  word-break: break-all;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  padding: 40px 0;
  font-size: 14px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px 0;
  color: #94a3b8;
}

.empty-icon { font-size: 40px; }
</style>
