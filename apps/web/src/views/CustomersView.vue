<template>
  <div class="customers-view">
    <!-- Header -->
    <div class="view-header">
      <div class="header-left">
        <i class="pi pi-id-card header-icon" />
        <div>
          <h2 class="view-title">Customers</h2>
          <span class="view-subtitle">Manage your customer contacts</span>
        </div>
      </div>
      <Button label="New Customer" icon="pi pi-plus" size="small" class="btn-new" @click="showCreate = true" />
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search-wrap">
        <InputText
          v-model="search"
          placeholder="Search by name, company, email, phone…"
          size="small"
          class="search-input"
        />
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <DataTable
        :value="filteredCustomers"
        :loading="isLoading"
        striped-rows
        size="small"
        paginator
        paginator-template="RowsPerPageDropdown FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink"
        :rows="50"
        :rows-per-page-options="[25, 50, 100]"
        scrollable
        scroll-height="flex"
        row-hover
        class="customers-datatable"
        @row-click="openDetail($event.data)"
      >
        <Column field="name" header="Name" :frozen="!isMobile" sortable class="col-name">
          <template #body="{ data }">
            <span class="name-text">{{ data.name }}</span>
          </template>
        </Column>

        <Column field="company" header="Company" class="col-company">
          <template #body="{ data }">
            <span v-if="data.company" class="company-text">{{ data.company }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="email" header="Email" class="col-email">
          <template #body="{ data }">
            <a v-if="data.email" :href="`mailto:${data.email}`" class="email-link" @click.stop>{{ data.email }}</a>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="phone" header="Phone" class="col-phone">
          <template #body="{ data }">
            <a v-if="data.phone" :href="`tel:${data.phone}`" class="phone-link" @click.stop>{{ data.phone }}</a>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="idNumber" header="ID / ח.פ." class="col-id hide-mobile-sm">
          <template #body="{ data }">
            <span v-if="data.idNumber" class="id-text">{{ data.idNumber }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="address" header="Address" class="col-address hide-mobile-sm">
          <template #body="{ data }">
            <span v-if="data.address" class="address-text">{{ data.address }}</span>
            <span v-else class="no-value">—</span>
          </template>
        </Column>

        <Column field="createdAt" header="Added" :frozen="!isMobile" align-frozen="right" sortable class="col-date">
          <template #body="{ data }">
            <span class="date-text">{{ formatDate(data.createdAt) }}</span>
          </template>
        </Column>

        <template #empty>
          <div class="empty-state">
            <i class="pi pi-id-card empty-icon" />
            <p>No customers yet</p>
            <p class="empty-sub">Click "New Customer" to add your first contact</p>
          </div>
        </template>
      </DataTable>
    </div>

    <CustomerDetailDialog
      v-model:visible="showDetail"
      :customer="selectedCustomer"
      @deleted="onCustomerDeleted"
      @edited="onCustomerEdited"
    />

    <CustomerFormModal
      v-model="showCreate"
      mode="create"
      @saved="onCustomerCreated"
    />

    <CustomerFormModal
      v-model="showEdit"
      mode="edit"
      :customer="editingCustomer"
      @saved="onCustomerUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useQuery } from '@tanstack/vue-query'
import { getCustomers, getCustomer, type Customer } from '@/api/customers'
import CustomerDetailDialog from '@/components/customers/CustomerDetailDialog.vue'
import CustomerFormModal    from '@/components/customers/CustomerFormModal.vue'

const showCreate       = ref(false)
const showEdit         = ref(false)
const editingCustomer  = ref<Customer | null>(null)
const showDetail       = ref(false)
const selectedCustomer = ref<Customer | null>(null)
const search           = ref('')
const refreshKey       = ref(0)

const isMobile   = ref(false)
const mobileQuery = window.matchMedia('(max-width: 768px)')
function setMobile() { isMobile.value = mobileQuery.matches }
onMounted(() => { setMobile(); mobileQuery.addEventListener('change', setMobile) })
onUnmounted(() => mobileQuery.removeEventListener('change', setMobile))

const { data: customersData, isLoading } = useQuery({
  queryKey: computed(() => ['customers', refreshKey.value]),
  queryFn:  () => getCustomers({ limit: 1000 }),
})

const customers = computed(() => customersData.value ?? [])

const filteredCustomers = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return customers.value
  return customers.value.filter(c =>
    c.name?.toLowerCase().includes(q) ||
    c.company?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q) ||
    c.phone?.toLowerCase().includes(q) ||
    c.address?.toLowerCase().includes(q) ||
    c.idNumber?.toLowerCase().includes(q) ||
    c.notes?.toLowerCase().includes(q),
  )
})

