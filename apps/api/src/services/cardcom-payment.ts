import { eq, ilike } from 'drizzle-orm'
import { db } from '../db.js'
import {
  cardcomDocuments,
  cardcomLowprofileRequests,
  salePaymentMethods,
  salePaymentMethodLinks,
} from '@ob-inventory/db'
import { getLowProfileResult } from './cardcom.js'

/**
 * Shared "payment succeeded" tail — used by both the manual charge-card route
 * (apps/api/src/routes/invoices.ts) and the LowProfile/QR finalize path below.
 * Guarantees identical downstream behavior no matter which flow the card details
 * came through: same cardcom_documents row shape, same auto-linked payment method.
 */
export async function recordCardcomPayment(saleId: string, result: {
  documentType:   string
  documentNumber: number
  transactionId:  number
  last4Digits:    string
  cardBrand:      string
}): Promise<{ documentId: string }> {
  const [row] = await db.insert(cardcomDocuments).values({
    saleId,
    documentType:   result.documentType,
    documentNumber: result.documentNumber,
    transactionId:  result.transactionId,
    last4Digits:    result.last4Digits,
    cardBrand:      result.cardBrand,
  }).returning()

  // Auto-assign the "קארדקום OB" payment method — same convention as the manual charge flow.
  const [cardcomPM] = await db
    .select()
    .from(salePaymentMethods)
    .where(ilike(salePaymentMethods.name, 'קארדקום OB'))
    .limit(1)

  if (cardcomPM) {
    const existingLinks = await db
      .select()
      .from(salePaymentMethodLinks)
      .where(eq(salePaymentMethodLinks.saleId, saleId))

    const alreadyLinked = existingLinks.some(l => l.paymentMethodId === cardcomPM.id)
    if (!alreadyLinked) {
      await db.insert(salePaymentMethodLinks).values({
        saleId,
        paymentMethodId: cardcomPM.id,
      })
    }
  }

  return { documentId: row.id }
}

export interface FinalizeResult {
  status:         'pending' | 'paid' | 'failed' | 'expired' | 'cancelled' | 'paid_after_cancel'
  documentId?:    string
  documentNumber?: number
  documentType?:   string
  last4Digits?:    string
  cardBrand?:      string
  docUrl?:         string | null
}

/**
 * Idempotent — always safe to call more than once (webhook and polling both call this,
 * possibly racing each other). Re-verifies against Cardcom's own GetLpResult before
 * doing anything; never trusts a webhook body directly (see dev plan's "Webhook trust"
 * decision).
 */
export async function finalizeLowProfilePayment(lowProfileId: string): Promise<FinalizeResult | null> {
  const [reqRow] = await db
    .select()
    .from(cardcomLowprofileRequests)
    .where(eq(cardcomLowprofileRequests.lowProfileId, lowProfileId))
    .limit(1)

  if (!reqRow) return null // Unknown LowProfileId — stale/replayed webhook, ignore.

  // 'paid' / 'paid_after_cancel' / 'failed' / 'expired' are all genuinely terminal —
  // nothing more to do. 'cancelled' is NOT terminal on Cardcom's side (we only stopped
  // caring locally), so a 'cancelled' request still gets checked below in case the
  // customer paid anyway right after staff hit Cancel.
  const wasCancelledLocally = reqRow.status === 'cancelled'
  if (reqRow.status !== 'pending' && !wasCancelledLocally) {
    return await withDocumentDetails(reqRow)
  }

  const result = await getLowProfileResult(lowProfileId)

  if (result.responseCode === 0 && result.transaction) {
    // Money moved regardless of the local cancel — must not lose the paper trail,
    // just flag it differently so it surfaces for manual review.
    const finalStatus = wasCancelledLocally ? 'paid_after_cancel' : 'paid'

    const { documentId } = await recordCardcomPayment(reqRow.saleId, {
      documentType:   result.document?.documentType   ?? 'TaxInvoiceAndReceipt',
      documentNumber: result.document?.documentNumber  ?? 0,
      transactionId:  result.transaction.transactionId,
      last4Digits:    result.transaction.last4Digits,
      cardBrand:      result.transaction.cardBrand,
    })

    const [updated] = await db
      .update(cardcomLowprofileRequests)
      .set({
        status:     finalStatus,
        documentId,
        rawResult:  result.raw as object,
        resolvedAt: new Date(),
      })
      .where(eq(cardcomLowprofileRequests.id, reqRow.id))
      .returning()

    return await withDocumentDetails(updated, result.document?.documentUrl ?? null)
  }

  // No transaction yet — genuinely still pending (or cancelled-and-still-unpaid).
  // Deliberately not trying to detect "explicit failure" from ResponseCode here: Cardcom's
  // GetLpResult uses the same response shape for "not paid yet" and we don't have a
  // reliable signal to tell that apart from a real decline without production testing.
  // Termination for the never-completes case is handled by the request's own local
  // expiry (10 min) in the polling route, not here.
  return await withDocumentDetails(reqRow)
}

async function withDocumentDetails(
  row: typeof cardcomLowprofileRequests.$inferSelect,
  docUrl: string | null = null,
): Promise<FinalizeResult> {
  const base: FinalizeResult = { status: row.status, documentId: row.documentId ?? undefined }
  if (!row.documentId) return base

  const [doc] = await db
    .select()
    .from(cardcomDocuments)
    .where(eq(cardcomDocuments.id, row.documentId))
    .limit(1)

  if (!doc) return base

  return {
    ...base,
    documentNumber: doc.documentNumber,
    documentType:   doc.documentType,
    last4Digits:    doc.last4Digits ?? undefined,
    cardBrand:      doc.cardBrand ?? undefined,
    docUrl,
  }
}
