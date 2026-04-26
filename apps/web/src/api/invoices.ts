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
  Receipt:              'קבלה לחשבונית',
  ReceiptForTaxInvoice: 'קבלה לחשבונית',
  TaxInvoiceRefund:     'חשבונית מס זיכוי',
}

export const ALL_DOCUMENT_TYPES = [
  'TaxInvoiceAndReceipt',
  'TaxInvoice',
  'Receipt',
  'TaxInvoiceRefund',
] as const

export async function getSaleDocuments(saleId: string): Promise<CardcomDocument[]> {
  const { data } = await apiClient.get<CardcomDocument[]>(`/sales/${saleId}/documents`)
  return data
}

export type CardcomPaymentType = 'Cash' | 'BankTransfer' | 'CreditCard' | 'Bit' | 'Cheque'

export interface DocumentOverride {
  customerName?:  string
  customerEmail?: string | null
  totalPrice?:    string | null
  items?: Array<{ name: string; quantity: number; unitPrice: string | null }>
  hp_tz?:        string
  documentDate?: string           // DD/MM/YYYY — changes the header date on the document
  isVatFree?:    boolean
  paymentType?:  CardcomPaymentType
  paymentDate?:  string           // DD/MM/YYYY — payment date; shown on PDF for non-Cash payments
  asmachta?:     string           // reference/confirmation number; printed on PDF for BankTransfer/Bit/CreditCard
  comments?:     string
  cheque?: {
    chequeNumber?:  string
    bankNumber?:    number
    snifNumber?:    number
    accountNumber?: string
  }
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
