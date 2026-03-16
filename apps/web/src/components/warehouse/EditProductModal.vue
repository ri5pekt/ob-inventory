<template>
  <Dialog
    :visible="visible"
    @update:visible="handleClose"
    header="Edit Product"
    :modal="true"
    :closable="!submitting"
    :style="{ width: '640px', maxWidth: '96vw', maxHeight: '92vh' }"
    :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
    content-style="overflow-y: auto;"
  >
    <form @submit.prevent="submit" novalidate>
      <!-- ── Product Details ── -->
      <SectionLabel>Product</SectionLabel>
      <div class="form-grid">
        <div class="field">
          <label class="field-label">SKU <span class="req">*</span></label>
          <InputText
            v-model="form.sku"
            placeholder="e.g. BGSA-RDBK-8"
            :invalid="touched.sku && !form.sku"
            class="w-full"
          />
          <span v-if="touched.sku && !form.sku" class="field-error">Required</span>
        </div>

        <div class="field">
          <label class="field-label">Name</label>
          <InputText
            v-model="form.wooTitle"
            placeholder="e.g. Pro Boxing Gloves – Red/Black 8oz"
            class="w-full"
          />
        </div>

        <div class="field">
          <label class="field-label">Brand</label>
          <Select
            v-model="form.brandId"
            :options="brands"
            option-label="name"
            option-value="id"
            placeholder="Select brand"
            :loading="catalogLoading"
            show-clear
            append-to="body"
            class="w-full"
          />
        </div>

        <div class="field">
          <label class="field-label">Category</label>
          <Select
            v-model="form.categoryId"
            :options="categories"
            option-label="name"
            option-value="id"
            placeholder="Select category"
            :loading="catalogLoading"
            show-clear
            append-to="body"
            class="w-full"
          />
        </div>
      </div>

      <!-- ── Attributes ── -->
      <SectionLabel>Attributes</SectionLabel>
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Model</label>
          <InputText v-model="form.model" placeholder="e.g. Pro, Geisha, SA…" class="w-full" />
        </div>

        <div class="field">
          <label class="field-label">Unit</label>
          <Select
            v-model="form.unitOptionId"
            :options="unitOptions"
            option-label="label"
            option-value="id"
            placeholder="Select unit"
            show-clear
            append-to="body"
            class="w-full"
          />
        </div>

        <div class="field">
          <label class="field-label">Size</label>
          <Select
            v-model="form.sizeOptionId"
            :options="sizeOptions"
            option-label="label"
            option-value="id"
            placeholder="Select size"
            show-clear
            filter
            append-to="body"
            class="w-full"
          />
        </div>

        <div class="field">
          <label class="field-label">Color</label>
          <Select
            v-model="form.colorOptionId"
            :options="colorOptions"
            option-label="label"
            option-value="id"
            placeholder="Select color"
            show-clear
            filter
            append-to="body"
            class="w-full"
          />
        </div>
      </div>

      <!-- ── Image ── -->
      <SectionLabel>Product Image</SectionLabel>
      <div class="image-section">
        <!-- Preview -->
        <div class="image-preview" :class="{ 'has-image': !!form.image }">
          <img v-if="form.image" :src="form.image" alt="Product image" class="preview-img" />
          <i v-else class="pi pi-image preview-placeholder"></i>
        </div>

        <!-- Upload zone -->
        <div class="image-upload-zone"
          :class="{ 'drag-over': isDragging }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="onDrop"
          @click="fileInputRef?.click()"
        >
          <i class="pi pi-upload"></i>
          <span>Click or drop an image</span>
          <span class="upload-hint">Auto-resized to 300×300 · JPEG</span>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            class="file-input-hidden"
            @change="onFileChange"
          />
        </div>

        <!-- Remove button -->
        <Button
          v-if="form.image"
          label="Remove image"
          icon="pi pi-trash"
          text
          severity="danger"
          size="small"
          @click="form.image = null"
        />
      </div>

      <!-- ── Pricing ── -->
      <SectionLabel>Pricing</SectionLabel>
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Cost Price</label>
          <InputNumber
            v-model="form.costPrice"
            :min="0"
            :max="999999"
            :min-fraction-digits="2"
            :max-fraction-digits="2"
            placeholder="0.00"
            class="w-full"
          />
        </div>

        <div class="field">
          <label class="field-label">Retail Price</label>
          <InputNumber
            v-model="form.retailPrice"
            :min="0"
            :max="999999"
            :min-fraction-digits="2"
            :max-fraction-digits="2"
            placeholder="0.00"
            class="w-full"
          />
        </div>
      </div>

      <!-- ── Stock ── -->
      <SectionLabel>Stock</SectionLabel>
      <div class="form-grid">
        <div class="field">
          <label class="field-label">Box #</label>
          <InputText v-model="form.boxNumber" placeholder="e.g. 12" class="w-full" />
        </div>

        <div class="field">
          <label class="field-label">Date Added</label>
          <DatePicker
            v-model="form.dateAdded"
            date-format="dd/mm/yy"
            :show-icon="true"
            :show-button-bar="true"
            placeholder="Select date"
            class="w-full"
          />
        </div>

        <div class="field">
          <label class="field-label">Quantity</label>
          <InputNumber
            v-model="form.quantity"
            :min="0"
            :max="99999"
            show-buttons
            button-layout="horizontal"
            :step="1"
            class="w-full"
          />
          <span v-if="quantityDelta !== 0" class="qty-delta" :class="quantityDelta > 0 ? 'delta-pos' : 'delta-neg'">
            {{ quantityDelta > 0 ? '+' : '' }}{{ quantityDelta }} from current
          </span>
          <p v-if="warehouseType && warehouseType !== 'main'" class="field-hint sync-hint">
            <i class="pi pi-info-circle" /> WooCommerce sync only runs for the <strong>Main</strong> warehouse. Edit the warehouse to change its type.
          </p>
        </div>
      </div>

      <!-- error banner -->
      <div v-if="errorMsg" class="error-banner">
        <i class="pi pi-exclamation-circle" />
        {{ errorMsg }}
      </div>
    </form>

    <template #footer>
      <div class="footer-row">
        <Button
          label="Remove Product"
          icon="pi pi-trash"
          text
          severity="danger"
          :disabled="submitting"
          @click="confirmRemove"
        />
        <div class="footer-actions-right">
          <Button label="Cancel" text severity="secondary" :disabled="submitting" @click="handleClose" />
          <Button
            label="Save Changes"
            icon="pi pi-check"
            :loading="submitting"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </Dialog>

  <ConfirmDialog />
