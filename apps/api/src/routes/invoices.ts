import type { FastifyPluginAsync } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db.js'
import { sales, saleItems, cardcomDocuments } from '@ob-inventory/db'
import { createDocument, getDocumentUrl } from '../services/cardcom.js'
import type { CardcomDocumentType } from '../services/cardcom.js'

const DOCUMENT_TYPES: CardcomDocumentType[] = [
  'TaxInvoiceAndReceipt',
  'TaxInvoice',
  'Receipt',
  'TaxInvoiceRefund',
]

const PAYMENT_REQUIRED: CardcomDocumentType[] = ['TaxInvoiceAndReceipt', 'Receipt']

export const invoicesRoutes: FastifyPluginAsync = async (fastify) => {
  const auth = { onRequest: [fastify.authenticate] }

  // ── GET /api/sales/:id/documents ───────────────────────────────────────────
  fastify.get('/api/sales/:id/documents', auth, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params)

    const docs = await db
      .select()
      .from(cardcomDocuments)
      .where(eq(cardcomDocuments.saleId, id))
      .orderBy(cardcomDocuments.createdAt)

    const results = await Promise.all(
      docs.map(async (doc) => {
        let docUrl: string | null = null
        try {
          docUrl = await getDocumentUrl(doc.documentType, doc.documentNumber)
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

    return results
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
}
