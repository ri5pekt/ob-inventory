<template>
  <div class="users-view">

    <!-- ── Header ── -->
    <div class="page-header">
      <div>
        <h2 class="page-title">User Management</h2>
        <p class="page-desc">Add and manage system users</p>
      </div>
    </div>

    <AddUserForm @created="qc.invalidateQueries({ queryKey: ['users'] })" />

    <!-- ── Users table ── -->
    <div class="table-section">
      <h3 class="card-title">All Users</h3>

      <div class="table-wrap">
        <DataTable
          class="users-datatable"
          :value="users"
          :loading="loading"
          size="small"
          striped-rows
        >
          <template #empty>
            <div class="table-empty"><i class="pi pi-users" /> No users found</div>
          </template>

          <Column field="name" header="Name" sortable style="min-width: 160px" />

          <Column field="email" header="Email" sortable style="min-width: 200px">
            <template #body="{ data }">
              <span class="email-text">{{ data.email }}</span>
            </template>
          </Column>

          <Column field="role" header="Type" sortable style="width: 150px">
            <template #body="{ data }">
              <span class="role-badge" :class="`role-${data.role}`">
                {{ data.role === 'admin' ? 'Main Admin' : 'Warehouse Admin' }}
              </span>
            </template>
          </Column>

          <Column header="Warehouses" style="min-width: 180px">
            <template #body="{ data }">
              <span v-if="data.role === 'admin'" class="muted">All</span>
              <span v-else-if="data.warehouseIds.length === 0" class="muted none">None assigned</span>
              <div v-else class="wh-chips">
                <span
                  v-for="id in data.warehouseIds"
                  :key="id"
                  class="wh-chip"
                >{{ warehouseNameById(id) }}</span>
              </div>
            </template>
          </Column>

          <Column field="createdAt" header="Created" sortable style="width: 130px">
            <template #body="{ data }">
              <span class="muted">{{ formatDate(data.createdAt) }}</span>
            </template>
          </Column>

          <Column header="Actions" style="width: 120px; text-align: center">
            <template #body="{ data }">
              <div class="action-row">
                <Button
                  icon="pi pi-pencil"
                  text
                  rounded
                  size="small"
                  severity="secondary"
                  title="Edit user"
                  @click="openEdit(data)"
                />
                <Button
                  v-if="data.id !== meId"
                  icon="pi pi-trash"
                  text
                  rounded
                  size="small"
                  severity="danger"
                  title="Delete user"
                  :loading="deletingId === data.id"
                  @click="confirmDelete(data)"
                />
              </div>
            </template>
          </Column>
        </DataTable>
      </div>
    </div>

    <!-- ── Edit dialog ── -->
    <Dialog
      :visible="editVisible"
      @update:visible="editVisible = false"
      header="Edit User"
      :modal="true"
      :style="{ width: '480px' }"
      :breakpoints="{ '768px': 'calc(100vw - 24px)', '480px': 'calc(100vw - 16px)' }"
      content-style="overflow-y: auto;"
    >
      <form @submit.prevent="submitEdit" novalidate class="edit-form">
        <div class="field">
          <label class="field-label">Display Name</label>
          <InputText v-model="editForm.name" class="w-full" />
        </div>
        <div class="field">
          <label class="field-label">Email</label>
          <InputText v-model="editForm.email" type="email" class="w-full" />
        </div>

        <div class="field">
          <label class="field-label">User Type</label>
          <div class="type-toggle">
            <button
              type="button"
              class="type-btn"
              :class="{ active: editForm.role === 'admin' }"
              @click="editForm.role = 'admin'"
            >
              <i class="pi pi-shield" />
              Main Admin
            </button>
            <button
              type="button"
              class="type-btn"
              :class="{ active: editForm.role === 'warehouse_admin' }"
              @click="editForm.role = 'warehouse_admin'"
            >
              <i class="pi pi-building" />
              Warehouse Admin
            </button>
          </div>
        </div>

        <div v-if="editForm.role === 'warehouse_admin'" class="field">
          <label class="field-label">Assigned Warehouses</label>
          <MultiSelect
            v-model="editForm.warehouseIds"
            :options="warehouseList ?? []"
            option-label="name"
            option-value="id"
            placeholder="Select warehouses..."
            class="w-full"
            append-to="body"
            display="chip"
          />
        </div>

        <div class="field">
          <label class="field-label">New Password <span class="muted">(leave blank to keep current)</span></label>
          <div class="pass-row">
            <InputText
              v-model="editForm.password"
              :type="showEditPass ? 'text' : 'password'"
              placeholder="Leave blank to keep"
              class="w-full"
            />
            <Button icon="pi pi-eye" text severity="secondary" size="small" @click="showEditPass = !showEditPass" />
            <Button icon="pi pi-refresh" text severity="secondary" size="small" @click="editForm.password = genPass()" />
          </div>
        </div>
        <div v-if="editError" class="error-banner" style="margin-top:12px">
          <i class="pi pi-exclamation-circle" /> {{ editError }}
        </div>
      </form>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="editVisible = false" />
        <Button label="Save Changes" icon="pi pi-check" :loading="saving" @click="submitEdit" />
      </template>
    </Dialog>

    <!-- ── Confirm delete dialog ── -->
    <Dialog
      :visible="deleteTarget !== null"
      @update:visible="deleteTarget = null"
      header="Delete User"
      :modal="true"
      :style="{ width: '400px' }"
      :breakpoints="{ '480px': 'calc(100vw - 16px)' }"
    >
      <p style="margin:0; font-size:14px; color:#475569">
        Are you sure you want to deactivate <strong>{{ deleteTarget?.name }}</strong>?
        They will no longer be able to log in.
      </p>
      <template #footer>
        <Button label="Cancel" text severity="secondary" @click="deleteTarget = null" />
        <Button label="Delete" icon="pi pi-trash" severity="danger" :loading="deletingId !== null" @click="doDelete" />
      </template>
    </Dialog>

  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import Dialog    from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import { usersApi } from '@/api/users'
