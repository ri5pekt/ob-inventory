import { apiClient } from './client'

export interface UserDTO {
  id:        string
  name:      string
  email:     string
  role:      'admin' | 'staff'
  isActive:  boolean
  createdAt: string
}

export interface CreateUserRequest {
  name:     string
  email:    string
  password: string
  role:     'admin' | 'staff'
}

export interface UpdateUserRequest {
  name?:     string
  email?:    string
  role?:     'admin' | 'staff'
  password?: string
}

export const usersApi = {
  list:   (): Promise<UserDTO[]> =>
    apiClient.get<UserDTO[]>('/users').then(r => r.data),

  create: (payload: CreateUserRequest): Promise<UserDTO> =>
    apiClient.post<UserDTO>('/users', payload).then(r => r.data),

  update: (id: string, payload: UpdateUserRequest): Promise<UserDTO> =>
    apiClient.put<UserDTO>(`/users/${id}`, payload).then(r => r.data),

  remove: (id: string): Promise<void> =>
    apiClient.delete(`/users/${id}`).then(() => undefined),
}
