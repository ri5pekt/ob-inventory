<template>
  <Dialog
    v-model:visible="visible"
    :header="phase === 'setup' ? 'Import Products from CSV' : phase === 'progress' ? 'Importing…' : 'Import Complete'"
    modal
    :closable="phase !== 'progress'"
    :draggable="false"
    style="width: 540px"
    @hide="onClose"
  >
    <!-- ── Phase 1: Setup ──────────────────────────────────────────── -->
    <div v-if="phase === 'setup'" class="setup-body">
      <!-- Warehouse selector -->
      <div class="field">
        <label>Target Warehouse <span class="req">*</span></label>
        <Select
          v-model="selectedWarehouseId"
          :options="warehouses ?? []"
          option-label="name"
          option-value="id"
          placeholder="Select warehouse…"
          fluid
        />
      </div>

      <!-- Drop zone -->
      <div
        class="drop-zone"
        :class="{ 'drop-zone--over': isDragging, 'drop-zone--has-file': !!file }"
        @dragover.prevent="isDragging = true"
        @dragleave.prevent="isDragging = false"
        @drop.prevent="onDrop"
        @click="fileInput?.click()"
      >
        <input ref="fileInput" type="file" accept=".csv" class="hidden-input" @change="onFileChange" />

        <template v-if="file">
          <i class="pi pi-file-import drop-icon drop-icon--ready" />
          <span class="drop-name">{{ file.name }}</span>
          <span class="drop-sub">{{ formatBytes(file.size) }} · Click to change</span>
        </template>
        <template v-else>
          <i class="pi pi-upload drop-icon" />
          <span class="drop-label">Drop CSV here or click to browse</span>
          <span class="drop-sub">WooCommerce-format export supported</span>
        </template>
      </div>

      <div v-if="setupError" class="setup-error">
        <i class="pi pi-exclamation-triangle" /> {{ setupError }}
      </div>

      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text @click="visible = false" />
        <Button
          label="Start Import"
          icon="pi pi-play"
          :disabled="!file || !selectedWarehouseId"
          :loading="starting"
          @click="startImport"
        />
      </div>
    </div>

    <!-- ── Phase 2: Progress ───────────────────────────────────────── -->
    <div v-else-if="phase === 'progress'" class="progress-body">
      <div class="progress-stats">
        <div class="stat-pill stat-pill--imported">
          <i class="pi pi-check-circle" />
          <span>{{ progress.imported }} imported</span>
        </div>
        <div class="stat-pill stat-pill--error" v-if="progress.errors > 0">
          <i class="pi pi-times-circle" />
          <span>{{ progress.errors }} errors</span>
        </div>
        <div class="stat-pill stat-pill--image" v-if="progress.imagesFailed > 0">
          <i class="pi pi-image" />
          <span>{{ progress.imagesFailed }} images failed</span>
        </div>
      </div>

      <ProgressBar :value="progressPct" :show-value="false" class="import-bar" />

      <div class="progress-meta">
        <span class="progress-count">{{ progress.current }} / {{ progress.total }}</span>
        <span class="progress-pct">{{ progressPct }}%</span>
      </div>

      <div v-if="progress.currentSku" class="current-sku">
        <i class="pi pi-spin pi-spinner" />
        Processing <code>{{ progress.currentSku }}</code>
      </div>
    </div>

    <!-- ── Phase 3: Report ────────────────────────────────────────── -->
    <div v-else-if="phase === 'report'" class="report-body">
      <div class="report-summary">
        <div class="summary-card summary-card--imported">
          <div class="summary-num">{{ report!.imported }}</div>
          <div class="summary-label">Products imported</div>
        </div>
        <div class="summary-card summary-card--skipped" v-if="report!.skipped > 0">
          <div class="summary-num">{{ report!.skipped }}</div>
          <div class="summary-label">Skipped</div>
        </div>
        <div class="summary-card summary-card--image" v-if="report!.imagesFailed > 0">
          <div class="summary-num">{{ report!.imagesFailed }}</div>
          <div class="summary-label">Images failed</div>
        </div>
        <div class="summary-card summary-card--error" v-if="report!.errors.length > 0">
          <div class="summary-num">{{ report!.errors.length }}</div>
          <div class="summary-label">Errors</div>
        </div>
      </div>

      <!-- Error list -->
      <div v-if="report!.errors.length > 0" class="error-list-wrap">
        <div class="error-list-label">
          <i class="pi pi-exclamation-circle" /> Import errors
        </div>
        <div class="error-list">
          <div v-for="e in report!.errors" :key="e.sku" class="error-row">
            <code class="error-sku">{{ e.sku }}</code>
            <span class="error-reason">{{ e.reason }}</span>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <Button label="Close" @click="onDone" />
      </div>
    </div>

    <!-- ── Phase: fatal error ─────────────────────────────────────── -->
    <div v-else-if="phase === 'fatal'" class="fatal-body">
      <i class="pi pi-times-circle fatal-icon" />
      <p class="fatal-msg">{{ fatalMessage }}</p>
      <div class="dialog-footer">
        <Button label="Close" severity="secondary" @click="visible = false" />
      </div>
    </div>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ProgressBar from 'primevue/progressbar'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/auth'
