import { env } from '../env.js'

const BASE_URL = 'https://secure.cardcom.solutions/api/v11'

// Always use test terminal until explicitly switched to production
const API_NAME     = env.CARDCOM_TEST_API_NAME!
const API_PASSWORD = env.CARDCOM_TEST_API_PASSWORD!

export type CardcomDocumentType =
  | 'TaxInvoiceAndReceipt'
  | 'TaxInvoice'
  | 'Receipt'
  | 'TaxInvoiceRefund'

const PAYMENT_REQUIRED: CardcomDocumentType[] = ['TaxInvoiceAndReceipt', 'Receipt']

export interface SaleForDocument {
  id:              string
  customerName:    string | null
  customerEmail:   string | null
  totalPrice:      string | null
  items: Array<{
    name:      string
    quantity:  number
    unitPrice: string | null
  }>
}

interface CardcomCreateResponse {
  ResponseCode:   number
  Description:    string | null
  DocumentNumber: number
  DocumentType:   string
}

interface CardcomUrlResponse {
  ResponseCode: number
  Description:  string | null
  DocUrl:       string
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Cardcom ${path} HTTP ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

export async function createDocument(
  documentType: CardcomDocumentType,
  sale:         SaleForDocument,
  sendEmail:    boolean,
): Promise<{ documentNumber: number; documentType: string }> {
  const needsPayment = PAYMENT_REQUIRED.includes(documentType)

  const body: Record<string, unknown> = {
    ApiName:     API_NAME,
    ApiPassword: API_PASSWORD,
    Document: {
      DocumentTypeToCreate: documentType,
      Name:         sale.customerName,
      Email:        sale.customerEmail ?? undefined,
      IsSendByEmail: sendEmail && !!sale.customerEmail,
      ExternalId:   sale.id,
      Languge:      'he',
      Products: sale.items.map(item => ({
        Description: item.name,
        UnitCost:    parseFloat(item.unitPrice ?? '0'),
        Quantity:    item.quantity,
      })),
    },
  }

  if (needsPayment) {
    body.Cash = parseFloat(sale.totalPrice ?? '0')
  }

  const data = await post<CardcomCreateResponse>('/Documents/CreateDocument', body)

  if (data.ResponseCode !== 0) {
    throw new Error(data.Description ?? `Cardcom error code ${data.ResponseCode}`)
  }

  return { documentNumber: data.DocumentNumber, documentType: data.DocumentType }
}

export async function getDocumentUrl(
  documentType:   CardcomDocumentType | string,
  documentNumber: number,
): Promise<string> {
  const data = await post<CardcomUrlResponse>('/Documents/CreateDocumentUrl', {
    ApiName:        API_NAME,
    ApiPassword:    API_PASSWORD,
    DocumentType:   documentType,
    DocumentNumber: documentNumber,
  })

  if (data.ResponseCode !== 0) {
    throw new Error(data.Description ?? `Cardcom URL error code ${data.ResponseCode}`)
  }

  return data.DocUrl
}
