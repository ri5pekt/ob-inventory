import { apiClient } from './client'

export type SaleType   = 'direct' | 'partner' | 'woocommerce' | 'merged'
export type SaleStatus = 'completed' | 'cancelled' | 'refunded' | 'superseded'

export interface Sale {
  id:            string
  saleType:      SaleType
  status:        SaleStatus
  warehouseId:   string
  warehouseName: string | null
  storeId:       string | null
  storeName:     string | null
  wooOrderId:    string | null
  customerName:    string | null
  customerEmail:   string | null
  customerPhone:   string | null
  customerAddress: string | null
  customerIdNumber: string | null
  totalPrice:    string | null
  currency:      string
  notes:         string | null
  saleDate:      string
  createdAt:     string
  itemCount:     number
  targetId:          string | null
  targetName:        string | null
  invoiceStatusId:   string | null
  invoiceStatusName: string | null
  createdByName:     string | null
  paymentMethods:    { id: string; name: string }[]
}

export interface SaleItem {
  id:        string
  saleId:    string
  productId: string | null
  sku:       string
  name:      string
  quantity:  number
  unitPrice: string | null
  lineTotal: string | null
  boxNumber: string | null
}

export interface SaleDetail extends Sale {
  items: SaleItem[]
}

export interface CreateSaleItemInput {
  sku:       string
  name:      string
  quantity:  number
  unitPrice?: number
  lineTotal?: number
}

export interface CreateSaleRequest {
  saleType:          'direct' | 'partner'
  warehouseId?:      string
  customerName?:     string
  customerEmail?:    string
  customerPhone?:    string
  customerAddress?:  string
  customerIdNumber?: string
  currency?:         string
  notes?:            string
  targetId?:         string
  invoiceStatusId?:  string
  paymentMethodIds?: string[]
  saleDate?:         string
  createCustomer?:   boolean
  items:             CreateSaleItemInput[]
}

export async function getSales(params?: {
  type?:     SaleType
  dateFrom?: string
  dateTo?:   string
  limit?:    number
  offset?:   number
}): Promise<Sale[]> {
  const { data } = await apiClient.get<Sale[]>('/sales', { params })
  return data
}

export async function getSale(id: string): Promise<SaleDetail> {
  const { data } = await apiClient.get<SaleDetail>(`/sales/${id}`)
  return data
}

export async function createSale(payload: CreateSaleRequest): Promise<{ id: string }> {
  const { data } = await apiClient.post<{ id: string }>('/sales', payload)
  return data
}

export interface UpdateSaleItemInput {
  productId?: string
  sku:        string
  name:       string
  quantity:   number
  unitPrice?: number
  lineTotal?: number
}

export interface UpdateSaleRequest {
  warehouseId?:      string
  customerName?:     string
  customerEmail?:    string
  customerPhone?:    string
  customerAddress?:  string
  customerIdNumber?: string
  currency?:         string
  notes?:            string
  targetId?:         string | null
  invoiceStatusId?:  string | null
  paymentMethodIds?: string[] | null
  saleDate?:         string
  items:             UpdateSaleItemInput[]
}

export async function updateSale(id: string, payload: UpdateSaleRequest): Promise<void> {
  await apiClient.put(`/sales/${id}`, payload)
}

export async function deleteSale(id: string, reason?: string): Promise<void> {
  await apiClient.delete(`/sales/${id}`, { data: { reason } })
}

// ── Merge sales ──────────────────────────────────────────────────────────────

export interface MergePreviewItem {
  productId:    string | null
  sku:          string
  name:         string
  quantity:     number
  carriedQty:   number
  unitPrice:    number | null
  availableQty: number
  model:        string | null
  size:         string | null
  color:        string | null
}

export interface MergePreviewResponse {
  warehouseId:      string
  currency:         string
  customerName:     string | null
  customerEmail:    string | null
  customerPhone:    string | null
  customerAddress:  string | null
  customerIdNumber: string | null
  targetId:         string | null
  invoiceStatusId:  string | null
  paymentMethodIds: string[]
  saleDate:         string
  notes:            string
  mergeSummary:     string
  items:            MergePreviewItem[]
}

export interface MergeSalesRequest {
  saleIds:             string[]
  supersedeOriginals:  boolean
  warehouseId:         string
  customerName?:        string
  customerEmail?:       string
  customerPhone?:       string
  customerAddress?:     string
  customerIdNumber?:    string
  currency?:            string
  notes?:               string
  targetId?:            string
  invoiceStatusId?:     string
  paymentMethodIds?:    string[]
  saleDate?:            string
  createCustomer?:      boolean
  items:                CreateSaleItemInput[]
}

export async function getMergePreview(ids: string[]): Promise<MergePreviewResponse> {
  const { data } = await apiClient.get<MergePreviewResponse>('/sales/merge-preview', {
    params: { ids: ids.join(',') },
  })
  return data
}

export async function mergeSales(payload: MergeSalesRequest): Promise<{ id: string }> {
  const { data } = await apiClient.post<{ id: string }>('/sales/merge', payload)
  return data
}
