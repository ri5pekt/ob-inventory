import { apiClient } from './client'

export type SaleType   = 'direct' | 'partner' | 'woocommerce'
export type SaleStatus = 'completed' | 'cancelled' | 'refunded'

export interface Sale {
  id:            string
  saleType:      SaleType
  status:        SaleStatus
  warehouseId:   string
  warehouseName: string | null
  storeId:       string | null
  storeName:     string | null
  wooOrderId:    string | null
  customerName:  string | null
  customerEmail: string | null
  totalPrice:    string | null
  currency:      string
  notes:         string | null
  createdAt:     string
  itemCount:     number
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
  saleType:      'direct' | 'partner'
  warehouseId?:  string
  customerName?: string
  customerEmail?:string
  currency?:     string
  notes?:        string
  items:         CreateSaleItemInput[]
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
