import { apiClient } from './client'
import type { WarehouseDTO, StockItemDTO, CreateWarehouseRequest } from '@ob-inventory/types'

export interface AddProductRequest {
  sku: string
  name: string
  wooTitle?: string | null
  brandId?: string | null
  categoryId?: string | null
  boxNumber?: string | null
  dateAdded?: string | null
  quantity: number
  model?: string | null
  sizeOptionId?: string | null
  colorOptionId?: string | null
  unitOptionId?: string | null
  image?: string | null
}

export async function getWarehouses(): Promise<WarehouseDTO[]> {
  const { data } = await apiClient.get<WarehouseDTO[]>('/warehouses')
  return data
}

export async function getWarehouseStock(id: string): Promise<StockItemDTO[]> {
  const { data } = await apiClient.get<StockItemDTO[]>(`/warehouses/${id}/stock`)
  return data
}

export async function createWarehouse(payload: CreateWarehouseRequest): Promise<WarehouseDTO> {
  const { data } = await apiClient.post<WarehouseDTO>('/warehouses', payload)
  return data
}

export async function addProductToWarehouse(warehouseId: string, payload: AddProductRequest): Promise<{ productId: string }> {
  const { data } = await apiClient.post<{ productId: string }>(`/warehouses/${warehouseId}/stock`, payload)
  return data
}

export interface UpdateWarehouseRequest {
  name?:  string
  type?:  import('@ob-inventory/types').WarehouseType
  notes?: string | null
  color?: string
  icon?:  string
  logo?:  string | null
}

export async function updateWarehouse(id: string, payload: UpdateWarehouseRequest): Promise<import('@ob-inventory/types').WarehouseDTO> {
  const { data } = await apiClient.put<import('@ob-inventory/types').WarehouseDTO>(`/warehouses/${id}`, payload)
  return data
}

export async function removeWarehouseStock(warehouseId: string, productId: string): Promise<void> {
  await apiClient.delete(`/warehouses/${warehouseId}/stock/${productId}`)
}

export interface UpdateProductRequest extends AddProductRequest {}

export async function updateWarehouseStock(
  warehouseId: string,
  productId: string,
  payload: UpdateProductRequest,
): Promise<void> {
  await apiClient.put(`/warehouses/${warehouseId}/stock/${productId}`, payload)
}
