import { env } from '../env.js'

const BASE_URL = 'https://secure.cardcom.solutions/api/v11'

const USE_TEST = env.CARDCOM_USE_TEST === 'true'

const API_NAME     = (USE_TEST ? env.CARDCOM_TEST_API_NAME     : env.CARDCOM_API_NAME)!
const API_PASSWORD = (USE_TEST ? env.CARDCOM_TEST_API_PASSWORD : env.CARDCOM_API_PASSWORD)!
const TERMINAL_NUM = (USE_TEST ? env.CARDCOM_TEST_TERMINAL     : env.CARDCOM_TERMINAL)!

export interface CardcomAuth {
  apiName:     string
  apiPassword: string
  terminal:    number
}

/** Default terminal (honors CARDCOM_USE_TEST). Woo store docs live on production. */
export function cardcomAuth(forceProduction = false): CardcomAuth {
  const useTest = !forceProduction && env.CARDCOM_USE_TEST === 'true'
  return {
    apiName:     (useTest ? env.CARDCOM_TEST_API_NAME     : env.CARDCOM_API_NAME)!,
    apiPassword: (useTest ? env.CARDCOM_TEST_API_PASSWORD : env.CARDCOM_API_PASSWORD)!,
    terminal:    Number(useTest ? env.CARDCOM_TEST_TERMINAL : env.CARDCOM_TERMINAL),
  }
}

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

// TransactionID values per payment type — these are the "מספר רץ" (running numbers)
// from the terminal's "Additional Payment Methods" list in Cardcom admin.
// Settings → Documents → Additional Payment Methods list.
// Bit=28, BankTransfer(הפקדה בנקאית)=31 — confirmed by Cardcom support May 2026.
// CreditCard=1 (generic fallback; credit cards are usually linked via DealNumbers instead).
const CUSTOM_PAYMENT_TRANSACTION_ID: Record<string, number> = {
  BankTransfer: 31,
  Bit:          28,
  CreditCard:   1,
}

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

export interface ChargeCardParams {
  saleId:         string
  customerName:   string
  customerEmail:  string | null
  amount:         number
  cardNumber:     string
  cardExpiry:     string   // MMYY
  cvv:            string
  numOfPayments:  number
  isVatFree:      boolean
  items: Array<{
    name:      string
    quantity:  number
    unitPrice: number
  }>
}

export interface ChargeCardResult {
  transactionId:  number
  documentNumber: number
  documentType:   string
  last4Digits:    string
  cardBrand:      string
  documentUrl:    string | null
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

interface CardcomDoTransactionResponse {
  ResponseCode:     number
  Description:      string | null
  TranzactionId:    number
  Last4CardDigits:  string
  CardName:         string
  Brand:            string
  DocumentNumber:   number
  DocumentType:     string
  DocumentUrl:      string | null
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

