import { apiClient } from './client'

export interface Category { id: string; name: string; createdAt: string }
export interface Brand    { id: string; name: string; createdAt: string }

export interface AttributeOption {
  id: string; definitionId: string; code: string; label: string; sortOrder: number
}
export interface AttributeDefinition {
  id: string; name: string; inputType: 'select' | 'text' | 'number'
  isRequired: boolean; sortOrder: number; createdAt: string
  options: AttributeOption[]
}

export const catalogApi = {
  // Categories
  getCategories:    ()                          => apiClient.get<Category[]>('/categories').then(r => r.data),
  createCategory:   (name: string)              => apiClient.post<Category>('/categories', { name }).then(r => r.data),
  updateCategory:   (id: string, name: string)  => apiClient.put<Category>(`/categories/${id}`, { name }).then(r => r.data),
  deleteCategory:   (id: string)                => apiClient.delete(`/categories/${id}`),

  // Brands
  getBrands:    ()                          => apiClient.get<Brand[]>('/brands').then(r => r.data),
  createBrand:  (name: string)              => apiClient.post<Brand>('/brands', { name }).then(r => r.data),
  updateBrand:  (id: string, name: string)  => apiClient.put<Brand>(`/brands/${id}`, { name }).then(r => r.data),
  deleteBrand:  (id: string)                => apiClient.delete(`/brands/${id}`),

  // Attributes
  getAttributes:    ()                                                           => apiClient.get<AttributeDefinition[]>('/attributes').then(r => r.data),
  createAttribute:  (body: Pick<AttributeDefinition, 'name' | 'inputType' | 'isRequired' | 'sortOrder'>) => apiClient.post<AttributeDefinition>('/attributes', body).then(r => r.data),
  updateAttribute:  (id: string, body: Partial<Pick<AttributeDefinition, 'name' | 'isRequired' | 'sortOrder'>>) => apiClient.put<AttributeDefinition>(`/attributes/${id}`, body).then(r => r.data),
  deleteAttribute:  (id: string)                                                 => apiClient.delete(`/attributes/${id}`),

  // Attribute options
  createOption: (defId: string, body: Pick<AttributeOption, 'code' | 'label' | 'sortOrder'>) => apiClient.post<AttributeOption>(`/attributes/${defId}/options`, body).then(r => r.data),
  updateOption: (optId: string, body: Partial<Pick<AttributeOption, 'code' | 'label' | 'sortOrder'>>) => apiClient.put<AttributeOption>(`/attributes/options/${optId}`, body).then(r => r.data),
  deleteOption: (optId: string) => apiClient.delete(`/attributes/options/${optId}`),
}
