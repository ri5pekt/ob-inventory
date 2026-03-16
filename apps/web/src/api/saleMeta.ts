import { apiClient } from './client'

export interface SaleMetaItem {
  id:        string
  name:      string
  createdAt: string
}

export async function getSaleTargets(): Promise<SaleMetaItem[]> {
  const { data } = await apiClient.get<SaleMetaItem[]>('/sale-meta/targets')
  return data
}

export async function createSaleTarget(name: string): Promise<SaleMetaItem> {
  const { data } = await apiClient.post<SaleMetaItem>('/sale-meta/targets', { name })
  return data
}

export async function updateSaleTarget(id: string, name: string): Promise<SaleMetaItem> {
  const { data } = await apiClient.put<SaleMetaItem>(`/sale-meta/targets/${id}`, { name })
  return data
}

export async function deleteSaleTarget(id: string): Promise<void> {
  await apiClient.delete(`/sale-meta/targets/${id}`)
}

export async function getSaleInvoiceStatuses(): Promise<SaleMetaItem[]> {
  const { data } = await apiClient.get<SaleMetaItem[]>('/sale-meta/invoice-statuses')
  return data
}

export async function createSaleInvoiceStatus(name: string): Promise<SaleMetaItem> {
  const { data } = await apiClient.post<SaleMetaItem>('/sale-meta/invoice-statuses', { name })
  return data
}

export async function updateSaleInvoiceStatus(id: string, name: string): Promise<SaleMetaItem> {
  const { data } = await apiClient.put<SaleMetaItem>(`/sale-meta/invoice-statuses/${id}`, { name })
  return data
}

export async function deleteSaleInvoiceStatus(id: string): Promise<void> {
  await apiClient.delete(`/sale-meta/invoice-statuses/${id}`)
}

export async function getSalePaymentMethods(): Promise<SaleMetaItem[]> {
  const { data } = await apiClient.get<SaleMetaItem[]>('/sale-meta/payment-methods')
  return data
}

export async function createSalePaymentMethod(name: string): Promise<SaleMetaItem> {
  const { data } = await apiClient.post<SaleMetaItem>('/sale-meta/payment-methods', { name })
  return data
}

export async function updateSalePaymentMethod(id: string, name: string): Promise<SaleMetaItem> {
  const { data } = await apiClient.put<SaleMetaItem>(`/sale-meta/payment-methods/${id}`, { name })
  return data
}

export async function deleteSalePaymentMethod(id: string): Promise<void> {
  await apiClient.delete(`/sale-meta/payment-methods/${id}`)
}
