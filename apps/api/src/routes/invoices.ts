import type { FastifyPluginAsync } from 'fastify'
import { eq, ilike, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { sales, saleItems, cardcomDocuments, salePaymentMethods, salePaymentMethodLinks } from '@ob-inventory/db'
import {
  createDocument,
  getDocumentUrl,
  chargeCard,
  getDocumentsReport,
  isReceiptInvoiceType,
  normalizeDocumentTypeKey,
  cardcomAuth,
} from '../services/cardcom.js'
import type { CardcomAuth, CardcomDocumentType, CardcomReportDocument } from '../services/cardcom.js'

const DOCUMENT_TYPES: CardcomDocumentType[] = [
  'TaxInvoiceAndReceipt',
  'TaxInvoice',
  'Receipt',
  'TaxInvoiceRefund',
]

const PAYMENT_REQUIRED: CardcomDocumentType[] = ['TaxInvoiceAndReceipt', 'Receipt']

const LOCAL_TAX_INVOICE_TYPES = new Set(['TaxInvoice', 'TaxInvoiceAndReceipt'])

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function saleTotal(sale: { totalPrice: string | null }): number | null {
  if (sale.totalPrice == null) return null
  const n = parseFloat(sale.totalPrice)
  return Number.isNaN(n) ? null : n
}

function amountsClose(a: number | null, b: number | null, abs = 80, pct = 0.25): boolean {
  if (a == null || b == null || Number.isNaN(a) || Number.isNaN(b)) return false
  const diff = Math.abs(a - b)
  return diff <= abs || diff <= Math.max(a, b) * pct
}

function daysApart(a: Date, b: Date): number {
  const A = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())
  const B = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate())
  return Math.abs(A - B) / 86_400_000
}

function saleRefs(sale: { id: string; wooOrderId: string | null }): string[] {
  const refs = [sale.id]
  const woo = sale.wooOrderId?.trim()
  if (woo) refs.push(woo, `#${woo}`, `order #${woo}`, `order ${woo}`)
  return refs
}

function docMentionsRef(doc: CardcomReportDocument, refs: string[]): boolean {
  const fields = [doc.externalId, doc.asmachta, doc.userComments].filter((v): v is string => !!v)
  return fields.some(field => refs.some(ref => field === ref || field.includes(ref)))
}

type SaleForMatch = {
  id:            string
  wooOrderId:    string | null
  customerName:  string | null
  customerEmail: string | null
  totalPrice:    string | null
  saleDate:      Date
  createdAt:     Date
}

function isRelatedCardcomDoc(
  doc: CardcomReportDocument,
  sale: SaleForMatch,
  localDocs: Array<{ documentType: string; documentNumber: number }>,
  ourReportDocs: CardcomReportDocument[],
): boolean {
  if (docMentionsRef(doc, saleRefs(sale))) return true

  const ourCustomerNumbers = new Set(
    ourReportDocs.map(d => d.customerNumber).filter((n): n is number => n != null && n > 0),
  )
  const ourGroupNumbers = new Set(
    ourReportDocs.map(d => d.groupNumber).filter((n): n is number => n != null && n > 0),
  )

  if (doc.groupNumber != null && doc.groupNumber > 0 && ourGroupNumbers.has(doc.groupNumber)) return true

  if (doc.customerNumber != null && doc.customerNumber > 0 && ourCustomerNumbers.has(doc.customerNumber) && isReceiptInvoiceType(doc.invoiceType)) {
    return true
  }

  const emailMatch = !!norm(sale.customerEmail) && norm(doc.email) === norm(sale.customerEmail)
  const nameMatch  = !!norm(sale.customerName) && norm(doc.customerName) === norm(sale.customerName)
  const total      = saleTotal(sale)
  const amountOk   = amountsClose(doc.totalIncludeVatNis, total)
  const saleDay    = sale.saleDate < sale.createdAt ? sale.saleDate : sale.createdAt
  const dateOk     = !!doc.invoiceDate && daysApart(doc.invoiceDate, saleDay) <= 2
  const hasLocalTaxInvoice = localDocs.some(d => LOCAL_TAX_INVOICE_TYPES.has(d.documentType))
  const paidTotal  = (doc.totalIncludeVatNis ?? 0) > 0

  // Receipt created later on Cardcom after an OB tax invoice (payment link)
  if (hasLocalTaxInvoice && isReceiptInvoiceType(doc.invoiceType) && (emailMatch || nameMatch)) {
    return true
  }

  // Woo / store-terminal docs: no ExternalId. Match customer + date + similar amount.
  if (emailMatch && dateOk && amountOk && paidTotal) return true
  if (!emailMatch && nameMatch && dateOk && amountOk && paidTotal) return true

  return false
}

