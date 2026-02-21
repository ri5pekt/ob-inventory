<template>
  <Dialog
    :visible="visible"
    @update:visible="$emit('update:visible', $event)"
    header="Edit Warehouse"
    modal
    :draggable="false"
    :style="{ width: '500px' }"
    :breakpoints="{ '540px': '95vw' }"
  >
    <form class="edit-form" @submit.prevent="save">

      <!-- Name -->
      <div class="field">
        <label class="field-label">Name <span class="req">*</span></label>
        <InputText v-model="form.name" placeholder="Warehouse name" class="w-full" />
      </div>

      <!-- Type -->
      <div class="field">
        <label class="field-label">Type</label>
        <Select v-model="form.type" :options="typeOptions" option-label="label" option-value="value" class="w-full" />
      </div>

      <!-- Icon / Logo -->
      <div class="field">
        <label class="field-label">Icon / Logo</label>

        <!-- Logo upload area -->
        <div
          class="logo-drop"
          :class="{ 'has-logo': !!form.logo, 'drag-over': dragging }"
          @click="triggerLogoUpload"
          @dragover.prevent="dragging = true"
          @dragleave="dragging = false"
          @drop.prevent="handleLogoDrop"
        >
          <img v-if="form.logo" :src="form.logo" class="logo-preview-img" alt="Warehouse logo" />
          <div v-else class="logo-placeholder">
            <i class="pi pi-image"></i>
            <span>Click or drag & drop to upload logo</span>
            <span class="logo-sub">PNG, JPG, SVG · auto-resized to 80×80 px</span>
          </div>
          <button v-if="form.logo" type="button" class="logo-remove" @click.stop="form.logo = null" title="Remove logo">
            <i class="pi pi-times"></i>
          </button>
        </div>
        <input ref="logoInput" type="file" accept="image/*" class="hidden-input" @change="handleLogoFile" />

        <!-- Icon grid (used when no logo) -->
        <div class="icon-section" :class="{ 'icon-faded': !!form.logo }">
          <span class="icon-section-label">Fallback icon (used when no logo is set)</span>
          <div class="icon-grid">
            <button
              v-for="ic in iconOptions"
              :key="ic"
              type="button"
              class="icon-cell"
              :class="{ selected: form.icon === ic && !form.logo }"
              :title="ic"
              :disabled="!!form.logo"
              @click="form.icon = ic"
            >
              <i :class="`pi ${ic}`"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Color -->
      <div class="field">
        <label class="field-label">Header Color</label>
        <div class="color-row">
          <button
            v-for="c in colorPalette"
            :key="c.value"
            type="button"
            class="color-swatch"
            :title="c.label"
            :style="{ background: c.value }"
            :class="{ selected: form.color === c.value }"
            @click="form.color = c.value"
          >
            <i v-if="form.color === c.value" class="pi pi-check"></i>
          </button>

          <!-- Custom color trigger -->
          <button
            type="button"
            class="color-swatch color-custom"
            :class="{ selected: isCustomColor }"
            :style="isCustomColor ? { background: form.color } : {}"
            title="Custom color"
            @click="openCustomColor"
          >
            <i v-if="isCustomColor" class="pi pi-check"></i>
            <i v-else class="pi pi-palette"></i>
          </button>
          <input
            ref="colorInput"
            type="color"
            class="hidden-input"
            :value="form.color"
            @input="form.color = ($event.target as HTMLInputElement).value"
          />
        </div>

        <!-- Live preview -->
        <div class="color-preview" :style="{ background: form.color }">
          <img v-if="form.logo" :src="form.logo" class="preview-logo" alt="" />
          <i v-else :class="`pi ${form.icon}`" class="preview-icon"></i>
          <span>{{ form.name || 'Warehouse Name' }}</span>
        </div>
      </div>

      <!-- Notes -->
      <div class="field">
        <label class="field-label">Notes</label>
        <Textarea v-model="form.notes" rows="2" auto-resize class="w-full" />
      </div>

      <div v-if="errorMsg" class="error-banner">
        <i class="pi pi-exclamation-circle" /> {{ errorMsg }}
      </div>
    </form>

    <template #footer>
      <Button label="Cancel" text severity="secondary" @click="$emit('update:visible', false)" />
      <Button label="Save Changes" icon="pi pi-check" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQueryClient } from '@tanstack/vue-query'