import { getWarehouses } from '@/api/warehouses'

type Phase = 'setup' | 'progress' | 'report' | 'fatal'

interface ImportResult {
  imported: number
  skipped: number
  errors: { sku: string; reason: string }[]
  imagesFailed: number
}

const emit = defineEmits<{ (e: 'done'): void }>()

const visible    = defineModel<boolean>({ required: true })
const toast      = useToast()
const auth       = useAuthStore()
const qc         = useQueryClient()

const { data: warehouses } = useQuery({ queryKey: ['warehouses'], queryFn: getWarehouses })

const phase             = ref<Phase>('setup')
const selectedWarehouseId = ref<string | null>(null)
const file              = ref<File | null>(null)
const fileInput         = ref<HTMLInputElement | null>(null)
const isDragging        = ref(false)
const setupError        = ref('')
const starting          = ref(false)
const fatalMessage      = ref('')

const progress = ref({
  current: 0,
  total: 0,
  imported: 0,
  errors: 0,
  imagesFailed: 0,
  currentSku: '',
})
const report = ref<ImportResult | null>(null)

const progressPct = computed(() =>
  progress.value.total > 0
    ? Math.round((progress.value.current / progress.value.total) * 100)
    : 0,
)

// ── File handling ─────────────────────────────────────────────────────────────

function onDrop(e: DragEvent) {
  isDragging.value = false
  const dropped = e.dataTransfer?.files[0]
  if (dropped?.name.endsWith('.csv')) {
    file.value = dropped
    setupError.value = ''
  } else {
    setupError.value = 'Please drop a .csv file.'
  }
}

function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) { file.value = f; setupError.value = '' }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ── Start import ──────────────────────────────────────────────────────────────