import type { UserDTO } from '@/api/users'
import { useAuthStore } from '@/stores/auth'
import { getWarehouses } from '@/api/warehouses'
import AddUserForm from '@/components/users/AddUserForm.vue'

const auth  = useAuthStore()
const meId  = computed(() => auth.user?.id ?? '')
const qc    = useQueryClient()

// ── Warehouses list (for name resolution and multi-select) ───────────────────
const { data: warehouseList } = useQuery({ queryKey: ['warehouses'], queryFn: getWarehouses })
function warehouseNameById(id: string) {
  return warehouseList.value?.find(w => w.id === id)?.name ?? id.slice(0, 8)
}

// ── Users list ───────────────────────────────────────────────────────────────
const { data: userList, isLoading: loading } = useQuery({
  queryKey: ['users'],
  queryFn:  usersApi.list,
})
const users = computed(() => userList.value ?? [])

// ── Edit ─────────────────────────────────────────────────────────────────────
const editVisible  = ref(false)
const editTarget   = ref<UserDTO | null>(null)
const editForm     = ref({ name: '', email: '', role: 'warehouse_admin' as 'admin' | 'warehouse_admin', password: '', warehouseIds: [] as string[] })
const editError    = ref('')
const saving       = ref(false)
const showEditPass = ref(false)

function genPass(len = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from(crypto.getRandomValues(new Uint8Array(len))).map(b => chars[b % chars.length]).join('')
}

function openEdit(user: UserDTO) {
  editTarget.value = user
  editForm.value   = { name: user.name, email: user.email, role: user.role, password: '', warehouseIds: [...user.warehouseIds] }
  editError.value  = ''
  showEditPass.value = false
  editVisible.value  = true
}