  // Always create/update a customer card in Cardcom.
  // Cardcom searches by: CompID → AccountForeignKey → Email (first match wins).
  invoiceHead.IsAutoCreateUpdateAccount = 'true'
  invoiceHead.AccountForeignKey         = sale.id  // our sale ID as external key
  if (sale.hp_tz) {
    invoiceHead.CompID = sale.hp_tz  // ת.ז. / ח.פ. when provided — strongest match
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
        TransactionID: CUSTOM_PAYMENT_TRANSACTION_ID[paymentType] ?? 1,
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

export async function chargeCard(params: ChargeCardParams): Promise<ChargeCardResult> {
  const body: Record<string, unknown> = {
    TerminalNumber:            Number(TERMINAL_NUM),
    ApiName:                   API_NAME,
    Amount:                    params.amount,
    CardNumber:                params.cardNumber,
    CardExpirationMMYY:        params.cardExpiry,
    CVV2:                      params.cvv,
    NumOfPayments:             params.numOfPayments,
    // Unique per attempt — sale ID + timestamp so retries are never blocked
    ExternalUniqTranId:         `${params.saleId}-${Date.now()}`,
    ExternalUniqTranIdResponse: false,
    Document: {
      DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
      Name:          params.customerName,
      Email:         params.customerEmail ?? undefined,
      IsSendByEmail: !!params.customerEmail,
      IsVatFree:     params.isVatFree,
      Language:      'he',
      ExternalId:    params.saleId,
      // Create/link a Cardcom customer card automatically.
      // When true, Cardcom searches by AccountForeignKey → SiteUniqueId → Email.
      AdvancedDefinition: {
        IsAutoCreateUpdateAccount: true,
        AccountForeignKey:         params.saleId,
      },
      Products:      params.items.map(item => ({
        Description: item.name,
        Quantity:    item.quantity,
        UnitCost:    item.unitPrice,
      })),
    },
  }

  const data = await post<CardcomDoTransactionResponse>('/Transactions/Transaction', body)

  if (data.ResponseCode !== 0) {
    throw new Error(data.Description ?? `Cardcom charge error ${data.ResponseCode}`)
  }

  return {
    transactionId:  data.TranzactionId,
    documentNumber: data.DocumentNumber,
    documentType:   data.DocumentType ?? 'TaxInvoiceAndReceipt',
    last4Digits:    String(data.Last4CardDigits),
    cardBrand:      data.Brand ?? data.CardName ?? '',
    documentUrl:    data.DocumentUrl ?? null,
  }
}

export async function getDocumentUrl(
  documentType:   CardcomDocumentType | string,
  documentNumber: number,
  auth?:          CardcomAuth,
): Promise<string> {
  const a = auth ?? cardcomAuth()
  const data = await post<CardcomUrlResponse>('/Documents/CreateDocumentUrl', {
    TerminalNumber: a.terminal,
    ApiName:        a.apiName,
    ApiPassword:    a.apiPassword,
    DocumentType:   documentType,
    DocumentNumber: documentNumber,
  })

  if (data.ResponseCode !== 0) {
    throw new Error(data.Description ?? `Cardcom URL error code ${data.ResponseCode}`)
  }

  return data.DocUrl
}

/** Cardcom InvoiceType integers → stored document_type values */
export const DOCUMENT_TYPE_BY_INVOICE_TYPE: Record<number, string> = {
  1:   'TaxInvoiceAndReceipt',
  305: 'TaxInvoice',
  400: 'ReceiptForTaxInvoice',
  330: 'TaxInvoiceRefund',
  2:   'TaxInvoiceAndReceiptRefund',
}

const RECEIPT_INVOICE_TYPES = new Set([400])

export function isReceiptInvoiceType(invoiceType: number): boolean {
  return RECEIPT_INVOICE_TYPES.has(invoiceType)
}

export function normalizeDocumentTypeKey(documentType: string): string {
  if (documentType === 'Receipt' || documentType === 'ReceiptForTaxInvoice') {
    return 'ReceiptForTaxInvoice'
  }
  return documentType
}

export interface CardcomReportDocument {
  invoiceNumber:      number
  invoiceType:        number
  documentType:       string | null
  externalId:         string | null
  asmachta:           string | null
  userComments:       string | null
  customerNumber:     number | null
  groupNumber:        number | null
  customerName:       string | null
  email:              string | null
  totalIncludeVatNis: number | null
  invoiceDate:        Date | null
}

interface CardcomGetReportResponse {
  ResponseCode: number
  Description:  string | null
  Documents?:   CardcomReportRaw[] | null
  Invoices?:    CardcomReportRaw[] | null
  Page?:        number
  Count?:       number
}

interface CardcomReportRaw {
  Invoice_Number?:        number
  InvoiceType?:           number
  ExternalId?:            string | null
  Asmachta?:              string | null
  UserComments?:          string | null
  Customer_Number?:       number | null
  group_number?:          number | null
  Cust_Name?:             string | null
  Email?:                 string | null
  TotalIncludeVATNIS?:    number | null
  InvoiceDate?:           string | null
  InvoiceDateOnly?:       string | null
}

function yyyymmdd(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function parseCardcomDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function mapReportRow(raw: CardcomReportRaw): CardcomReportDocument | null {
  const invoiceNumber = raw.Invoice_Number
  const invoiceType   = raw.InvoiceType
  if (invoiceNumber == null || invoiceType == null) return null
  return {
    invoiceNumber,
    invoiceType,
    documentType:       DOCUMENT_TYPE_BY_INVOICE_TYPE[invoiceType] ?? null,
    externalId:         raw.ExternalId?.trim() || null,
    asmachta:           raw.Asmachta?.trim() || null,
    userComments:       raw.UserComments?.trim() || null,
    customerNumber:     raw.Customer_Number ?? null,
    groupNumber:        raw.group_number ?? null,
    customerName:       raw.Cust_Name?.trim() || null,
    email:              raw.Email?.trim() || null,
    totalIncludeVatNis: raw.TotalIncludeVATNIS ?? null,
    invoiceDate:        parseCardcomDate(raw.InvoiceDate) ?? parseCardcomDate(raw.InvoiceDateOnly),
  }
}

export async function getDocumentsReport(
  from: Date,
  to: Date,
  auth?: CardcomAuth,
): Promise<CardcomReportDocument[]> {
  const a = auth ?? cardcomAuth()
  const fromStr = yyyymmdd(from)
  const toStr   = yyyymmdd(to)
  const collected: CardcomReportDocument[] = []
  const maxPages = 25

  for (let page = 1; page <= maxPages; page++) {
    const data = await post<CardcomGetReportResponse>('/Documents/GetReport', {
      TerminalNumber:   a.terminal,
      ApiName:          a.apiName,
      ApiPassword:      a.apiPassword,
      FromDateYYYYMMDD: fromStr,
      ToDateYYYYMMDD:   toStr,
      DocType:          -2,
      PageNumber:       page,
      ItemsPerPage:     200,
    })

    if (data.ResponseCode !== 0) {
      throw new Error(data.Description ?? `Cardcom GetReport error ${data.ResponseCode}`)
    }

    const rows = data.Documents ?? data.Invoices ?? []
    for (const row of rows) {
      const mapped = mapReportRow(row)
      if (mapped) collected.push(mapped)
    }
    if (rows.length < 200) break
  }

  return collected
}
