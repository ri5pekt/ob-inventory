import { apiClient } from './client'

export interface CardcomDocument {
  id:             string
  documentType:   string
  documentNumber: number
  createdAt:      string
  docUrl:         string | null
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  TaxInvoiceAndReceipt: 'חשבונית מס קבלה',
  TaxInvoice:           'חשבונית מס',
  Receipt:              'קבלה',
  TaxInvoiceRefund:     'חשבונית מס זיכוי',
}

export const ALL_DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as Array<
  keyof typeof DOCUMENT_TYPE_LABELS
>

export async function getSaleDocuments(saleId: string): Promise<CardcomDocument[]> {
  const { data } = await apiClient.get<CardcomDocument[]>(`/sales/${saleId}/documents`)
  return data
}

export interface DocumentOverride {
  customerName?:  string
  customerEmail?: string | null
  totalPrice?:    string | null
  items?: Array<{ name: string; quantity: number; unitPrice: string | null }>
}

export async function createSaleDocument(
  saleId:       string,
  documentType: string,
  sendEmail:    boolean,
  override?:    DocumentOverride,
): Promise<CardcomDocument> {
  const { data } = await apiClient.post<CardcomDocument>(`/sales/${saleId}/documents`, {
    documentType,
    sendEmail,
    override,
  })
  return data
}
