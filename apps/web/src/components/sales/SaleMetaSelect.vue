<template>
  <div class="sale-meta-select">
    <Select
      v-if="!addingNew"
      :model-value="modelValue"
      :options="allOptions"
      option-label="name"
      option-value="id"
      :placeholder="placeholder"
      :loading="loading"
      show-clear
      fluid
      append-to="body"
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <template #footer>
        <div class="add-new-row" @click.stop="startAdding">
          <i class="pi pi-plus" />
          Add new…
        </div>
      </template>
    </Select>

    <div v-else class="new-value-row">
      <InputText
        ref="newInputRef"
        v-model="newName"
        :placeholder="`New ${label.toLowerCase()}…`"
        fluid
        @keyup.enter="confirmNew"
        @keyup.escape="cancelAdding"
      />
      <Button icon="pi pi-check" size="small" :loading="creating" :disabled="!newName.trim()" @click="confirmNew" />
      <Button icon="pi pi-times" size="small" severity="secondary" outlined @click="cancelAdding" />
    </div>

    <small v-if="createError" class="create-error">{{ createError }}</small>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import type { SaleMetaItem } from '@/api/saleMeta'

const props = defineProps<{
  modelValue:  string | null | undefined
  options:     SaleMetaItem[]
  label:       string
  placeholder?: string
  loading?:    boolean
  createFn:    (name: string) => Promise<SaleMetaItem>
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string | null): void
  (e: 'created', item: SaleMetaItem): void
}>()

const addingNew   = ref(false)
const newName     = ref('')
const creating    = ref(false)
const createError = ref<string | null>(null)
const newInputRef = ref<{ $el?: HTMLElement } | null>(null)

const allOptions = computed(() => props.options)

function startAdding() {
  addingNew.value   = true
  newName.value     = ''
  createError.value = null
  nextTick(() => {
    const el = newInputRef.value?.$el ?? (newInputRef.value as unknown as HTMLInputElement)
    if (el && 'focus' in el) (el as HTMLElement).focus()
  })
}

function cancelAdding() {
  addingNew.value = false
  newName.value   = ''
}

async function confirmNew() {
  const name = newName.value.trim()
  if (!name || creating.value) return
  creating.value    = true
  createError.value = null
  try {
    const item = await props.createFn(name)
    emit('created', item)
    emit('update:modelValue', item.id)
    addingNew.value = false
    newName.value   = ''
  } catch {
    createError.value = 'Failed to create. Try again.'
  } finally {
    creating.value = false
  }
}
</script>

<style scoped>
.sale-meta-select { display: flex; flex-direction: column; gap: 4px; }

.add-new-row {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 500;
  color: var(--p-primary-color);
  cursor: pointer;
  border-top: 1px solid var(--p-content-border-color);
  transition: background 0.1s;
}

.add-new-row:hover { background: var(--p-primary-50, #eff6ff); }
.add-new-row .pi   { font-size: 11px; }

.new-value-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.create-error {
  color: var(--p-red-500);
  font-size: 11px;
}
</style>
