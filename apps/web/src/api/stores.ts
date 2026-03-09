import { apiClient } from './client'

export interface Store {
  id: string
  name: string
  url: string | null
  platform: 'woocommerce' | 'direct' | 'other'
  isActive: boolean
  hasToken: boolean
  notes: string | null
  createdAt: string
}

export interface UpdateStoreRequest {
  name?: string
  url?: string | null
  secretToken?: string
  notes?: string | null
}

export type SyncStatus = 'synced' | 'qty_mismatch' | 'ob_only' | 'woo_only' | 'untracked'

export interface SyncItem {
  sku:         string
  obProductId: string | null
  obName:      string | null
  wooName:     string | null
  wooAttrs:    string | null
  obQty:       number | null
  wooQty:      number | null
  wooId:       number | null
  wooParentId: number | null
  wooType:     string | null
  status:      SyncStatus
}

export interface SyncPreview {
  items: SyncItem[]
  summary: {
    total:     number
    synced:    number
    mismatch:  number
    obOnly:    number
    wooOnly:   number
    untracked: number
  }
  meta: { wooTotal: number; obTotal: number }
}

export interface WooForwardData {
  status:     string
  site:       string
  site_url:   string
  wc_version: string | null
  wp_version: string
  plugin:     string
  version:    string
  timestamp:  string
}

export interface WooReverseData {
  status:     string
  http_code?: number
  ob_url:     string
  ob_db:      string | null
  ob_redis:   string | null
  reached_at: string
}

export interface WooTestResult {
  forward: { success: boolean; error?: string; data?: WooForwardData }
  reverse: { success: boolean; error?: string; data?: WooReverseData }
}

export async function getStores(): Promise<Store[]> {
  const { data } = await apiClient.get<Store[]>('/stores')
  return data
}

export async function getStore(id: string): Promise<Store> {
  const { data } = await apiClient.get<Store>(`/stores/${id}`)
  return data
}

export async function updateStore(id: string, payload: UpdateStoreRequest): Promise<Store> {
  const { data } = await apiClient.put<Store>(`/stores/${id}`, payload)
  return data
}

export async function testWooConnection(id: string): Promise<WooTestResult> {
  const { data } = await apiClient.post<WooTestResult>(`/stores/${id}/woo/test`)
  return data
}

export async function getSyncPreview(id: string): Promise<SyncPreview> {
  const { data } = await apiClient.get<SyncPreview>(`/stores/${id}/woo/sync-preview`)
  return data
}

export interface SyncQuantityResponse {
  ok: boolean
  jobId: string | null
}

export async function syncProductQuantity(productId: string): Promise<SyncQuantityResponse> {
  const { data } = await apiClient.post<SyncQuantityResponse>(`/inventory/products/${productId}/sync-quantity`)
  return data
}