import Dialog    from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select    from 'primevue/select'
import Textarea  from 'primevue/textarea'
import { updateWarehouse } from '@/api/warehouses'
import type { WarehouseDTO, WarehouseType } from '@ob-inventory/types'

const props = defineProps<{
  visible:   boolean
  warehouse: WarehouseDTO | null | undefined
}>()

const emit = defineEmits<{
  'update:visible': [val: boolean]
  saved: [wh: WarehouseDTO]
}>()

const qc       = useQueryClient()
const saving   = ref(false)
const errorMsg = ref('')
const dragging = ref(false)
const logoInput  = ref<HTMLInputElement | null>(null)
const colorInput = ref<HTMLInputElement | null>(null)

const form = ref({
  name:  '',
  type:  'other' as WarehouseType,
  notes: '',
  color: '#94a3b8',
  icon:  'pi-building',
  logo:  null as string | null,
})

watch(() => props.warehouse, (wh) => {
  if (wh) {
    form.value = {
      name:  wh.name,
      type:  wh.type,
      notes: wh.notes ?? '',
      color: wh.color ?? '#94a3b8',
      icon:  wh.icon  ?? 'pi-building',
      logo:  wh.logo  ?? null,
    }
    errorMsg.value = ''
  }
}, { immediate: true })

// ── Options ──────────────────────────────────────────────────────────────────
const typeOptions = [
  { label: 'Main',    value: 'main'    },
  { label: 'Partner', value: 'partner' },
  { label: 'Other',   value: 'other'   },
]

const iconOptions = [
  'pi-building', 'pi-box', 'pi-home', 'pi-briefcase',
  'pi-truck', 'pi-shopping-bag', 'pi-map-marker', 'pi-server',
  'pi-folder', 'pi-archive', 'pi-star', 'pi-globe',
  'pi-warehouse', 'pi-tag', 'pi-send', 'pi-shop',
]

const colorPalette = [
  { label: 'Gray',    value: '#94a3b8' },
  { label: 'Slate',   value: '#64748b' },
  { label: 'Blue',    value: '#3b82f6' },
  { label: 'Cyan',    value: '#06b6d4' },
  { label: 'Teal',    value: '#14b8a6' },
  { label: 'Green',   value: '#22c55e' },
  { label: 'Emerald', value: '#10b981' },
  { label: 'Lime',    value: '#84cc16' },
  { label: 'Yellow',  value: '#eab308' },
  { label: 'Orange',  value: '#f97316' },
  { label: 'Red',     value: '#ef4444' },
  { label: 'Rose',    value: '#f43f5e' },
  { label: 'Pink',    value: '#ec4899' },
  { label: 'Purple',  value: '#a855f7' },
  { label: 'Indigo',  value: '#6366f1' },
  { label: 'Violet',  value: '#8b5cf6' },
]

const isCustomColor = computed(() => !colorPalette.some(c => c.value === form.value.color))

function openCustomColor() {
  colorInput.value?.click()
}

// ── Logo upload ───────────────────────────────────────────────────────────────
function triggerLogoUpload() {
  logoInput.value?.click()
}

function handleLogoFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) resizeAndSet(file)
  ;(e.target as HTMLInputElement).value = ''
}

function handleLogoDrop(e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) resizeAndSet(file)
}