async function documentsWithUrls(saleId: string, auth?: CardcomAuth) {
  const docs = await db
    .select()
    .from(cardcomDocuments)
    .where(eq(cardcomDocuments.saleId, saleId))
    .orderBy(cardcomDocuments.createdAt)

  return Promise.all(
    docs.map(async (doc) => {
      let docUrl: string | null = null
      try {
        docUrl = await getDocumentUrl(doc.documentType, doc.documentNumber, auth)
      } catch {
        // non-fatal — return doc without URL if Cardcom is unreachable
      }
      return {
        id:             doc.id,
        documentType:   doc.documentType,
        documentNumber: doc.documentNumber,
        createdAt:      doc.createdAt,
        docUrl,
      }
    }),
  )
}

export const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── GET /api/sales/:id/documents ───────────────────────────────────────────
  fastify.get('/api/sales/:id/documents', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)
    const [sale] = await db.select({
      saleType:   sales.saleType,
      wooOrderId: sales.wooOrderId,
    }).from(sales).where(eq(sales.id, id)).limit(1)
    const cardcom = sale && (sale.saleType === 'woocommerce' || sale.wooOrderId)
      ? cardcomAuth(true)
      : undefined
    return documentsWithUrls(id, cardcom)
  })

  // ── POST /api/sales/:id/documents/pull ─────────────────────────────────────
  // Manual check: import Cardcom-side documents for this sale (e.g. receipt after payment link).
  fastify.post('/api/sales/:id/documents/pull', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1)
    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    const localDocs = await db
      .select()
      .from(cardcomDocuments)
      .where(eq(cardcomDocuments.saleId, id))

    // Woo store charges hit the production terminal, even when this app is in test mode.
    const useProd = sale.saleType === 'woocommerce' || !!sale.wooOrderId
    const cardcom = cardcomAuth(useProd)

    const from = new Date(Math.min(sale.saleDate.getTime(), sale.createdAt.getTime()))
    from.setUTCDate(from.getUTCDate() - 2)
    const to = new Date()
    to.setUTCDate(to.getUTCDate() + 1)

    let report: CardcomReportDocument[]
    try {
      report = await getDocumentsReport(from, to, cardcom)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cardcom GetReport failed'
      return reply.status(502).send({ error: msg })
    }

    const ourReportDocs = report.filter(doc =>
      localDocs.some(local =>
        local.documentNumber === doc.invoiceNumber
        && normalizeDocumentTypeKey(local.documentType) === normalizeDocumentTypeKey(doc.documentType ?? ''),
      ),
    )

    const candidates = report.filter(doc => {
      if (!doc.documentType) return false
      return isRelatedCardcomDoc(doc, sale, localDocs, ourReportDocs)
    })

    const candidateNumbers = [...new Set(candidates.map(c => c.invoiceNumber))]
    const existingRows = candidateNumbers.length > 0
      ? await db
          .select({
            saleId:         cardcomDocuments.saleId,
            documentType:   cardcomDocuments.documentType,
            documentNumber: cardcomDocuments.documentNumber,
          })
          .from(cardcomDocuments)
          .where(inArray(cardcomDocuments.documentNumber, candidateNumbers))
      : []

    const alreadyStored = new Set(
      existingRows.map(r => `${normalizeDocumentTypeKey(r.documentType)}:${r.documentNumber}`),
    )

    const toInsert = candidates.filter(doc => {
      const key = `${normalizeDocumentTypeKey(doc.documentType!)}:${doc.invoiceNumber}`
      if (alreadyStored.has(key)) return false
      alreadyStored.add(key)
      return true
    })

    for (const doc of toInsert) {
      await db.insert(cardcomDocuments).values({
        saleId:         id,
        documentType:   doc.documentType!,
        documentNumber: doc.invoiceNumber,
        createdAt:      doc.invoiceDate ?? new Date(),
      })
    }

    const documents = await documentsWithUrls(id, cardcom)
    return {
      pulledCount: toInsert.length,
      documents,
    }
  })

  // ── POST /api/sales/:id/documents ──────────────────────────────────────────
  fastify.post('/api/sales/:id/documents', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const { documentType, sendEmail, override } = z.object({
      documentType: z.enum(DOCUMENT_TYPES as [CardcomDocumentType, ...CardcomDocumentType[]]),
      sendEmail:    z.boolean().default(true),
      override: z.object({
        customerName:  z.string().min(1).optional(),
        customerEmail: z.string().nullable().optional(),
        totalPrice:    z.preprocess(v => v == null ? null : String(v), z.string().nullable()).optional(),
        items: z.array(z.object({
          name:      z.string(),
          quantity:  z.number().min(0),
          unitPrice: z.preprocess(v => v == null ? null : String(v), z.string().nullable()),
        })).optional(),
        hp_tz:        z.string().optional(),
        documentDate: z.string().optional(),   // DD/MM/YYYY — document issue date
        isVatFree:    z.boolean().optional(),
        paymentType:  z.enum(['Cash', 'BankTransfer', 'CreditCard', 'Bit', 'Cheque']).optional(),
        paymentDate:  z.string().optional(),   // DD/MM/YYYY — payment date (TranDate/DateCheque); not for Cash
        asmachta:     z.string().optional(),   // reference number; CustomFields only (BankTransfer/Bit/CreditCard)
        comments:     z.string().optional(),
        cheque: z.object({
          chequeNumber:  z.string().optional(),
          bankNumber:    z.coerce.number().optional(),
          snifNumber:    z.coerce.number().optional(),
          accountNumber: z.string().optional(),
        }).optional(),
      }).optional(),
    }).parse(request.body)

    // Load sale
    const [sale] = await db
      .select()
      .from(sales)
      .where(eq(sales.id, id))
      .limit(1)

    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    // Only fetch DB items if no override items provided
    const dbItems = override?.items == null
      ? await db.select().from(saleItems).where(eq(saleItems.saleId, id))
      : []

    // Resolve effective values (override takes precedence over DB)
    const effectiveCustomerName  = override?.customerName  ?? sale.customerName
    const effectiveCustomerEmail = override?.customerEmail !== undefined ? override.customerEmail : sale.customerEmail
    const effectiveTotalPrice    = override?.totalPrice    !== undefined ? override.totalPrice    : sale.totalPrice
    const effectiveItems         = override?.items ?? dbItems.map(i => ({
      name: i.name, quantity: i.quantity, unitPrice: i.unitPrice,
    }))

    // Validate required fields
    const missing: string[] = []
    if (!effectiveCustomerName) missing.push('customerName')
    if (!effectiveTotalPrice && PAYMENT_REQUIRED.includes(documentType)) missing.push('totalPrice')

    if (missing.length > 0) {
      return reply.status(400).send({
        error:   'Missing required sale data for document creation',
        missing,
      })
    }

    // Create document in Cardcom
    const { documentNumber, documentType: createdType } = await createDocument(
      documentType,
      {
        id:            sale.id,
        customerName:  effectiveCustomerName,
        customerEmail: effectiveCustomerEmail,
        customerPhone: sale.customerPhone,
        customerAddress: sale.customerAddress,
        totalPrice:    effectiveTotalPrice,
        items:         effectiveItems,
        hp_tz:         override?.hp_tz,
        documentDate:  override?.documentDate,
        isVatFree:     override?.isVatFree,
        paymentType:   override?.paymentType,
        paymentDate:   override?.paymentDate,
        asmachta:      override?.asmachta,
        comments:      override?.comments,
        cheque:        override?.cheque,
      },
      sendEmail,
    )

    // Persist to DB
    const [row] = await db
      .insert(cardcomDocuments)
      .values({
        saleId:         id,
        documentType:   createdType,
        documentNumber,
      })
      .returning()

    // Fetch PDF URL
    let docUrl: string | null = null
    try {
      docUrl = await getDocumentUrl(createdType, documentNumber)
    } catch {
      // non-fatal
    }

    return reply.status(201).send({
      id:             row.id,
      documentType:   row.documentType,
      documentNumber: row.documentNumber,
      createdAt:      row.createdAt,
      docUrl,
    })
  })

  // ── POST /api/sales/:id/charge-card ────────────────────────────────────────
  // Charges a credit card via Cardcom terminal and creates a TaxInvoiceAndReceipt.
  fastify.post('/api/sales/:id/charge-card', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const body = z.object({
      cardNumber:    z.string().min(13).max(19),
      cardExpiry:    z.string().regex(/^\d{4}$/, 'Must be MMYY'),
      cvv:           z.string().min(3).max(4),
      numOfPayments: z.coerce.number().int().min(1).max(36).default(1),
      // Optional overrides (pre-filled from sale but admin can edit)
      customerName:  z.string().min(1).optional(),
      customerEmail: z.string().nullable().optional(),
      isVatFree:     z.boolean().default(false),
      items: z.array(z.object({
        name:      z.string(),
        quantity:  z.number().min(1),
        unitPrice: z.number().min(0),
      })).optional(),
    }).parse(request.body)

    // Load sale
    const [sale] = await db.select().from(sales).where(eq(sales.id, id)).limit(1)
    if (!sale) return reply.status(404).send({ error: 'Sale not found' })

    // Resolve items
    const dbItems = body.items == null
      ? await db.select().from(saleItems).where(eq(saleItems.saleId, id))
      : []

    const resolvedItems = body.items ?? dbItems.map(i => ({
      name:      i.name,
      quantity:  i.quantity,
      unitPrice: parseFloat(i.unitPrice ?? '0'),
    }))

    const resolvedName  = body.customerName  ?? sale.customerName  ?? 'לקוח'
    const resolvedEmail = body.customerEmail !== undefined ? body.customerEmail : sale.customerEmail

    if (resolvedItems.length === 0) {
      return reply.status(400).send({ error: 'No items — cannot charge an empty sale' })
    }

    const amount = resolvedItems.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0)

    // Charge card + create document in one Cardcom call
    let result: Awaited<ReturnType<typeof chargeCard>>
    try {
      result = await chargeCard({
        saleId:        id,
        customerName:  resolvedName,
        customerEmail: resolvedEmail,
        amount,
        cardNumber:    body.cardNumber,
        cardExpiry:    body.cardExpiry,
        cvv:           body.cvv,
        numOfPayments: body.numOfPayments,
        isVatFree:     body.isVatFree,
        items:         resolvedItems,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Cardcom charge failed'
      return reply.status(422).send({ error: msg })
    }

    // Save document to DB
    const [row] = await db.insert(cardcomDocuments).values({
      saleId:         id,
      documentType:   result.documentType,
      documentNumber: result.documentNumber,
      transactionId:  result.transactionId,
      last4Digits:    result.last4Digits,
      cardBrand:      result.cardBrand,
    }).returning()

    // Auto-assign the "קארדקום OB" payment method
    const [cardcomPM] = await db
      .select()
      .from(salePaymentMethods)
      .where(ilike(salePaymentMethods.name, 'קארדקום OB'))
      .limit(1)

    if (cardcomPM) {
      // Upsert — don't add duplicate link if it's already there
      const existingLinks = await db
        .select()
        .from(salePaymentMethodLinks)
        .where(eq(salePaymentMethodLinks.saleId, id))

      const alreadyLinked = existingLinks.some(l => l.paymentMethodId === cardcomPM.id)
      if (!alreadyLinked) {
        await db.insert(salePaymentMethodLinks).values({
          saleId:          id,
          paymentMethodId: cardcomPM.id,
        })
      }
    }

    return reply.status(201).send({
      id:             row.id,
      documentType:   row.documentType,
      documentNumber: row.documentNumber,
      transactionId:  row.transactionId,
      last4Digits:    row.last4Digits,
      cardBrand:      row.cardBrand,
      createdAt:      row.createdAt,
      docUrl:         result.documentUrl,
    })
  })
}
