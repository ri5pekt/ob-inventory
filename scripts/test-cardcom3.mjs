/**
 * Check GetReport page 2, and test ValueDate more carefully
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
  return res.json()
}

// ── GetReport page 2 to find docs 632736, 632737 ──────────────
console.log('\n=== GetReport page 2 — find 632736, 632737 ===')
const r2 = await post('/Documents/GetReport', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  FromDateYYYYMMDD: '20260319',
  ToDateYYYYMMDD: '20260319',
  DocType: -2,
  PageNumber: 2,
})
const targets2 = (r2.Documents ?? []).filter(d => [632736, 632737].includes(d.Invoice_Number))
for (const d of targets2) {
  console.log(`\nDoc #${d.Invoice_Number}:`)
  console.log('  Comp_ID:', JSON.stringify(d.Comp_ID))
  console.log('  InvoiceDateOnly:', d.InvoiceDateOnly)
  console.log('  ValueDate:', d.ValueDate)
  console.log('  UserComments:', d.UserComments)
}
if (!targets2.length) console.log('Not found on page 2. Docs on page 2:', r2.Documents?.map(d=>d.Invoice_Number))

// Also try page 1 filtered
console.log('\n=== GetReport page 1 — find 632736, 632737 ===')
const r1 = await post('/Documents/GetReport', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  FromDateYYYYMMDD: '20260319',
  ToDateYYYYMMDD: '20260319',
  DocType: -2,
  PageNumber: 1,
})
const targets1 = (r1.Documents ?? []).filter(d => [632736, 632737, 6811, 6812].includes(d.Invoice_Number))
for (const d of targets1) {
  console.log(`\nDoc #${d.Invoice_Number}:`)
  console.log('  Comp_ID:', JSON.stringify(d.Comp_ID))
  console.log('  InvoiceDateOnly:', d.InvoiceDateOnly)
  console.log('  ValueDate:', d.ValueDate)
  console.log('  UserComments:', d.UserComments)
}
console.log('\nAll doc numbers on page 1:', r1.Documents?.map(d=>d.Invoice_Number))

// ── Test ValueDate with YYYY-MM-DD ──────────────────────────────
console.log('\n=== Test ValueDate with YYYY-MM-DD format ===')
const F = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: {
    DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
    Name: 'ValueDate Test ISO',
    ValueDate: '2026-03-15',
    IsSendByEmail: false,
    Languge: 'he',
    Products: [{ Description: 'Test', UnitCost: 100, Quantity: 1, IsPriceIncludeVAT: true }],
  },
})
console.log('Result:', F)

// ── Download PDFs for manual visual inspection ──────────────────
console.log('\n=== PDF URLs to open in browser ===')
const pdfs = {
  'TestA TaxId (#6811)':           'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=Il4kt/HOONbhdLgX8SkeSXebZZU85XKQ04pti3hvsJvQvxi9gkzbEFrNE4ff3l00',
  'TestC DocumentDate 01/03 (#6812)': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=ArzE2C3tdGd4euieetXNJl38sKKvLJDno27LoSd7Fiy5x22u3EvZolFH05pA7ATH',
  'TestD ValueDate 15/03 (#632736)': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=W+hXrFYq9wK4qUbisSU/hHOsfrGq7QQAJdiodMnQRoaZHDRjByDJ+5zdMSD7bpWe',
  'TestE All fields (#632737)':     'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=GRjlu+Evhbl83VjYraV6zsAtBuxw/lg2q5SDqvLewJ7QL6zyptcfWKXBdkf1sYsR',
}
for (const [k, v] of Object.entries(pdfs)) console.log(`${k}:\n  ${v}`)