function resizeAndSet(file: File) {
  const isPng = file.type === 'image/png' || file.type === 'image/svg+xml' || file.type === 'image/webp'
  const reader = new FileReader()
  reader.onload = (ev) => {
    const img = new Image()
    img.onload = () => {
      const SIZE = 80
      const canvas = document.createElement('canvas')
      canvas.width = SIZE; canvas.height = SIZE
      const ctx = canvas.getContext('2d')!
      // For non-transparent formats, fill white first so we never get black pixels
      if (!isPng) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, SIZE, SIZE)
      }
      // Crop to square from centre
      const side = Math.min(img.width, img.height)
      const sx   = (img.width  - side) / 2
      const sy   = (img.height - side) / 2
      ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
      // Use PNG to preserve transparency, JPEG for photos
      form.value.logo = isPng
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', 0.88)
    }
    img.src = ev.target?.result as string
  }
  reader.readAsDataURL(file)
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function save() {
  if (!form.value.name.trim() || !props.warehouse) return
  saving.value   = true
  errorMsg.value = ''
  try {
    const updated = await updateWarehouse(props.warehouse.id, {
      name:  form.value.name.trim(),
      type:  form.value.type,
      notes: form.value.notes || null,
      color: form.value.color,
      icon:  form.value.icon,
      logo:  form.value.logo,
    })
    await qc.invalidateQueries({ queryKey: ['warehouses'] })
    emit('saved', updated)
    emit('update:visible', false)
  } catch (err: unknown) {
    errorMsg.value = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to save'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-top: 6px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.req { color: #dc2626; }

/* ── Logo drop zone ── */
.logo-drop {
  position: relative;
  border: 2px dashed #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  min-height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.logo-drop:hover, .logo-drop.drag-over {
  border-color: #0891b2;
  background: #ecfeff;
}
.logo-drop.has-logo { border-style: solid; border-color: #e2e8f0; }

.logo-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 16px;
  color: #94a3b8;
  pointer-events: none;
}
.logo-placeholder .pi { font-size: 22px; }
.logo-placeholder span { font-size: 13px; font-weight: 500; color: #64748b; }
.logo-sub { font-size: 11px !important; color: #94a3b8 !important; font-weight: 400 !important; }

.logo-preview-img {
  width: 80px;
  height: 80px;
  object-fit: cover;
  border-radius: 8px;
  display: block;
  margin: 10px;
}

.logo-remove {
  position: absolute;
  top: 6px; right: 6px;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.45);
  color: #fff;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  transition: background 0.12s;
}
.logo-remove:hover { background: #ef4444; }

/* ── Icon section ── */
.icon-section {
  margin-top: 4px;
  transition: opacity 0.2s;
}
.icon-section.icon-faded { opacity: 0.35; pointer-events: none; }

.icon-section-label {
  font-size: 11px;
  color: #94a3b8;
  font-weight: 500;
  display: block;
  margin-bottom: 6px;
}

.icon-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.icon-cell {
  width: 34px; height: 34px;
  border-radius: 8px;
  border: 2px solid #e2e8f0;
  background: #f8fafc;
  color: #64748b;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: border-color 0.12s, color 0.12s, background 0.12s;
}
.icon-cell:not(:disabled):hover { border-color: #0891b2; color: #0891b2; background: #ecfeff; }
.icon-cell.selected             { border-color: #0891b2; background: #0891b2; color: #fff; }

/* ── Color row ── */
.color-row {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  align-items: center;
}

.color-swatch {
  width: 28px; height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #fff;
  transition: transform 0.12s, box-shadow 0.12s;
  outline: none;
  flex-shrink: 0;
}
.color-swatch:hover  { transform: scale(1.15); box-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.color-swatch.selected { border-color: #0f172a; transform: scale(1.1); }

/* Custom picker swatch — rainbow gradient when no custom color is set */
.color-custom {
  background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red);
  color: #fff;
}
.color-custom.selected {
  /* background comes from inline :style when a custom color is active */
  border-color: #0f172a;
}
.color-custom .pi { filter: drop-shadow(0 0 2px rgba(0,0,0,0.6)); font-size: 13px; }

/* ── Preview strip ── */
.color-preview {
  margin-top: 8px;
  border-radius: 10px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  transition: background 0.2s;
  min-height: 56px;
}
.preview-logo {
  width: 44px; height: 44px;
  object-fit: contain;
  border-radius: 8px;
  flex-shrink: 0;
  background: #fff;
  padding: 4px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.15);
}
.preview-icon { font-size: 18px; }

/* ── Error ── */
.error-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
}

.hidden-input { display: none; }
.w-full { width: 100%; }
</style>
