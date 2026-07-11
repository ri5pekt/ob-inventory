<template>
  <Dialog
    :visible="modelValue"
    @update:visible="$emit('update:modelValue', $event)"
    modal
    :header="mode === 'create' ? 'New Customer' : 'Edit Customer'"
    :style="{ width: '520px', maxWidth: '95vw' }"
    :closable="!saving"
  >
    <form class="customer-form" @submit.prevent="submit">
      <div class="form-row">
        <div class="field field-required">
          <label>Name</label>
          <InputText v-model="form.name" placeholder="Full name or business name" fluid :invalid="!!errors.name" />
          <small v-if="errors.name" class="field-error">{{ errors.name }}</small>
        </div>
        <div class="field">
          <label>Company</label>
          <InputText v-model="form.company" placeholder="Optional" fluid />
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label>Email</label>
          <InputText v-model="form.email" type="email" placeholder="Optional" fluid :invalid="!!errors.email" />
          <small v-if="errors.email" class="field-error">{{ errors.email }}</small>
        </div>
        <div class="field">
          <label>Phone</label>
          <InputText v-model="form.phone" type="tel" placeholder="Optional" fluid />
        </div>
      </div>

      <div class="form-row">
        <div class="field">
          <label>ID / ח.פ.</label>
          <InputText v-model="form.idNumber" placeholder="ת.ז. or ח.פ. — optional" fluid />
        </div>
      </div>

      <div class="form-row">
        <div class="field field-full">
          <label>Address</label>
          <InputText v-model="form.address" placeholder="Street, city, zip — optional" fluid />
        </div>
      </div>

      <div class="form-row">
        <div class="field field-full">
          <label>Notes</label>
          <Textarea v-model="form.notes" rows="3" placeholder="Internal notes — optional" fluid />
        </div>
      </div>

      <Message v-if="saveError" severity="error" :closable="false" class="save-error">{{ saveError }}</Message>
    </form>

    <template #footer>
      <Button label="Cancel" severity="secondary" outlined size="small" :disabled="saving" @click="$emit('update:modelValue', false)" />
      <Button
        :label="mode === 'create' ? 'Create Customer' : 'Save Changes'"
        icon="pi pi-check"
        size="small"
        :loading="saving"
        @click="submit"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Customer, CustomerForm } from '@/api/customers'
import { createCustomer, updateCustomer } from '@/api/customers'

const props = defineProps<{
  modelValue: boolean
  mode:       'create' | 'edit'
  customer?:  Customer | null
}>()

const emit = defineEmits<{
  'update:modelValue': [val: boolean]
  'saved': [customer: Customer]
}>()

const blankForm = (): CustomerForm => ({
  name: '', email: '', phone: '', address: '', company: '', idNumber: '', notes: '',
})

const form      = ref<CustomerForm>(blankForm())
const errors    = ref<Partial<Record<keyof CustomerForm, string>>>({})
const saving    = ref(false)
const saveError = ref<string | null>(null)

watch(() => props.modelValue, (open) => {
  if (!open) return
  saveError.value = null
  errors.value    = {}
  if (props.mode === 'edit' && props.customer) {
    form.value = {
      name:     props.customer.name,
      email:    props.customer.email    ?? '',
      phone:    props.customer.phone    ?? '',
      address:  props.customer.address  ?? '',
      company:  props.customer.company  ?? '',
      idNumber: props.customer.idNumber ?? '',
      notes:    props.customer.notes    ?? '',
    }
  } else {
    form.value = blankForm()
  }
})

function validate(): boolean {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = 'Name is required'
  if (form.value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email)) {
    errors.value.email = 'Enter a valid email address'
  }
  return Object.keys(errors.value).length === 0
}

async function submit() {
  if (!validate()) return
  saving.value    = true
  saveError.value = null
  try {
    let result: Customer
    if (props.mode === 'create') {
      result = await createCustomer(form.value)
    } else {
      result = await updateCustomer(props.customer!.id, form.value)
    }
    emit('update:modelValue', false)
    emit('saved', result)
  } catch {
    saveError.value = 'Failed to save customer. Please try again.'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.customer-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 4px;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.field-full { grid-column: 1 / -1; }

.field label {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.field-required label::after {
  content: ' *';
  color: var(--p-red-500);
}

.field-error {
  color: var(--p-red-500);
  font-size: 11px;
}

.save-error { margin-top: 4px; }

@media (max-width: 480px) {
  .form-row { grid-template-columns: 1fr; }
}
</style>