async function startImport() {
  if (!file.value || !selectedWarehouseId.value) return

  setupError.value = ''
  starting.value = true

  try {
    const form = new FormData()
    form.append('csv', file.value)
    form.append('warehouseId', selectedWarehouseId.value)

    const res = await fetch('/api/import/start', {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.accessToken}` },
      body: form,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Failed to start import')
    }

    const { jobId } = await res.json()
    phase.value = 'progress'
    streamProgress(jobId)
  } catch (e) {
    setupError.value = e instanceof Error ? e.message : String(e)
  } finally {
    starting.value = false
  }
}

// ── SSE stream ────────────────────────────────────────────────────────────────

async function streamProgress(jobId: string) {
  try {
    const token = auth.accessToken
    const res = await fetch(`/api/import/${jobId}/events?token=${token}`, {
      headers: { Accept: 'text/event-stream' },
    })

    if (!res.ok || !res.body) throw new Error('Could not connect to progress stream')

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by \n\n
      const parts = buffer.split('\n\n')
      buffer = parts.pop() ?? ''

      for (const part of parts) {
        if (!part.trim() || part.startsWith(':')) continue
        const lines = part.split('\n')
        let eventType = 'message'
        let dataStr   = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7)
          else if (line.startsWith('data: ')) dataStr = line.slice(6)
        }
        if (dataStr) handleEvent(eventType, JSON.parse(dataStr))
      }
    }
  } catch (e) {
    fatalMessage.value = e instanceof Error ? e.message : String(e)
    phase.value = 'fatal'
  }
}

function handleEvent(event: string, data: Record<string, unknown>) {
  if (event === 'start') {
    progress.value.total = data.total as number
  } else if (event === 'progress') {
    progress.value.current   = data.current as number
    progress.value.total     = data.total as number
    progress.value.currentSku = data.sku as string
    // The backend doesn't send running totals mid-stream; they arrive on 'done'
  } else if (event === 'done') {
    const r = data as unknown as ImportResult
    progress.value.current   = progress.value.total
    progress.value.imported  = r.imported
    progress.value.errors    = r.errors.length
    progress.value.imagesFailed = r.imagesFailed
    report.value = r
    phase.value  = 'report'
    qc.invalidateQueries({ queryKey: ['warehouses'] })
    qc.invalidateQueries({ queryKey: ['stock'] })
  } else if (event === 'error') {
    fatalMessage.value = (data.message as string) ?? 'Unknown import error'
    phase.value = 'fatal'
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function onClose() {
  if (phase.value === 'progress') return // Can't close mid-import
}

function onDone() {
  visible.value = false
  emit('done')
}

function reset() {
  phase.value = 'setup'
  file.value = null
  setupError.value = ''
  fatalMessage.value = ''
  starting.value = false
  progress.value = { current: 0, total: 0, imported: 0, errors: 0, imagesFailed: 0, currentSku: '' }
  report.value = null
}

// Reset when dialog opens
import { watch } from 'vue'
watch(visible, v => { if (v) reset() })
</script>

<style scoped>
/* ── Setup phase ─────────────────────────────────────── */
.setup-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-top: 4px;
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
.req { color: #dc2626; }

.drop-zone {
  border: 2px dashed #cbd5e1;
  border-radius: 12px;
  padding: 36px 24px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.drop-zone:hover,
.drop-zone--over { border-color: #0891b2; background: #f0f9ff; }
.drop-zone--has-file { border-style: solid; border-color: #0891b2; }

.hidden-input { display: none; }

.drop-icon {
  font-size: 32px;
  color: #94a3b8;
}
.drop-icon--ready { color: #0891b2; }
.drop-label { font-size: 14px; font-weight: 500; color: #374151; }
.drop-name  { font-size: 14px; font-weight: 600; color: #0f172a; }
.drop-sub   { font-size: 12px; color: #94a3b8; }

.setup-error {
  font-size: 13px;
  color: #dc2626;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Progress phase ──────────────────────────────────── */
.progress-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 8px 0 16px;
}

.progress-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  padding: 5px 12px;
  border-radius: 20px;
}
.stat-pill--imported { background: #dcfce7; color: #15803d; }
.stat-pill--error    { background: #fee2e2; color: #dc2626; }
.stat-pill--image    { background: #fef3c7; color: #92400e; }

.import-bar { height: 12px; border-radius: 6px; }
:deep(.import-bar .p-progressbar-value) { border-radius: 6px; }

.progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #64748b;
}
.progress-pct { font-weight: 600; color: #0891b2; }

.current-sku {
  font-size: 12px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 8px;
}
.current-sku code {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  color: #0369a1;
}

/* ── Report phase ────────────────────────────────────── */
.report-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding-top: 4px;
}

.report-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.summary-card {
  flex: 1;
  min-width: 100px;
  border-radius: 10px;
  padding: 14px 16px;
  text-align: center;
}
.summary-num   { font-size: 28px; font-weight: 700; }
.summary-label { font-size: 11px; font-weight: 500; margin-top: 2px; opacity: 0.8; }

.summary-card--imported { background: #dcfce7; color: #15803d; }
.summary-card--skipped  { background: #f1f5f9; color: #475569; }
.summary-card--image    { background: #fef3c7; color: #92400e; }
.summary-card--error    { background: #fee2e2; color: #dc2626; }

.error-list-wrap {
  background: #fff8f8;
  border: 1px solid #fecaca;
  border-radius: 8px;
  overflow: hidden;
}
.error-list-label {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  color: #dc2626;
  background: #fee2e2;
  display: flex;
  align-items: center;
  gap: 6px;
}
.error-list {
  max-height: 180px;
  overflow-y: auto;
}
.error-row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 6px 14px;
  border-bottom: 1px solid #fee2e2;
  font-size: 12px;
}
.error-row:last-child { border-bottom: none; }
.error-sku { font-family: monospace; color: #0369a1; flex-shrink: 0; }
.error-reason { color: #7f1d1d; }

/* ── Fatal phase ─────────────────────────────────────── */
.fatal-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 16px 0;
  text-align: center;
}
.fatal-icon { font-size: 40px; color: #dc2626; }
.fatal-msg  { font-size: 14px; color: #374151; }

/* ── Shared footer ───────────────────────────────────── */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}
</style>
