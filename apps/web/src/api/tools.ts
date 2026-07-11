import { apiClient } from './client'
import type { Customer } from './customers'

export interface ImportPreview {
  total:    number
  toCreate: number
  toSkip:   number
}

export interface ImportResult {
  created:   number
  skipped:   number
  customers: Customer[]
}

export async function previewImportCustomersFromSales(): Promise<ImportPreview> {
  const { data } = await apiClient.get<ImportPreview>('/tools/customers/import-from-sales/preview')
  return data
}

export async function importCustomersFromSales(): Promise<ImportResult> {
  const { data } = await apiClient.post<ImportResult>('/tools/customers/import-from-sales')
  return data
}
