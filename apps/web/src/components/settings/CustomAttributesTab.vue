<template>
  <div>
    <div v-if="attrLoading" class="attr-loading">
      <Skeleton v-for="i in 4" :key="i" height="120px" border-radius="10px" />
    </div>
    <div v-else class="attr-list">
      <div v-for="attr in attributes" :key="attr.id" class="attr-card">
        <div class="attr-card-header">
          <div class="attr-title-row">
            <span class="attr-name">{{ attr.name }}</span>
            <span class="type-badge" :class="`type-${attr.inputType}`">{{ attr.inputType }}</span>
            <span v-if="attr.isRequired" class="required-badge">required</span>
          </div>
          <div class="attr-actions">
            <Button icon="pi pi-pencil" text rounded size="small" @click="openEditAttr(attr)" />
            <Button icon="pi pi-trash"  text rounded size="small" severity="danger" @click="confirmDeleteAttr(attr)" />
          </div>
        </div>

        <div v-if="attr.inputType === 'select'" class="options-section">
          <div class="options-header">
            <span class="options-label">Options</span>
            <Button icon="pi pi-plus" label="Add" text size="small" @click="openAddOption(attr)" />
          </div>
          <div class="options-list">
            <div v-if="attr.options.length === 0" class="options-empty">No options yet</div>
            <div v-for="opt in attr.options" :key="opt.id" class="option-row">
              <span class="option-code">{{ opt.code }}</span>
              <span class="option-label-text">{{ opt.label }}</span>
              <div class="option-actions">
                <Button icon="pi pi-pencil" text rounded size="small" @click="openEditOption(attr, opt)" />
                <Button icon="pi pi-trash"  text rounded size="small" severity="danger" @click="confirmDeleteOption(opt)" />
              </div>
            </div>
          </div>
        </div>
        <div v-else class="options-hint">
          <i class="pi pi-info-circle"></i> Free {{ attr.inputType }} input — no predefined options
        </div>
      </div>

      <button class="attr-add-card" @click="openAddAttr">
        <i class="pi pi-plus"></i>
        <span>Add attribute</span>
      </button>
    </div>
  </div>

  <!-- Attribute definition dialog -->
  <Dialog v-model:visible="attrDialog" :header="attrEdit ? 'Edit Attribute' : 'New Attribute'" modal :style="{ width: '420px' }" :breakpoints="{ '480px': 'calc(100vw - 16px)' }">
    <div class="fields">
      <div class="field">
        <label>Name</label>
        <InputText v-model="attrForm.name" autofocus style="width: 100%" />
      </div>
      <div v-if="!attrEdit" class="field">
        <label>Input type</label>
        <Select v-model="attrForm.inputType" :options="inputTypes" option-label="label" option-value="value" style="width: 100%" />
      </div>
      <div class="field-row">
        <Checkbox v-model="attrForm.isRequired" binary input-id="req" />
        <label for="req">Required field</label>
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="attrDialog = false" />
      <Button :label="attrEdit ? 'Save' : 'Create'" :loading="saving" @click="saveAttr" />
    </template>
  </Dialog>

  <!-- Option dialog -->
  <Dialog v-model:visible="optDialog" :header="optEdit ? 'Edit Option' : 'Add Option'" modal :style="{ width: '380px' }" :breakpoints="{ '480px': 'calc(100vw - 16px)' }">
    <div class="fields">
      <div class="field">
        <label>Code <span class="hint">(short key, e.g. BK)</span></label>
        <InputText v-model="optForm.code" autofocus style="width: 100%" />
      </div>
      <div class="field">
        <label>Label <span class="hint">(display name, e.g. Black)</span></label>
        <InputText v-model="optForm.label" style="width: 100%" @keyup.enter="saveOption" />
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" text @click="optDialog = false" />
      <Button :label="optEdit ? 'Save' : 'Add'" :loading="saving" @click="saveOption" />
    </template>
  </Dialog>

  <ConfirmDialog />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { catalogApi, type AttributeDefinition, type AttributeOption } from '@/api/catalog'

const toast   = useToast()
const confirm = useConfirm()
const qc      = useQueryClient()

const { data: attributes, isLoading: attrLoading } = useQuery({ queryKey: ['attributes'], queryFn: catalogApi.getAttributes })

const saving = ref(false)

const inputTypes = [
  { label: 'Select (from list)', value: 'select' },
  { label: 'Text (free input)',  value: 'text'   },
  { label: 'Number',             value: 'number' },
]

// ── Attribute CRUD ────────────────────────────────────────────────────────────
const attrDialog = ref(false)
const attrEdit   = ref<AttributeDefinition | null>(null)
const attrForm   = ref({ name: '', inputType: 'text' as 'select' | 'text' | 'number', isRequired: false, sortOrder: 0 })

function openAddAttr() {
  attrEdit.value = null
  attrForm.value = { name: '', inputType: 'text', isRequired: false, sortOrder: (attributes.value?.length ?? 0) * 10 }
  attrDialog.value = true
}

function openEditAttr(attr: AttributeDefinition) {
  attrEdit.value = attr
  attrForm.value = { name: attr.name, inputType: attr.inputType, isRequired: attr.isRequired, sortOrder: attr.sortOrder }
  attrDialog.value = true
}

