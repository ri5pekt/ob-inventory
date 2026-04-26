import { env } from '../env.js'

const BASE_URL = 'https://secure.cardcom.solutions/api/v11'

const API_NAME      = env.CARDCOM_API_NAME!
const API_PASSWORD  = env.CARDCOM_API_PASSWORD!
const TERMINAL_NUM  = env.CARDCOM_TERMINAL!

export type CardcomDocumentType =
  | 'TaxInvoiceAndReceipt'
  | 'TaxInvoice'
  | 'Receipt'
  | 'TaxInvoiceRefund'

export type CardcomPaymentType = 'Cash' | 'BankTransfer' | 'CreditCard' | 'Bit' | 'Cheque'

const PAYMENT_REQUIRED: CardcomDocumentType[] = ['TaxInvoiceAndReceipt', 'Receipt']

const INVOICE_TYPE_BY_DOCUMENT_TYPE: Record<CardcomDocumentType, number> = {
  TaxInvoiceAndReceipt: 1,
  TaxInvoice:           305,
  Receipt:              400,
  TaxInvoiceRefund:     330,
}

const CREATED_DOCUMENT_TYPE_BY_DOCUMENT_TYPE: Record<CardcomDocumentType, string> = {
  TaxInvoiceAndReceipt: 'TaxInvoiceAndReceipt',
  TaxInvoice:           'TaxInvoice',
  Receipt:              'ReceiptForTaxInvoice',
  TaxInvoiceRefund:     'TaxInvoiceRefund',
}

// Hebrew labels printed on the document's payment section
const PAYMENT_TYPE_LABEL: Record<CardcomPaymentType, string> = {
  Cash:         'מזומן',
  BankTransfer: 'העברה בנקאית',
  CreditCard:   'כרטיס אשראי',
  Bit:          'ביט',
  Cheque:       'המחאה',
}

// CustomLines TransactionID for non-cash custom payments on this terminal.
// Any small integer works; 1 is the generic custom-transaction slot.
const CUSTOM_PAYMENT_TRANSACTION_ID = 1

export interface SaleForDocument {
  id:            string
  customerName:  string | null
  customerEmail: string | null
  customerPhone: string | null
  customerAddress: string | null
  totalPrice:    string | null
  items: Array<{
    name:      string
    quantity:  number
    unitPrice: string | null
  }>
  // Optional override fields
  hp_tz?:        string | null
  documentDate?: string | null  // DD/MM/YYYY → InvoiceHead.InvDate (changes header date)
  isVatFree?:    boolean | null // true → entire document is VAT-exempt (פטור ממע"מ)
  paymentType?:  CardcomPaymentType | null
  paymentDate?:  string | null  // DD/MM/YYYY → TranDate (CustomLines) or DateCheque — payment date on PDF
  asmachta?:     string | null  // reference/confirmation number — CustomLines only (BankTransfer/Bit/CreditCard)
  comments?:     string | null
  cheque?: {
    chequeNumber?:  string | null
    bankNumber?:    number | null
    snifNumber?:    number | null
    accountNumber?: string | null
  } | null
}

interface CardcomCreateTaxInvoiceResponse {
  ResponseCode:   number
  Description:    string | null
  InvoiceNumber:  number
  InvoiceType:    number
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

  const invoiceHead: Record<string, unknown> = {
    CustName:    sale.customerName,
    Email:       sale.customerEmail ?? undefined,
    SendByEmail: sendEmail && !!sale.customerEmail,
    ExternalId:  sale.id,
    Languge:     'he',
  }

  if (sale.customerPhone)   invoiceHead.CustMobilePH    = sale.customerPhone
  if (sale.customerAddress) invoiceHead.CustAddresLine1 = sale.customerAddress
  if (sale.hp_tz) {
    invoiceHead.CompID                    = sale.hp_tz
    invoiceHead.IsAutoCreateUpdateAccount = 'true'
    invoiceHead.AccountForeignKey         = sale.id
  }
  if (sale.documentDate) invoiceHead.InvDate      = sale.documentDate
  if (sale.isVatFree)    invoiceHead.ExtIsVatFree = true
  if (sale.comments)     invoiceHead.Comments     = sale.comments

  const body: Record<string, unknown> = {
    TerminalNumber: Number(TERMINAL_NUM),
    ApiName:        API_NAME,
    ApiPassword:    API_PASSWORD,
    InvoiceType:    INVOICE_TYPE_BY_DOCUMENT_TYPE[documentType],
    InvoiceHead:    invoiceHead,
    InvoiceLines: sale.items.map(item => ({
      Description:       item.name,
      Price:             parseFloat(item.unitPrice ?? '0'),
      Quantity:          item.quantity,
      IsPriceIncludeVAT: !sale.isVatFree,
      IsVatFree:         sale.isVatFree ? 'true' : 'false',
    })),
  }

  if (needsPayment) {
    const paymentType = sale.paymentType ?? 'Cash'

    // Cardcom requires payment total == sum(Price * Quantity) — always derive from lines.
    const itemsTotal = sale.items.reduce((acc, item) => {
      return acc + parseFloat(item.unitPrice ?? '0') * item.quantity
    }, 0)
    const amount = itemsTotal > 0 ? itemsTotal : parseFloat(sale.totalPrice ?? '0')

    if (paymentType === 'Cheque') {
      const c = sale.cheque
      body.Cheques = [{
        ChequeNumber:  c?.chequeNumber  ?? '',
        BankNumber:    c?.bankNumber    ?? 0,
        SnifNumber:    c?.snifNumber    ?? 0,
        AccountNumber: c?.accountNumber ?? '',
        DateCheque:    sale.paymentDate ?? '',
        Sum:           amount,
      }]
    } else if (paymentType === 'Cash') {
      // Cash: no payment date possible in Cardcom API
      body.Cash = amount
    } else {
      // BankTransfer / Bit / CreditCard → CustomLines with TranDate.
      const customField: Record<string, unknown> = {
        TransactionID: CUSTOM_PAYMENT_TRANSACTION_ID,
        Description:   PAYMENT_TYPE_LABEL[paymentType],
        Sum:           amount,
      }
      if (sale.paymentDate) customField.TranDate  = sale.paymentDate
      if (sale.asmachta)    customField.asmacta   = sale.asmachta
      body.CustomLines = [customField]
    }
  }

  const data = await post<CardcomCreateTaxInvoiceResponse>('/Documents/CreateTaxInvoice', body)

  if (data.ResponseCode !== 0) {
    throw new Error(data.Description ?? `Cardcom error code ${data.ResponseCode}`)
  }

  return {
    documentNumber: data.InvoiceNumber,
    documentType:   CREATED_DOCUMENT_TYPE_BY_DOCUMENT_TYPE[documentType],
  }
}

export async function getDocumentUrl(
  documentType:   CardcomDocumentType | string,
  documentNumber: number,
): Promise<string> {
  const data = await post<CardcomUrlResponse>('/Documents/CreateDocumentUrl', {
    TerminalNumber: TERMINAL_NUM,
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