</template>

<script setup lang="ts">
import { ref, computed, watch, useTemplateRef } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { useConfirm } from 'primevue/useconfirm'
import Dialog from 'primevue/dialog'
import ConfirmDialog from 'primevue/confirmdialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Button from 'primevue/button'
import DatePicker from 'primevue/datepicker'
import { defineComponent, h } from 'vue'
import { catalogApi } from '@/api/catalog'
import { updateWarehouseStock, removeWarehouseStock } from '@/api/warehouses'
import type { StockItemDTO } from '@ob-inventory/types'

const SectionLabel = defineComponent({
  setup(_, { slots }) {
    return () => h('p', { class: 'section-label' }, slots.default?.())
  },
})

const props = defineProps<{
  visible:        boolean
  warehouseId:    string
  warehouseType?: 'main' | 'partner' | 'other'
  item:           StockItemDTO | null
}>()

const emit = defineEmits<{
  (e: 'close'):   void
  (e: 'success'): void
}>()

// ── Catalog ───────────────────────────────────────────────────────────────────
const { data: brandsData,     isLoading: brandsLoading } = useQuery({ queryKey: ['brands'],      queryFn: catalogApi.getBrands })
const { data: categoriesData, isLoading: catsLoading   } = useQuery({ queryKey: ['categories'],  queryFn: catalogApi.getCategories })
const { data: attributesData, isLoading: attrsLoading  } = useQuery({ queryKey: ['attributes'],  queryFn: catalogApi.getAttributes })

