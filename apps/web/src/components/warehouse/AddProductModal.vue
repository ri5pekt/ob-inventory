<template>
  <Dialog
    :visible="visible"
    @update:visible="handleClose"
    header="Add Product to Warehouse"
    :modal="true"
    :closable="!submitting"
    :style="{ width: '640px' }"
    :breakpoints="{ '700px': '95vw' }"
    class="add-product-dialog"
  >
    <form @submit.prevent="submit" novalidate>
      <!-- ── Product Details ──────────────────────────────────────── -->
      <section-label>Product</section-label>
      <div class="form-grid">
        <div class="field">
          <label class="field-label">SKU <span class="req">*</span></label>
          <SkuAutocompleteInput
            v-model="form.sku"
            :invalid="touched.sku && !form.sku"
            @select="onProductAutofill"
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
            class="w-full"
          />
        </div>
      </div>

      <!-- ── Attributes ───────────────────────────────────────────── -->
      <section-label>Attributes</section-label>
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
            class="w-full"
          />
        </div>
      </div>

      <!-- ── Pricing ──────────────────────────────────────────────── -->
      <section-label>Pricing</section-label>
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

      <!-- ── Warehouse / Stock ─────────────────────────────────────── -->
      <section-label>Stock</section-label>
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
          <label class="field-label">Initial Quantity</label>
          <InputNumber
            v-model="form.quantity"
            :min="0"
            :max="99999"
            show-buttons
            button-layout="horizontal"
            :step="1"
            class="w-full"
          />
        </div>
      </div>

      <!-- error banner -->
      <div v-if="errorMsg" class="error-banner">
        <i class="pi pi-exclamation-circle" />
        {{ errorMsg }}
      </div>
    </form>

    <template #footer>
      <Button label="Cancel" text severity="secondary" :disabled="submitting" @click="handleClose" />
      <Button
        label="Add Product"
        icon="pi pi-plus"
        :loading="submitting"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import InputNumber from 'primevue/inputnumber'
import Select from 'primevue/select'
import Button from 'primevue/button'
import DatePicker from 'primevue/datepicker'
import { catalogApi } from '@/api/catalog'
import { addProductToWarehouse } from '@/api/warehouses'
import { type CatalogSearchResult } from '@/api/transfers'
import SkuAutocompleteInput from '@/components/warehouse/SkuAutocompleteInput.vue'

// ── Tiny helper component ─────────────────────────────────────────────────────
import { defineComponent, h } from 'vue'
const SectionLabel = defineComponent({
  setup(_, { slots }) {
    return () => h('p', { class: 'section-label' }, slots.default?.())
  },
})

const props = defineProps<{
  visible: boolean
  warehouseId: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success'): void
}>()

// ── Catalog data ──────────────────────────────────────────────────────────────
const { data: brandsData, isLoading: brandsLoading } = useQuery({
  queryKey: ['brands'],
  queryFn: catalogApi.getBrands,
})
const { data: categoriesData, isLoading: catsLoading } = useQuery({
  queryKey: ['categories'],
  queryFn: catalogApi.getCategories,
})
const { data: attributesData, isLoading: attrsLoading } = useQuery({
  queryKey: ['attributes'],
  queryFn: catalogApi.getAttributes,
})

const catalogLoading = computed(() => brandsLoading.value || catsLoading.value || attrsLoading.value)
const brands     = computed(() => brandsData.value     ?? [])
const categories = computed(() => categoriesData.value ?? [])

const sizeOptions  = computed(() => attributesData.value?.find(a => a.name.toLowerCase() === 'size')?.options  ?? [])
const colorOptions = computed(() => attributesData.value?.find(a => a.name.toLowerCase() === 'color')?.options ?? [])
const unitOptions  = computed(() => attributesData.value?.find(a => a.name.toLowerCase() === 'unit')?.options  ?? [])

// ── Form state ────────────────────────────────────────────────────────────────
const emptyForm = () => ({
  sku:           '',
  wooTitle:      '',
  brandId:       null as string | null,
  categoryId:    null as string | null,
  boxNumber:     '',
  dateAdded:     new Date() as Date | null,
  quantity:      0,
  model:         '',
  sizeOptionId:  null as string | null,
  colorOptionId: null as string | null,
  unitOptionId:  null as string | null,
  costPrice:     null as number | null,
  retailPrice:   null as number | null,
})

const form     = ref(emptyForm())
const touched  = ref({ sku: false })
const submitting = ref(false)
const errorMsg   = ref('')

watch(() => props.visible, (v) => {
  if (v) {
    form.value    = emptyForm()
    touched.value = { sku: false }
    errorMsg.value = ''
  }
})

// ── Autofill from catalog search ──────────────────────────────────────────────

function onProductAutofill(result: CatalogSearchResult) {
  form.value.sku          = result.sku
  form.value.wooTitle     = result.wooTitle     ?? result.name ?? ''
  form.value.brandId      = result.brandId      ?? null
  form.value.categoryId   = result.categoryId   ?? null
  form.value.model        = result.model        ?? ''
  form.value.sizeOptionId  = result.sizeOptionId  ?? null
  form.value.colorOptionId = result.colorOptionId ?? null
  form.value.unitOptionId  = result.unitOptionId  ?? null
  form.value.costPrice    = result.costPrice    != null ? parseFloat(result.costPrice)    : null
  form.value.retailPrice  = result.retailPrice  != null ? parseFloat(result.retailPrice)  : null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toISODate(d: Date): string {
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

// ── Submit ────────────────────────────────────────────────────────────────────
const queryClient = useQueryClient()

async function submit() {
  touched.value = { sku: true }
  if (!form.value.sku) return

  submitting.value = true
  errorMsg.value   = ''

  try {
    const displayName = form.value.wooTitle?.trim() || form.value.sku.trim()
    await addProductToWarehouse(props.warehouseId, {
      sku:          form.value.sku.trim(),
      name:         displayName,
      wooTitle:     form.value.wooTitle?.trim() || null,
      brandId:      form.value.brandId      || null,
      categoryId:   form.value.categoryId   || null,
      boxNumber:    form.value.boxNumber    || null,
      dateAdded:    form.value.dateAdded ? toISODate(form.value.dateAdded) : null,
      quantity:     form.value.quantity,
      model:        form.value.model        || null,
      sizeOptionId: form.value.sizeOptionId  || null,
      colorOptionId:form.value.colorOptionId || null,
      unitOptionId: form.value.unitOptionId  || null,
      costPrice:    form.value.costPrice    ?? null,
      retailPrice:  form.value.retailPrice  ?? null,
    })

    await queryClient.invalidateQueries({ queryKey: ['warehouse-stock', props.warehouseId] })
    await queryClient.invalidateQueries({ queryKey: ['warehouses'] })
    emit('success')
    emit('close')
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    errorMsg.value = msg ?? 'Something went wrong. Please try again.'
  } finally {
    submitting.value = false
  }
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

@media (max-width: 520px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
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

.req {
  color: #ef4444;
}

.field-error {
  font-size: 12px;
  color: #ef4444;
}

.section-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #94a3b8;
  margin: 20px 0 10px;
}
.section-label:first-child {
  margin-top: 4px;
}

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

.w-full {
  width: 100%;
}
</style>
