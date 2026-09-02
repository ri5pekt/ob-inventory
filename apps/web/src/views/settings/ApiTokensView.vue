<template>
  <div class="tokens-view">

    <!-- ── Header ── -->
    <div class="page-header">
      <div>
        <h2 class="page-title">API Tokens</h2>
        <p class="page-desc">Grant external agents / scripts read-only access to your data via /api/v1</p>
      </div>
      <Button label="New Token" icon="pi pi-plus" size="small" @click="openCreate" />
    </div>

    <!-- ── Tokens table ── -->
    <div class="table-section">
      <div class="table-wrap">
        <DataTable :value="tokens" :loading="loading" size="small" striped-rows>
          <template #empty>
            <div class="table-empty"><i class="pi pi-key" /> No API tokens yet</div>
          </template>

          <Column field="name" header="Name" sortable style="min-width: 160px" />

          <Column header="Token" style="min-width: 160px">
            <template #body="{ data }">
              <code class="token-prefix">{{ data.tokenPrefix }}…</code>
            </template>
          </Column>

          <Column header="Status" style="width: 120px">
            <template #body="{ data }">
              <span class="status-badge" :class="statusClass(data)">{{ statusLabel(data) }}</span>
            </template>
          </Column>

          <Column header="Last used" style="width: 150px">
            <template #body="{ data }">
              <span class="muted">{{ data.lastUsedAt ? formatDate(data.lastUsedAt) : 'Never' }}</span>
            </template>
          </Column>

          <Column header="Expires" style="width: 130px">
            <template #body="{ data }">
              <span class="muted">{{ data.expiresAt ? formatDate(data.expiresAt) : 'Never' }}</span>
            </template>
          </Column>

          <Column field="createdAt" header="Created" sortable style="width: 130px">
            <template #body="{ data }">
              <span class="muted">{{ formatDate(data.createdAt) }}</span>
            </template>
          </Column>

          <Column header="Actions" style="width: 100px; text-align: center">
            <template #body="{ data }">
              <div class="action-row">
                <Button
                  v-if="data.isActive"
                  icon="pi pi-ban"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  title="Revoke token"
                  :loading="revokingId === data.id"
                  @click="confirmRevoke(data)"
                />
                <Button
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  title="Delete token"
                  :loading="deletingId === data.id"
                  @click="confirmDelete(data)"
                />
              </div>
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- ── Create dialog ── -->
    <Dialog
      v-model:visible="createVisible"
      modal
      header="New API Token"
      :style="{ width: '440px', maxWidth: '96vw' }"
    >
      <form class="create-form" @submit.prevent="submitCreate" novalidate>
        <div class="field">
          <label class="field-label">Name</label>
          <InputText v-model="createForm.name" class="w-full" placeholder="e.g. Claude inventory bot" autofocus />
        </div>
        <div class="field">
          <label class="field-label">Expires <span class="muted">(optional)</span></label>
          <DatePicker v-model="createForm.expiresAt" show-icon icon-display="input" class="w-full" placeholder="Never" />
        </div>
        <p class="hint">This token grants read-only access to all data (products, stock, movements, sales, quotes, customers, warehouses, users). Anyone with it can call <code>/api/v1/*</code>.</p>
        <div v-if="createError" class="error-banner"><i class="pi pi-exclamation-circle" /> {{ createError }}</div>
      </form>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="createVisible = false" />
        <Button label="Create Token" icon="pi pi-key" :loading="creating" @click="submitCreate" />
      </template>
    </Dialog>

    <!-- ── Reveal dialog — shown exactly once ── -->
    <Dialog
      v-model:visible="revealVisible"
      modal
      :closable="false"
      header="Token Created"
      :style="{ width: '520px', maxWidth: '96vw' }"
    >
      <p class="reveal-warning"><i class="pi pi-exclamation-triangle" /> Copy this now — it won't be shown again.</p>
      <div class="token-box">
        <code>{{ revealedToken }}</code>
        <Button icon="pi pi-copy" text rounded size="small" title="Copy" @click="copyToken" />
      </div>
      <p v-if="copied" class="copied-msg">Copied to clipboard</p>
      <template #footer>
        <Button label="Done" icon="pi pi-check" @click="revealVisible = false; revealedToken = ''" />
      </template>
    </Dialog>

    <!-- ── Revoke confirm ── -->
    <Dialog
      v-model:visible="revokeVisible"
      modal
      header="Revoke Token"
      :style="{ width: '400px', maxWidth: '96vw' }"
    >
      <p class="confirm-copy">
        Revoke <strong>{{ revokeTarget?.name }}</strong>? Any agent using this token will
        immediately lose access to <code>/api/v1</code>.
      </p>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="revokeVisible = false" />
        <Button label="Revoke" icon="pi pi-ban" severity="danger" :loading="revokingId !== null" @click="doRevoke" />
      </template>
    </Dialog>

    <!-- ── Delete confirm ── -->
    <Dialog
      v-model:visible="deleteVisible"
      modal
      header="Delete Token"
      :style="{ width: '400px', maxWidth: '96vw' }"
    >
      <p class="confirm-copy">
        Permanently delete <strong>{{ deleteTarget?.name }}</strong>? This cannot be undone.
      </p>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="deleteVisible = false" />
        <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deletingId !== null" @click="doDelete" />
      </template>
    </Dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import Dialog      from 'primevue/dialog'
import InputText   from 'primevue/inputtext'
import DatePicker  from 'primevue/datepicker'
import { apiTokensApi } from '@/api/apiTokens'
import type { ApiTokenDTO } from '@/api/apiTokens'

const qc = useQueryClient()

const { data: tokenList, isLoading: loading } = useQuery({
  queryKey: ['api-tokens'],
  queryFn:  apiTokensApi.list,
})
const tokens = computed(() => tokenList.value ?? [])

function statusLabel(t: ApiTokenDTO) {
  if (!t.isActive) return 'Revoked'
  if (t.expiresAt && new Date(t.expiresAt) < new Date()) return 'Expired'
  return 'Active'
}
function statusClass(t: ApiTokenDTO) {
  const s = statusLabel(t)
  return s === 'Active' ? 'status-active' : s === 'Expired' ? 'status-expired' : 'status-revoked'
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ── Create ───────────────────────────────────────────────────────────────────
const createVisible = ref(false)
const createForm     = ref<{ name: string; expiresAt: Date | null }>({ name: '', expiresAt: null })
const createError    = ref('')
const creating        = ref(false)

const revealVisible = ref(false)
const revealedToken  = ref('')
const copied          = ref(false)

function openCreate() {
  createForm.value  = { name: '', expiresAt: null }
  createError.value = ''
  createVisible.value = true
}

async function submitCreate() {
  if (!createForm.value.name.trim()) {
    createError.value = 'Name is required'
    return
  }
  creating.value    = true
  createError.value = ''
  try {
    const result = await apiTokensApi.create({
      name:      createForm.value.name.trim(),
      expiresAt: createForm.value.expiresAt ? createForm.value.expiresAt.toISOString() : undefined,
    })
    await qc.invalidateQueries({ queryKey: ['api-tokens'] })
    createVisible.value = false
    revealedToken.value = result.token
    revealVisible.value = true
    copied.value = false
  } catch (err: unknown) {
    createError.value = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to create token'
  } finally {
    creating.value = false
  }
}

async function copyToken() {
  try {
    await navigator.clipboard.writeText(revealedToken.value)
    copied.value = true
  } catch {
    // ignore — user can still select + copy manually
  }
}

// ── Revoke ───────────────────────────────────────────────────────────────────
const revokeVisible = ref(false)
const revokeTarget   = ref<ApiTokenDTO | null>(null)
const revokingId      = ref<string | null>(null)

function confirmRevoke(t: ApiTokenDTO) {
  revokeTarget.value  = t
  revokeVisible.value = true
}

async function doRevoke() {
  if (!revokeTarget.value) return
  revokingId.value = revokeTarget.value.id
  try {
    await apiTokensApi.revoke(revokeTarget.value.id)
    await qc.invalidateQueries({ queryKey: ['api-tokens'] })
    revokeVisible.value = false
  } finally {
    revokingId.value = null
  }
}

// ── Delete ───────────────────────────────────────────────────────────────────
const deleteVisible = ref(false)
const deleteTarget   = ref<ApiTokenDTO | null>(null)
const deletingId      = ref<string | null>(null)

function confirmDelete(t: ApiTokenDTO) {
  deleteTarget.value  = t
  deleteVisible.value = true
}

async function doDelete() {
  if (!deleteTarget.value) return
  deletingId.value = deleteTarget.value.id
  try {
    await apiTokensApi.remove(deleteTarget.value.id)
    await qc.invalidateQueries({ queryKey: ['api-tokens'] })
    deleteVisible.value = false
  } finally {
    deletingId.value = null
  }
}
</script>

<style scoped>
.tokens-view { display: flex; flex-direction: column; gap: 24px; overflow-y: auto; height: 100%; padding: 0; }

.page-header { display: flex; align-items: flex-start; justify-content: space-between; }
.page-title  { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
.page-desc   { font-size: 13px; color: #64748b; margin: 0; }

.table-section { display: flex; flex-direction: column; gap: 12px; }
.table-wrap { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; }

.table-empty {
  display: flex; align-items: center; gap: 8px;
  color: #94a3b8; font-size: 14px; padding: 32px; justify-content: center;
}

.token-prefix {
  font-family: monospace; font-size: 12px; background: #f1f5f9;
  padding: 2px 8px; border-radius: 6px; color: #475569;
}

.status-badge {
  display: inline-block; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 9px; border-radius: 20px;
}
.status-active   { background: #dcfce7; color: #15803d; }
.status-revoked  { background: #fee2e2; color: #b91c1c; }
.status-expired  { background: #fef3c7; color: #a16207; }

.muted { color: #94a3b8; font-size: 13px; }

.action-row { display: flex; align-items: center; justify-content: center; gap: 2px; }

.create-form { display: flex; flex-direction: column; gap: 14px; padding-top: 4px; }
.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 13px; font-weight: 500; color: #475569; }
.w-full { width: 100%; }

.hint { font-size: 12px; color: #64748b; line-height: 1.5; margin: 0; }
.hint code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }

.error-banner {
  display: flex; align-items: center; gap: 8px;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  padding: 10px 14px; border-radius: 8px; font-size: 13px;
}

.reveal-warning {
  display: flex; align-items: center; gap: 8px;
  background: #fef3c7; border: 1px solid #fde68a; color: #92400e;
  padding: 10px 14px; border-radius: 8px; font-size: 13px; margin: 0 0 12px;
}

.token-box {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  background: #0f172a; color: #e2e8f0; padding: 10px 14px; border-radius: 8px;
}
.token-box code { font-family: monospace; font-size: 13px; word-break: break-all; }

.copied-msg { font-size: 12px; color: #15803d; margin: 8px 0 0; }

.confirm-copy { margin: 0; font-size: 14px; line-height: 1.5; color: #475569; }
.confirm-copy code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }

@media (max-width: 768px) {
  .tokens-view { gap: 16px; }
  .page-title { font-size: 18px; }
  .page-desc { font-size: 12px; }
}
</style>