const catalogLoading = computed(() => brandsLoading.value || catsLoading.value || attrsLoading.value)
const brands         = computed(() => brandsData.value     ?? [])
const categories     = computed(() => categoriesData.value ?? [])
const sizeOptions    = computed(() => attributesData.value?.find(a => a.name.toLowerCase() === 'size')?.options  ?? [])
const colorOptions   = computed(() => attributesData.value?.find(a => a.name.toLowerCase() === 'color')?.options ?? [])
const unitOptions    = computed(() => attributesData.value?.find(a => a.name.toLowerCase() === 'unit')?.options  ?? [])

// ── Form state ────────────────────────────────────────────────────────────────
function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null
  try { return new Date(iso + 'T00:00:00') } catch { return null }
}

function toISODate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const buildForm = (item: StockItemDTO | null) => ({
  sku:           item?.sku           ?? '',
  wooTitle:      item?.wooTitle      ?? item?.name ?? '',
  brandId:       item?.brandId       ?? null as string | null,
  categoryId:    item?.categoryId    ?? null as string | null,
  boxNumber:     item?.boxNumber     ?? '',
  dateAdded:     parseDate(item?.dateAdded),
  quantity:      item?.quantity      ?? 0,
  model:         item?.model         ?? '',
  sizeOptionId:  item?.sizeOptionId  ?? null as string | null,
  colorOptionId: item?.colorOptionId ?? null as string | null,
  unitOptionId:  item?.unitOptionId  ?? null as string | null,
  image:         item?.image         ?? null as string | null,
  costPrice:     item?.costPrice   != null ? parseFloat(item.costPrice)   : null as number | null,
  retailPrice:   item?.retailPrice != null ? parseFloat(item.retailPrice) : null as number | null,
})

// ── Image upload + resize ────────────────────────────────────────────────────
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInputRef')
const isDragging   = ref(false)

async function resizeImage(file: File, maxPx = 300, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = (e) => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        let { width, height } = img
        if (width > height) {
          if (width > maxPx) { height = Math.round(height * maxPx / width); width = maxPx }
        } else {
          if (height > maxPx) { width = Math.round(width * maxPx / height); height = maxPx }
        }
        const canvas = document.createElement('canvas')
        canvas.width  = width
        canvas.height = height
        canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = e.target?.result as string
    }
    reader.readAsDataURL(file)
  })
}

async function handleImageFile(file: File) {
  if (!file.type.startsWith('image/')) return
  try {
    form.value.image = await resizeImage(file)
  } catch {
    // silently ignore resize errors
  }
}

function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) handleImageFile(file)
}

function onDrop(e: DragEvent) {
  isDragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleImageFile(file)
}

const form       = ref(buildForm(null))
const touched    = ref({ sku: false })
const submitting = ref(false)
const errorMsg   = ref('')

watch(() => [props.visible, props.item] as const, ([visible]) => {
  if (visible && props.item) {
    form.value     = buildForm(props.item)
    touched.value  = { sku: false }
    errorMsg.value = ''
  }
})

const quantityDelta = computed(() =>
  props.item ? (form.value.quantity ?? 0) - props.item.quantity : 0
)

// ── Submit ────────────────────────────────────────────────────────────────────
const queryClient = useQueryClient()

async function submit() {
  touched.value = { sku: true }
  if (!form.value.sku || !props.item) return

  submitting.value = true
  errorMsg.value   = ''

  try {
    const displayName = form.value.wooTitle?.trim() || form.value.sku.trim()
    await updateWarehouseStock(props.warehouseId, props.item.productId, {
      sku:           form.value.sku.trim(),
      name:          displayName,
      wooTitle:      form.value.wooTitle?.trim() || null,
      brandId:       form.value.brandId       || null,
      categoryId:    form.value.categoryId    || null,
      boxNumber:     form.value.boxNumber     || null,
      dateAdded:     form.value.dateAdded ? toISODate(form.value.dateAdded) : null,
      quantity:      form.value.quantity ?? 0,
      model:         form.value.model         || null,
      sizeOptionId:  form.value.sizeOptionId  || null,
      colorOptionId: form.value.colorOptionId || null,
      unitOptionId:  form.value.unitOptionId  || null,
      image:         form.value.image         ?? null,
      costPrice:     form.value.costPrice     ?? null,
      retailPrice:   form.value.retailPrice   ?? null,
    })

    await queryClient.invalidateQueries({ queryKey: ['warehouse-stock', props.warehouseId] })
    emit('success')
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    errorMsg.value = msg ?? 'Something went wrong. Please try again.'
  } finally {
    submitting.value = false
  }
}

