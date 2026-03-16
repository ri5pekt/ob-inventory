import { apiClient } from './client'

// ── Product search ────────────────────────────────────────────────────────────

export interface ProductSearchResult {
  productId:    string
  sku:          string
  name:         string
  brandName:    string | null
  categoryName: string | null
  availableQty: number
  model:        string | null
  size:         string | null
  color:        string | null
  retailPrice:  string | null
}

export async function searchProducts(
  q: string,
  warehouseId: string,
  limit = 20,
): Promise<ProductSearchResult[]> {
  const { data } = await apiClient.get<ProductSearchResult[]>('/products/search', {
    params: { q, warehouseId, limit },
  })
  return data
}

// ── Catalog search (global — used by Add Product to Warehouse modal) ──────────

export interface CatalogSearchResult {
  productId:     string
  sku:           string
  name:          string
  wooTitle:      string | null
  brandId:       string | null
  brandName:     string | null
  categoryId:    string | null
  categoryName:  string | null
  costPrice:     string | null
  retailPrice:   string | null
  model:         string | null
  sizeOptionId:  string | null
  sizeLabel:     string | null
  colorOptionId: string | null
  colorLabel:    string | null
  unitOptionId:  string | null
  unitLabel:     string | null
}

export async function searchCatalog(
  q: string,
  limit = 20,
): Promise<CatalogSearchResult[]> {
  const { data } = await apiClient.get<CatalogSearchResult[]>('/products/catalog-search', {
    params: { q, limit },
  })
  return data
}

// ── Transfers ─────────────────────────────────────────────────────────────────

export type TransferStatus = 'completed' | 'cancelled'

export interface TransferSummary {
  id:                string
  status:            TransferStatus
  reference:         string | null
  notes:             string | null
  createdAt:         string
  fromWarehouseId:   string
  toWarehouseId:     string
  fromWarehouseName: string | null
  toWarehouseName:   string | null
  itemCount:         number
}

export interface TransferItem {
  id:         string
  transferId: string
  productId:  string
  sku:        string
  name:       string
  quantity:   number
  boxNumber:  string | null
}

export interface TransferDetail extends TransferSummary {
  items: TransferItem[]
}

export interface CreateTransferRequest {
  fromWarehouseId: string
  toWarehouseId:   string
  reference?:      string
  notes?:          string
  items: { productId: string; quantity: number }[]
}

export async function getTransfers(params?: {
  limit?:    number
  offset?:   number
  dateFrom?: string
  dateTo?:   string
}): Promise<TransferSummary[]> {
  const { data } = await apiClient.get<TransferSummary[]>('/transfers', { params })
  return data
}

export async function getTransfer(id: string): Promise<TransferDetail> {
  const { data } = await apiClient.get<TransferDetail>(`/transfers/${id}`)
  return data
}

export async function deleteTransfer(id: string, reason?: string): Promise<void> {
  await apiClient.delete(`/transfers/${id}`, { data: { reason } })
}

export async function createTransfer(payload: CreateTransferRequest): Promise<{ id: string }> {
  const { data } = await apiClient.post<{ id: string }>('/transfers', payload)
  return data
}

export interface UpdateTransferRequest {
  reference?: string
  notes?:     string
  items:      { productId: string; quantity: number }[]
}

export async function updateTransfer(id: string, payload: UpdateTransferRequest): Promise<void> {
  await apiClient.put(`/transfers/${id}`, payload)
}
