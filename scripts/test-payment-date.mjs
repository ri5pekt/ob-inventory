/**
 * Exhaustive payment-date exploration across doc types and payment methods.
 * 
 * Key question: can we set a payment date for Cash, BankTransfer, Bit?
 * 
 * Cardcom payment structures:
 *  - Cash      → body.Cash (just a number, no date)
 *  - Cheque    → body.Cheques[{ DateCheque, Sum, ... }]
 *  - Custom    → body.CustomFields[{ TransactionID, TranDate, Sum, ... }]
 *                TransactionID codes are terminal-configured (need to discover)
 *  - ValueDate → body.Document.ValueDate (accounting value date)
 */

const BASE_URL     = 'https://secure.cardcom.solutions/api/v11'
const API_NAME     = 'kzFKfohEvL6AOF8aMEJz'
const API_PASSWORD = 'FIDHIh4pAadw3Slbdsjg'

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  try { return JSON.parse(text) } catch { return { _raw: text } }
}

async function create(label, body) {
  console.log(`\n--- ${label} ---`)
  const res = await post('/Documents/CreateDocument', body)
  if (res.ResponseCode === 0) {
    const urlRes = await post('/Documents/CreateDocumentUrl', {
      ApiName: API_NAME, ApiPassword: API_PASSWORD,
      DocumentType: res.DocumentType, DocumentNumber: res.DocumentNumber,
    })
    console.log(`✅ Doc #${res.DocumentNumber} (${res.DocumentType})`)
    console.log(`   PDF: ${urlRes?.DocUrl}`)
    return res
  } else {
    console.log(`❌ Error: ${JSON.stringify(res)}`)
    return null
  }
}

const baseDoc = (extra = {}) => ({
  DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
  Name: 'Test Customer',
  IsSendByEmail: false,
  Languge: 'he',
  Products: [{ Description: 'Test Item', UnitCost: 100, Quantity: 1, IsPriceIncludeVAT: true }],
  ...extra,
})

// ── 1. ValueDate with different formats on TaxInvoiceAndReceipt ──────────────
await create('ValueDate DD/MM/YYYY on Receipt', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: baseDoc({ ValueDate: '01/03/2026' }),
})

await create('ValueDate MM/DD/YYYY on Receipt (wrong order test)', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: baseDoc({ ValueDate: '03/01/2026' }),
})

// ── 2. DocumentDate on different document types ──────────────────────────────
await create('DocumentDate on TaxInvoice (no payment)', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Document: {
    ...baseDoc({ DocumentDate: '01/03/2026', DocumentTypeToCreate: 'TaxInvoice' }),
  },
})

await create('DocumentDate on TaxInvoiceAndReceipt', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: baseDoc({ DocumentDate: '01/03/2026' }),
})

await create('DocumentDate on Receipt', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: { ...baseDoc({ DocumentDate: '01/03/2026', DocumentTypeToCreate: 'Receipt' }) },
})

// ── 3. CustomFields — try common TransactionID values for BankTransfer/Bit ───
// TransactionIDs are terminal-configured. Common ones: 1=Cash, 5=BankTransfer, 24=custom
// Let's probe several IDs
for (const tid of [1, 2, 3, 4, 5, 10, 20, 24]) {
  await create(`CustomFields TransactionID=${tid} TranDate=01/03/2026`, {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    CustomFields: [{ TransactionID: tid, TranDate: '01/03/2026', Sum: 100, Description: `tid-${tid}` }],
    Document: baseDoc(),
  })
}

// ── 4. Cheque with DateCheque — confirm it works ─────────────────────────────
await create('Cheque payment with DateCheque=01/03/2026', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cheques: [{
    ChequeNumber: '12345',
    BankNumber: 12,
    SnifNumber: 1,
    AccountNumber: '123456',
    DateCheque: '01/03/2026',
    Sum: 100,
  }],
  Document: baseDoc(),
})

// ── 5. ValueDate at top-level (outside Document) ─────────────────────────────
await create('ValueDate at TOP LEVEL (not in Document)', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  ValueDate: '01/03/2026',
  Document: baseDoc(),
})

console.log('\n✅ All tests done. Open PDFs in browser to compare dates.')