async function saveAttr() {
  if (!attrForm.value.name.trim()) return
  saving.value = true
  try {
    attrEdit.value
      ? await catalogApi.updateAttribute(attrEdit.value.id, { name: attrForm.value.name, isRequired: attrForm.value.isRequired, sortOrder: attrForm.value.sortOrder })
      : await catalogApi.createAttribute(attrForm.value)
    qc.invalidateQueries({ queryKey: ['attributes'] })
    attrDialog.value = false
    toast.add({ severity: 'success', summary: 'Saved', life: 2000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Error saving', life: 3000 })
  } finally {
    saving.value = false
  }
}

function confirmDeleteAttr(attr: AttributeDefinition) {
  confirm.require({
    message:     `Delete attribute "${attr.name}" and all its options?`,
    header:      'Confirm Delete',
    icon:        'pi pi-exclamation-triangle',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await catalogApi.deleteAttribute(attr.id)
      qc.invalidateQueries({ queryKey: ['attributes'] })
      toast.add({ severity: 'success', summary: 'Deleted', life: 2000 })
    },
  })
}

// ── Option CRUD ───────────────────────────────────────────────────────────────
const optDialog   = ref(false)
const optEdit     = ref<AttributeOption | null>(null)
const optParentId = ref('')
const optForm     = ref({ code: '', label: '', sortOrder: 0 })

function openAddOption(attr: AttributeDefinition) {
  optEdit.value      = null
  optParentId.value  = attr.id
  optForm.value      = { code: '', label: '', sortOrder: attr.options.length * 10 }
  optDialog.value    = true
}

function openEditOption(_attr: AttributeDefinition, opt: AttributeOption) {
  optEdit.value  = opt
  optForm.value  = { code: opt.code, label: opt.label, sortOrder: opt.sortOrder }
  optDialog.value = true
}

async function saveOption() {
  if (!optForm.value.code.trim() || !optForm.value.label.trim()) return
  saving.value = true
  try {
    optEdit.value
      ? await catalogApi.updateOption(optEdit.value.id, optForm.value)
      : await catalogApi.createOption(optParentId.value, optForm.value)
    qc.invalidateQueries({ queryKey: ['attributes'] })
    optDialog.value = false
    toast.add({ severity: 'success', summary: 'Saved', life: 2000 })
  } catch {
    toast.add({ severity: 'error', summary: 'Error saving', life: 3000 })
  } finally {
    saving.value = false
  }
}

function confirmDeleteOption(opt: AttributeOption) {
  confirm.require({
    message:     `Delete option "${opt.label}"?`,
    header:      'Confirm Delete',
    icon:        'pi pi-exclamation-triangle',
    rejectLabel: 'Cancel',
    acceptLabel: 'Delete',
    acceptClass: 'p-button-danger',
    accept: async () => {
      await catalogApi.deleteOption(opt.id)
      qc.invalidateQueries({ queryKey: ['attributes'] })
      toast.add({ severity: 'success', summary: 'Deleted', life: 2000 })
    },
  })
}
</script>

<style scoped>
.attr-loading { display: flex; flex-direction: column; gap: 12px; }

.attr-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
  align-items: start;
}

@media (max-width: 768px) {
  .attr-list { grid-template-columns: 1fr; gap: 12px; }
  .attr-card-header { padding: 10px 12px; flex-wrap: wrap; gap: 8px; }
  .options-section { padding: 10px 12px; }
}

.attr-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow: hidden;
}

.attr-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
}

.attr-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1;
}

.attr-name { font-size: 14px; font-weight: 600; color: #0f172a; }

.type-badge {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  padding: 2px 7px; border-radius: 4px; letter-spacing: 0.04em;
}
.type-select { background: #ede9fe; color: #6d28d9; }
.type-text   { background: #e0f2fe; color: #0369a1; }
.type-number { background: #fef9c3; color: #854d0e; }

.required-badge {
  font-size: 10px; font-weight: 600; text-transform: uppercase;
  padding: 2px 7px; border-radius: 4px;
  background: #fee2e2; color: #dc2626;
}

.attr-actions { display: flex; gap: 2px; }

.options-section { padding: 10px 14px; }

.options-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.options-label {
  font-size: 11px; font-weight: 600; color: #94a3b8;
  text-transform: uppercase; letter-spacing: 0.05em;
}

.options-list  { display: flex; flex-direction: column; gap: 3px; }
.options-empty { font-size: 12px; color: #94a3b8; padding: 4px 0; }

.option-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  background: #f8fafc;
}

.option-code {
  font-family: monospace; font-size: 11px; font-weight: 600;
  color: #334155; min-width: 44px;
}

.option-label-text { font-size: 12px; color: #475569; flex: 1; }
.option-actions { display: flex; gap: 0; margin-left: auto; }

.options-hint {
  font-size: 12px; color: #94a3b8;
  display: flex; align-items: center; gap: 6px;
  padding: 10px 14px;
}

.attr-add-card {
  border: 2px dashed #e2e8f0;
  border-radius: 10px;
  background: none;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 32px;
  color: #94a3b8;
  font-size: 13px;
  transition: border-color 0.15s, color 0.15s;
  min-height: 100px;
}
.attr-add-card:hover { border-color: #0891b2; color: #0891b2; }
.attr-add-card .pi { font-size: 20px; }

.fields { display: flex; flex-direction: column; gap: 14px; padding: 4px 0; }
.field  { display: flex; flex-direction: column; gap: 5px; }
.field label { font-size: 13px; font-weight: 500; color: #374151; }
.field-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #374151; }
.hint { font-size: 11px; color: #94a3b8; font-weight: 400; }
</style>