async function submitEdit() {
  if (!editTarget.value) return
  saving.value    = true
  editError.value = ''
  try {
    const payload: Record<string, unknown> = {
      name:         editForm.value.name,
      email:        editForm.value.email,
      role:         editForm.value.role,
      warehouseIds: editForm.value.role === 'warehouse_admin' ? editForm.value.warehouseIds : [],
    }
    if (editForm.value.password) payload.password = editForm.value.password
    await usersApi.update(editTarget.value.id, payload)
    await qc.invalidateQueries({ queryKey: ['users'] })
    editVisible.value = false
  } catch (err: unknown) {
    editError.value = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to update user'
  } finally {
    saving.value = false
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────
const deleteTarget = ref<UserDTO | null>(null)
const deletingId   = ref<string | null>(null)

function confirmDelete(user: UserDTO) {
  deleteTarget.value = user
}

async function doDelete() {
  if (!deleteTarget.value) return
  deletingId.value = deleteTarget.value.id
  try {
    await usersApi.remove(deleteTarget.value.id)
    await qc.invalidateQueries({ queryKey: ['users'] })
    deleteTarget.value = null
  } catch {
    // ignore — table will refresh
  } finally {
    deletingId.value = null
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
</script>

<style scoped>
.users-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow-y: auto;
  height: 100%;
  padding: 0;
}

/* ── Header ── */
.page-header { display: flex; align-items: flex-start; justify-content: space-between; }
.page-title  { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 4px; }
.page-desc   { font-size: 13px; color: #64748b; margin: 0; }

/* ── Table section ── */
.table-section { display: flex; flex-direction: column; gap: 12px; }

.table-wrap {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: hidden;
}

.table-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #94a3b8;
  font-size: 14px;
  padding: 32px;
  justify-content: center;
}

.email-text { font-size: 13px; color: #475569; }

.role-badge {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 9px;
  border-radius: 20px;
}
.role-admin           { background: #fee2e2; color: #b91c1c; }
.role-warehouse_admin { background: #dbeafe; color: #1d4ed8; }

.wh-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.wh-chip {
  font-size: 11px;
  background: #f1f5f9;
  color: #475569;
  padding: 2px 8px;
  border-radius: 20px;
  border: 1px solid #e2e8f0;
}
.none { font-style: italic; }

.muted { color: #94a3b8; font-size: 13px; }

.action-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

/* ── Edit form ── */
.edit-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding-top: 4px;
}

.field { display: flex; flex-direction: column; gap: 5px; }
.field-label { font-size: 13px; font-weight: 500; color: #475569; }

.type-toggle { display: flex; gap: 8px; }
.type-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1.5px solid #e2e8f0;
  background: #fff;
  font-size: 13px;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s;
}
.type-btn:hover { border-color: #94a3b8; color: #334155; }
.type-btn.active { border-color: #0891b2; background: #ecfeff; color: #0e7490; }
.type-btn .pi { font-size: 13px; }

.pass-row { display: flex; gap: 4px; align-items: center; }
.pass-row .w-full { flex: 1; min-width: 0; }

.error-banner {
  display: flex; align-items: center; gap: 8px;
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  padding: 10px 14px; border-radius: 8px; font-size: 13px;
}

.w-full { width: 100%; }
.card-title { font-size: 14px; font-weight: 600; color: #0f172a; margin: 0; }

@media (max-width: 768px) {
  .users-view { gap: 16px; }
  .page-title { font-size: 18px; }
  .page-desc { font-size: 12px; }
  .table-section { gap: 10px; }
  .table-empty { padding: 24px 16px; font-size: 13px; }
  :deep(.users-datatable .p-datatable-thead th),
  :deep(.users-datatable .p-datatable-tbody td) { padding: 6px 8px; font-size: 12px; }
  :deep(.users-datatable .p-paginator) { padding: 6px 8px; }
}
</style>
