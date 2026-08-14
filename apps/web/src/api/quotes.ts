import { apiClient } from './client'

export type QuoteStatus = 'open' | 'converted' | 'cancelled'

export interface Quote {
  id:               string
  quoteNumber:      number
  status:           QuoteStatus
  warehouseId:      string
  warehouseName:    string | null
  customerName:     string | null
  customerEmail:    string | null
  customerPhone:    string | null
  customerAddress:  string | null
  customerIdNumber: string | null
  totalPrice:       string | null
  currency:         string
  notes:            string | null
  quoteDate:        string
  createdAt:        string
  createdByName:    string | null
  convertedSaleId:  string | null
  itemCount:        number
}

export interface QuoteItem {
  id:        string
  quoteId:   string
  productId: string | null
  sku:       string
  name:      string
  quantity:  number
  unitPrice: string | null
  lineTotal: string | null
}

export interface QuoteDetail extends Omit<Quote, 'itemCount'> {
  updatedAt: string
  items:     QuoteItem[]
}

export interface QuoteItemInput {
  sku:       string
  name:      string
  quantity:  number
  unitPrice?: number
  lineTotal?: number
}

export interface QuotePayload {
  warehouseId?:      string
  customerName?:     string
  customerEmail?:    string
  customerPhone?:    string
  customerAddress?:  string
  customerIdNumber?: string
  currency?:         string
  notes?:            string
  quoteDate?:        string
  createCustomer?:   boolean
  items:             QuoteItemInput[]
}

export async function getQuotes(params?: { status?: QuoteStatus; q?: string }): Promise<Quote[]> {
  const { data } = await apiClient.get<Quote[]>('/quotes', { params })
  return data
}

export async function getQuote(id: string): Promise<QuoteDetail> {
  const { data } = await apiClient.get<QuoteDetail>(`/quotes/${id}`)
  return data
}

export async function createQuote(payload: QuotePayload): Promise<QuoteDetail> {
  const { data } = await apiClient.post<QuoteDetail>('/quotes', payload)
  return data
}

export async function updateQuote(id: string, payload: QuotePayload): Promise<QuoteDetail> {
  const { data } = await apiClient.put<QuoteDetail>(`/quotes/${id}`, payload)
  return data
}

export async function cancelQuote(id: string): Promise<QuoteDetail> {
  const { data } = await apiClient.post<QuoteDetail>(`/quotes/${id}/cancel`)
  return data
}

export async function convertQuote(id: string): Promise<{ saleId: string; quote: QuoteDetail }> {
  const { data } = await apiClient.post<{ saleId: string; quote: QuoteDetail }>(`/quotes/${id}/convert`)
  return data
}