// ── Remove product ────────────────────────────────────────────────────────────
const confirm = useConfirm()

function confirmRemove() {
  if (!props.item) return
  const sku = props.item.sku
  confirm.require({
    message:     `Remove "${sku}" from this warehouse? The product will no longer appear in stock here.`,
    header:      'Remove Product',
    icon:        'pi pi-exclamation-triangle',
    rejectLabel: 'Cancel',
    acceptLabel: 'Remove',
    acceptClass: 'p-button-danger',
    accept:      async () => {
      if (!props.item) return
      submitting.value = true
      errorMsg.value   = ''
      try {
        await removeWarehouseStock(props.warehouseId, props.item.productId)
        await queryClient.invalidateQueries({ queryKey: ['warehouse-stock', props.warehouseId] })
        await queryClient.invalidateQueries({ queryKey: ['warehouses'] })
        emit('success')
        emit('close')
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        errorMsg.value = msg ?? 'Failed to remove product. Please try again.'
      } finally {
        submitting.value = false
      }
    },
  })
}

function handleClose() {
  if (!submitting.value) emit('close')
}
</script>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px 20px;
  margin-bottom: 8px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.full-col { grid-column: 1 / -1; }

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.field-hint-inline {
  font-size: 11px;
  font-weight: 400;
  color: #94a3b8;
}

.req   { color: #ef4444; }

.field-error {
  font-size: 12px;
  color: #ef4444;
}

.qty-delta {
  font-size: 12px;
  font-weight: 600;
}
.delta-pos { color: #16a34a; }
.delta-neg { color: #dc2626; }

.sync-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #64748b;
  display: flex;
  align-items: center;
  gap: 6px;
}
.sync-hint .pi { font-size: 14px; flex-shrink: 0; }

/* ── Image upload ── */
.image-section {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.image-preview {
  width: 72px;
  height: 72px;
  border-radius: 10px;
  border: 2px dashed #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  background: #f8fafc;
}
.image-preview.has-image {
  border-style: solid;
  border-color: #0891b2;
}
.preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.preview-placeholder {
  font-size: 24px;
  color: #cbd5e1;
}

.image-upload-zone {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 14px;
  border: 2px dashed #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  background: #f8fafc;
  transition: border-color 0.15s, background 0.15s;
  font-size: 13px;
  color: #64748b;
  text-align: center;
}
.image-upload-zone:hover,
.image-upload-zone.drag-over {
  border-color: #0891b2;
  background: #e0f2fe;
  color: #0369a1;
}
.image-upload-zone .pi {
  font-size: 18px;
  margin-bottom: 2px;
}
.upload-hint {
  font-size: 11px;
  color: #94a3b8;
}
.file-input-hidden {
  display: none;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
  margin: 20px 0 10px;
}
.section-label:first-child { margin-top: 4px; }

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
  margin-top: 16px;
}

.w-full { width: 100%; }

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding-top: 12px;
}

.footer-actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .form-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .image-section {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }

  .image-upload-zone {
    min-width: 0;
  }

  .footer-row {
    flex-direction: column-reverse;
    align-items: stretch;
    gap: 8px;
  }

  .footer-actions-right {
    flex-direction: column-reverse;
    gap: 8px;
  }

  .footer-row .p-button,
  .footer-actions-right .p-button {
    width: 100%;
    justify-content: center;
  }
}
</style>
