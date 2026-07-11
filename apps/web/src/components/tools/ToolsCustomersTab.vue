<template>
  <div class="tools-customers-tab">

    <!-- ── Import from Sales ──────────────────────────────────────────────── -->
    <div class="tool-card">
      <div class="tool-header">
        <div class="tool-icon-wrap">
          <i class="pi pi-download tool-icon" />
        </div>
        <div>
          <h3 class="tool-title">Import Customers from Sales</h3>
          <p class="tool-desc">
            Scan all existing sales records and create customer contacts from them.
            Only sales with an <strong>email address</strong> are imported (email is the unique identifier).
            Customers that already exist with the same email will be skipped.
          </p>
        </div>
      </div>

      <!-- Preview stats (loaded on mount) -->
      <div v-if="preview" class="preview-stats">
        <div class="stat-chip">
          <span class="stat-val">{{ preview.total }}</span>
          <span class="stat-label">unique in sales</span>
        </div>
        <div class="stat-chip stat-chip-green">
          <span class="stat-val">{{ preview.toCreate }}</span>
          <span class="stat-label">will be created</span>
        </div>
        <div class="stat-chip stat-chip-muted">
          <span class="stat-val">{{ preview.toSkip }}</span>
          <span class="stat-label">already exist</span>
        </div>
      </div>
      <div v-else-if="loadingPreview" class="preview-loading">
        <i class="pi pi-spin pi-spinner" /> Loading preview…
      </div>

      <div class="tool-actions">
        <Button
          label="Run Import"
          icon="pi pi-play"
          size="small"
          :disabled="loadingPreview || !!(preview && preview.toCreate === 0)"
          @click="showConfirm = true"
        />
        <Button
          label="Refresh"
          icon="pi pi-refresh"
          size="small"
          severity="secondary"
          outlined
          :loading="loadingPreview"
          @click="loadPreview"
        />
      </div>

      <!-- Zero-state message -->
      <Message
        v-if="preview && preview.toCreate === 0 && !result"
        severity="info"
        :closable="false"
        class="tool-msg"
      >
        All customers from sales already exist in the Customers list.
      </Message>
    </div>

    <!-- ── Result card ───────────────────────────────────────────────────── -->
    <div v-if="result" class="result-card">
      <div class="result-header">
        <i class="pi pi-check-circle result-icon" />
        <div>
          <h4 class="result-title">Import complete</h4>
          <p class="result-sub">
            <strong>{{ result.created }}</strong> customer(s) created,
            <strong>{{ result.skipped }}</strong> skipped (already existed).
          </p>
        </div>
      </div>

      <DataTable
        v-if="result.customers.length > 0"
        :value="result.customers"
        size="small"
        striped-rows
        class="result-table"
        paginator
        :rows="20"
        paginator-template="PrevPageLink PageLinks NextPageLink"
      >
        <Column field="name"    header="Name">
          <template #body="{ data }"><span class="cell-name">{{ data.name }}</span></template>
        </Column>
        <Column field="email"   header="Email">
          <template #body="{ data }">
            <span v-if="data.email" class="cell-email">{{ data.email }}</span>
            <span v-else class="no-val">—</span>
          </template>
        </Column>
        <Column field="phone"   header="Phone">
          <template #body="{ data }">
            <span v-if="data.phone">{{ data.phone }}</span>
            <span v-else class="no-val">—</span>
          </template>
        </Column>
        <Column field="address" header="Address">
          <template #body="{ data }">
            <span v-if="data.address" class="cell-addr">{{ data.address }}</span>
            <span v-else class="no-val">—</span>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- ── Confirm dialog ────────────────────────────────────────────────── -->
    <Dialog
      v-model:visible="showConfirm"
      modal
      header="Import Customers"
      :style="{ width: '420px' }"
      :closable="!running"
    >
      <div class="confirm-body">
        <i class="pi pi-info-circle confirm-icon" />
        <p>This will create <strong>{{ preview?.toCreate ?? '…' }}</strong> new customer(s) from your sales history.</p>
        <p class="confirm-sub">Duplicate emails will be skipped automatically.</p>
      </div>
      <template #footer>
        <Button label="Cancel" severity="secondary" outlined :disabled="running" @click="showConfirm = false" />
        <Button label="Run Import" icon="pi pi-play" :loading="running" @click="runImport" />
      </template>
    </Dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { previewImportCustomersFromSales, importCustomersFromSales, type ImportResult } from '@/api/tools'

const preview       = ref<Awaited<ReturnType<typeof previewImportCustomersFromSales>> | null>(null)
const loadingPreview = ref(false)
const showConfirm   = ref(false)
const running       = ref(false)
const result        = ref<ImportResult | null>(null)

async function loadPreview() {
  loadingPreview.value = true
  try {
    preview.value = await previewImportCustomersFromSales()
  } finally {
    loadingPreview.value = false
  }
}

async function runImport() {
  running.value = true
  try {
    result.value   = await importCustomersFromSales()
    showConfirm.value = false
    await loadPreview()
  } finally {
    running.value = false
  }
}

onMounted(loadPreview)
</script>

<style scoped>
.tools-customers-tab {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ── Tool card ── */
.tool-card {
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.tool-header {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.tool-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--p-primary-50, #eff6ff);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.tool-icon { font-size: 20px; color: var(--p-primary-color); }

.tool-title { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.tool-desc  { margin: 0; font-size: 13px; color: var(--p-text-muted-color); line-height: 1.5; }

/* ── Preview stats ── */
.preview-stats {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.stat-chip {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 18px;
  border-radius: 10px;
  background: var(--p-surface-50);
  border: 1px solid var(--p-content-border-color);
  min-width: 90px;
}
.stat-chip-green { background: var(--p-green-50, #f0fdf4); border-color: var(--p-green-200, #bbf7d0); }
.stat-chip-muted { background: var(--p-surface-100, #f8fafc); }

.stat-val   { font-size: 22px; font-weight: 700; color: var(--p-text-color); }
.stat-label { font-size: 11px; color: var(--p-text-muted-color); text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; }

.stat-chip-green .stat-val { color: var(--p-green-600, #16a34a); }

.preview-loading { color: var(--p-text-muted-color); font-size: 13px; display: flex; align-items: center; gap: 8px; }

.tool-actions { display: flex; gap: 8px; }
.tool-msg { margin: 0; }

/* ── Result card ── */
.result-card {
  background: var(--p-surface-card);
  border: 1px solid var(--p-green-200, #bbf7d0);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-header {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.result-icon { font-size: 28px; color: var(--p-green-500, #22c55e); flex-shrink: 0; margin-top: 2px; }
.result-title { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
.result-sub   { margin: 0; font-size: 13px; color: var(--p-text-muted-color); }

.cell-name  { font-weight: 600; font-size: 13px; }
.cell-email { font-size: 12px; color: var(--p-primary-color); }
.cell-addr  { font-size: 12px; color: var(--p-text-muted-color); }
.no-val     { color: var(--p-text-muted-color); }

/* ── Confirm dialog ── */
.confirm-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  text-align: center;
}
.confirm-icon { font-size: 36px; color: var(--p-primary-color); }
.confirm-body p { margin: 0; font-size: 15px; }
.confirm-sub { font-size: 13px; color: var(--p-text-muted-color); }
</style>
