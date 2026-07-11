import { apiClient } from './client'

export interface Customer {
  id:        string
  name:      string
  email:     string | null
  phone:     string | null
  address:   string | null
  company:   string | null
  idNumber:  string | null
  notes:     string | null
  createdAt: string
}

export interface CustomerForm {
  name:     string
  email:    string
  phone:    string
  address:  string
  company:  string
  idNumber: string
  notes:    string
}

export async function getCustomers(params?: { q?: string; limit?: number; offset?: number }): Promise<Customer[]> {
  const { data } = await apiClient.get<Customer[]>('/customers', { params })
  return data
}

export async function getCustomer(id: string): Promise<Customer> {
  const { data } = await apiClient.get<Customer>(`/customers/${id}`)
  return data
}

export async function createCustomer(payload: CustomerForm): Promise<Customer> {
  const { data } = await apiClient.post<Customer>('/customers', payload)
  return data
}

export async function updateCustomer(id: string, payload: CustomerForm): Promise<Customer> {
  const { data } = await apiClient.put<Customer>(`/customers/${id}`, payload)
  return data
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiClient.delete(`/customers/${id}`)
}
