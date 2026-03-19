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

export type CardcomPaymentType = 'Cash' | 'BankTransfer' | 'CreditCard' | 'Bit' | 'Cheque'

const PAYMENT_REQUIRED: CardcomDocumentType[] = ['TaxInvoiceAndReceipt', 'Receipt']

// Hebrew labels printed on the document's payment section
const PAYMENT_TYPE_LABEL: Record<CardcomPaymentType, string> = {
  Cash:         'מזומן',
  BankTransfer: 'העברה בנקאית',
  CreditCard:   'כרטיס אשראי',
  Bit:          'ביט',
  Cheque:       'המחאה',
}

// CustomFields TransactionID for non-cash custom payments on this terminal.
// Any small integer works; 1 is the generic custom-transaction slot.
const CUSTOM_PAYMENT_TRANSACTION_ID = 1

// Convert DD/MM/YYYY → MM/DD/YYYY for TranDate / DateCheque.
// Cardcom stores TranDate/DateCheque in MM/DD/YYYY internally
// (confirmed by testing: sending 01/03 displayed as 03/01 on PDF).
function toMMDD(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split('/')
  if (!dd || !mm || !yyyy) return ddmmyyyy
  return `${mm}/${dd}/${yyyy}`
}

export interface SaleForDocument {
  id:            string
  customerName:  string | null
  customerEmail: string | null
  totalPrice:    string | null
  items: Array<{
    name:      string
    quantity:  number
    unitPrice: string | null
  }>
  // Optional override fields
  hp_tz?:        string | null
  documentDate?: string | null  // DD/MM/YYYY → Document.DocumentDate (changes header date)
  isVatFree?:    boolean | null // true → entire document is VAT-exempt (פטור ממע"מ)
  paymentType?:  CardcomPaymentType | null
  paymentDate?:  string | null  // DD/MM/YYYY → TranDate (CustomFields) or DateCheque — payment date on PDF
  asmachta?:     string | null  // reference/confirmation number — CustomFields only (BankTransfer/Bit/CreditCard)
  comments?:     string | null
  cheque?: {
    chequeNumber?:  string | null
    bankNumber?:    number | null
    snifNumber?:    number | null
    accountNumber?: string | null
  } | null
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

  const doc: Record<string, unknown> = {
    DocumentTypeToCreate: documentType,
    Name:                 sale.customerName,
    Email:                sale.customerEmail ?? undefined,
    IsSendByEmail:        sendEmail && !!sale.customerEmail,
    ExternalId:           sale.id,
    Languge:              'he',
    Products: sale.items.map(item => ({
      Description: item.name,
      UnitCost:    parseFloat(item.unitPrice ?? '0'),
      Quantity:    item.quantity,
    })),
  }

  if (sale.hp_tz)        doc.TaxId        = sale.hp_tz
  if (sale.documentDate) doc.DocumentDate = sale.documentDate  // DD/MM/YYYY
  if (sale.isVatFree)    doc.IsVatFree    = true
  if (sale.comments)     doc.Comments     = sale.comments

  const body: Record<string, unknown> = {
    ApiName:     API_NAME,
    ApiPassword: API_PASSWORD,
    Document:    doc,
  }

  if (needsPayment) {
    const paymentType = sale.paymentType ?? 'Cash'

    // Cardcom requires payment total == sum(UnitCost * Quantity) — always derive from items
    const itemsTotal = sale.items.reduce((acc, item) => {
      return acc + parseFloat(item.unitPrice ?? '0') * item.quantity
    }, 0)
    const amount = itemsTotal > 0 ? itemsTotal : parseFloat(sale.totalPrice ?? '0')

    if (paymentType === 'Cheque') {
      // Cheque: DateCheque uses MM/DD/YYYY internally (confirmed by API tests)
      const c = sale.cheque
      body.Cheques = [{
        ChequeNumber:  c?.chequeNumber  ?? '',
        BankNumber:    c?.bankNumber    ?? 0,
        SnifNumber:    c?.snifNumber    ?? 0,
        AccountNumber: c?.accountNumber ?? '',
        DateCheque:    sale.paymentDate ? toMMDD(sale.paymentDate) : '',
        Sum:           amount,
      }]
    } else if (paymentType === 'Cash') {
      // Cash: no payment date possible in Cardcom API
      body.Cash = amount
    } else {
      // BankTransfer / Bit / CreditCard → CustomFields with TranDate
      // TranDate uses MM/DD/YYYY internally (confirmed by API tests)
      const customField: Record<string, unknown> = {
        TransactionID: CUSTOM_PAYMENT_TRANSACTION_ID,
        Description:   PAYMENT_TYPE_LABEL[paymentType],
        Sum:           amount,
      }
      if (sale.paymentDate) customField.TranDate  = toMMDD(sale.paymentDate)
      if (sale.asmachta)    customField.asmacta   = sale.asmachta
      body.CustomFields = [customField]
    }
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
