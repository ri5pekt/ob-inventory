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

export interface PullDocumentsResult {
  pulledCount: number
  documents:   CardcomDocument[]
}

export async function pullSaleDocuments(saleId: string): Promise<PullDocumentsResult> {
  const { data } = await apiClient.post<PullDocumentsResult>(`/sales/${saleId}/documents/pull`)
  return data
}

export async function deleteSaleDocument(saleId: string, docId: string): Promise<void> {
  await apiClient.delete(`/sales/${saleId}/documents/${docId}`)
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

export interface ChargeCardRequest {
  cardNumber:    string
  cardExpiry:    string   // MMYY
  cvv:           string
  numOfPayments: number
  customerName?: string
  customerEmail?: string | null
  isVatFree?:    boolean
  items?: Array<{ name: string; quantity: number; unitPrice: number }>
}

export interface ChargeCardResult {
  id:             string
  documentType:   string
  documentNumber: number
  transactionId:  number
  last4Digits:    string
  cardBrand:      string
  createdAt:      string
  docUrl:         string | null
}

export async function chargeCardForSale(
  saleId:  string,
  payload: ChargeCardRequest,
): Promise<ChargeCardResult> {
  const { data } = await apiClient.post<ChargeCardResult>(`/sales/${saleId}/charge-card`, payload)
  return data
}

// ── QR / LowProfile payment requests ─────────────────────────────────────────

export interface QrPaymentRequestPayload {
  customerName?:  string
  customerEmail?: string | null
  isVatFree?:     boolean
  items?: Array<{ name: string; quantity: number; unitPrice: number }>
}

export interface QrPaymentRequest {
  requestId: string
  url:       string
  expiresAt: string
}

export type QrPaymentStatus =
  | 'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | 'paid_after_cancel'

export interface QrPaymentStatusResult {
  status:          QrPaymentStatus
  documentId?:     string
  documentNumber?: number
  documentType?:   string
  last4Digits?:    string
  cardBrand?:      string
  docUrl?:         string | null
}

export async function createQrPaymentRequest(
  saleId:  string,
  payload: QrPaymentRequestPayload,
): Promise<QrPaymentRequest> {
  const { data } = await apiClient.post<QrPaymentRequest>(`/sales/${saleId}/qr-payment-request`, payload)
  return data
}

export async function getQrPaymentStatus(
  saleId:    string,
  requestId: string,
): Promise<QrPaymentStatusResult> {
  const { data } = await apiClient.get<QrPaymentStatusResult>(`/sales/${saleId}/qr-payment-request/${requestId}`)
  return data
}

export async function cancelQrPaymentRequest(
  saleId:    string,
  requestId: string,
): Promise<void> {
  await apiClient.post(`/sales/${saleId}/qr-payment-request/${requestId}/cancel`)
}
