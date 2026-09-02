import { apiClient } from './client'

export interface ApiTokenDTO {
  id:          string
  name:        string
  tokenPrefix: string
  isActive:    boolean
  expiresAt:   string | null
  lastUsedAt:  string | null
  createdAt:   string
  revokedAt:   string | null
}

export interface CreatedApiTokenDTO {
  id:          string
  name:        string
  tokenPrefix: string
  expiresAt:   string | null
  createdAt:   string
  /** Shown once — never retrievable again after this response. */
  token:       string
}

export interface ApiTokenRequestDTO {
  id:         string
  method:     string
  path:       string
  statusCode: number
  ip:         string | null
  createdAt:  string
}

export const apiTokensApi = {
  list: (): Promise<ApiTokenDTO[]> =>
    apiClient.get<ApiTokenDTO[]>('/tokens').then(r => r.data),

  create: (payload: { name: string; expiresAt?: string }): Promise<CreatedApiTokenDTO> =>
    apiClient.post<CreatedApiTokenDTO>('/tokens', payload).then(r => r.data),

  revoke: (id: string): Promise<void> =>
    apiClient.post(`/tokens/${id}/revoke`).then(() => undefined),

  remove: (id: string): Promise<void> =>
    apiClient.delete(`/tokens/${id}`).then(() => undefined),

  usage: (id: string): Promise<ApiTokenRequestDTO[]> =>
    apiClient.get<ApiTokenRequestDTO[]>(`/tokens/${id}/usage`).then(r => r.data),
}
