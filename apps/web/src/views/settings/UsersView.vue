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

          <Column field="role" header="Role" sortable style="width: 110px">
            <template #body="{ data }">
              <span class="role-badge" :class="`role-${data.role}`">{{ data.role }}</span>
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
      :style="{ width: '460px' }"
      :breakpoints="{ '520px': '95vw' }"
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
          <label class="field-label">Role</label>
          <Select v-model="editForm.role" :options="roleOptions" option-label="label" option-value="value" class="w-full" />
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
import Select    from 'primevue/select'
import { usersApi } from '@/api/users'
import type { UserDTO } from '@/api/users'
import { useAuthStore } from '@/stores/auth'
import AddUserForm from '@/components/users/AddUserForm.vue'

const auth  = useAuthStore()
const meId  = computed(() => auth.user?.id ?? '')
const qc    = useQueryClient()

// ── Users list ───────────────────────────────────────────────────────────────
const { data: userList, isLoading: loading } = useQuery({
  queryKey: ['users'],
  queryFn:  usersApi.list,
})
const users = computed(() => userList.value ?? [])

// ── Role options ─────────────────────────────────────────────────────────────
const roleOptions = [
  { label: 'Staff', value: 'staff' },
  { label: 'Admin', value: 'admin' },
]

// ── Edit ─────────────────────────────────────────────────────────────────────
const editVisible  = ref(false)
const editTarget   = ref<UserDTO | null>(null)
const editForm     = ref({ name: '', email: '', role: 'staff' as 'admin' | 'staff', password: '' })
const editError    = ref('')
const saving       = ref(false)
const showEditPass = ref(false)

function openEdit(user: UserDTO) {
  editTarget.value = user
  editForm.value   = { name: user.name, email: user.email, role: user.role, password: '' }
  editError.value  = ''
  showEditPass.value = false
  editVisible.value  = true
}

async function submitEdit() {
  if (!editTarget.value) return
  saving.value    = true
  editError.value = ''
  try {
    const payload: Record<string, string> = {
      name:  editForm.value.name,
      email: editForm.value.email,
      role:  editForm.value.role,
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
.role-admin { background: #fee2e2; color: #b91c1c; }
.role-staff { background: #dbeafe; color: #1d4ed8; }

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

.w-full { width: 100%; }
</style>