async function openDetail(customer: Customer) {
  selectedCustomer.value = null
  showDetail.value = true
  selectedCustomer.value = await getCustomer(customer.id)
}

function onCustomerDeleted() {
  selectedCustomer.value = null
  refreshKey.value++
}

function onCustomerEdited(customer: Customer) {
  editingCustomer.value = customer
  showDetail.value = false
  showEdit.value = true
}

function onCustomerCreated() {
  refreshKey.value++
}

function onCustomerUpdated() {
  showEdit.value = false
  editingCustomer.value = null
  refreshKey.value++
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}
</script>

<style scoped>
.customers-view {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.view-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.header-left { display: flex; align-items: center; gap: 14px; min-width: 0; }
.header-icon { font-size: 26px; color: var(--p-primary-color); flex-shrink: 0; }
.view-title  { margin: 0; font-size: 22px; font-weight: 700; }
.view-subtitle { font-size: 13px; color: var(--p-text-muted-color); }

.btn-new :deep(.p-button-label) { white-space: nowrap; }

.toolbar { display: flex; align-items: center; gap: 8px; }
.search-wrap { width: 320px; }
.search-input { width: 100%; }

.table-card {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--p-surface-card);
  border: 1px solid var(--p-content-border-color);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
}

:deep(.customers-datatable .p-datatable-table) { min-width: 740px; }

:deep(.customers-datatable .p-datatable-tbody .p-frozen-column),
:deep(.customers-datatable .p-datatable-thead .p-frozen-column) { background: #fff; }
:deep(.customers-datatable tr.p-row-odd .p-frozen-column) { background: var(--p-datatable-row-striped-background, #fafafa); }
:deep(.customers-datatable tr:hover .p-frozen-column) { background: var(--p-datatable-row-hover-background, #f1f5f9); }

:deep(.col-name) { width: 180px; min-width: 160px; }
:deep(.col-company) { min-width: 140px; }
:deep(.col-email)   { min-width: 180px; }
:deep(.col-phone)   { width: 130px; min-width: 110px; }
:deep(.col-id)      { width: 110px; min-width: 90px; }
:deep(.col-address) { min-width: 160px; }
:deep(.col-date)    { width: 110px; min-width: 100px; }

.name-text    { font-weight: 600; font-size: 13px; }
.company-text { font-size: 12px; color: var(--p-text-color); }
.email-link   { font-size: 12px; color: var(--p-primary-color); text-decoration: none; }
.email-link:hover { text-decoration: underline; }
.phone-link   { font-size: 12px; color: var(--p-primary-color); text-decoration: none; }
.phone-link:hover { text-decoration: underline; }
.id-text      { font-family: monospace; font-size: 12px; }
.address-text { font-size: 12px; color: var(--p-text-muted-color); }
.date-text    { font-size: 12px; white-space: nowrap; color: var(--p-text-muted-color); }
.no-value     { color: var(--p-text-muted-color); }

.empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px 20px; color: var(--p-text-muted-color); }
.empty-icon  { font-size: 40px; margin-bottom: 12px; opacity: 0.3; }
.empty-sub   { font-size: 13px; }

:deep(.customers-datatable .p-paginator) { padding: 6px 8px; }

/* ═══════════════════════════════════════════════
   MOBILE  ≤ 768px
════════════════════════════════════════════════ */
@media (max-width: 768px) {
  .customers-view { gap: 10px; }
  .view-title     { font-size: 18px; }
  .view-subtitle  { font-size: 12px; }
  .header-left .header-icon { display: none; }
  .view-header .p-button-label { display: none; }

  .search-wrap { flex: 1; min-width: 0; width: auto; }

  :deep(.customers-datatable .p-datatable-tbody td),
  :deep(.customers-datatable .p-datatable-thead th) { padding: 6px 8px; font-size: 12px; }
}

@media (max-width: 480px) {
  .customers-view { gap: 8px; }
  .view-title     { font-size: 16px; }

  :deep(.col-address),
  :deep(.col-id) { display: none; }
}
</style>
