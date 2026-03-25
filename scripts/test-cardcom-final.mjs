/**
 * Final confirmation test — realistic TaxInvoiceAndReceipt with all fields
 * using confirmed correct field names: TaxId, DocumentDate, ValueDate, Comments
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

// ── Realistic TaxInvoiceAndReceipt with all fields ──────────────
console.log('Creating TaxInvoiceAndReceipt with TaxId + DocumentDate + ValueDate + Comments...')
const res = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 444,
  Document: {
    DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
    Name:         'Denis Bogdanov',
    Email:        'denisb9@gmail.com',
    TaxId:        '987654321',
    IsSendByEmail: false,
    DocumentDate: '01/03/2026',   // backdated document date
    ValueDate:    '15/03/2026',   // payment value date
    Comments:     'Test payment ref: CHECK-001',
    Languge:      'he',
    Products: [
      { Description: 'ABDOMINAL PROTECTION black', UnitCost: 321, Quantity: 1 },
      { Description: 'ABDOMINAL PROTECTION black', UnitCost: 123, Quantity: 1 },
    ],
  },
})

console.log('\nResponse:', JSON.stringify(res, null, 2))

if (res?.ResponseCode === 0) {
  const urlRes = await post('/Documents/CreateDocumentUrl', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    DocumentType:   res.DocumentType,
    DocumentNumber: res.DocumentNumber,
  })
  console.log('\nPDF URL:', urlRes?.DocUrl)
  console.log('\nOpen this URL in your browser to visually verify:')
  console.log('  - TaxId (987654321) appears on document')
  console.log('  - Document date shows 01/03/2026 (not today)')
  console.log('  - ValueDate 15/03/2026 appears somewhere on receipt')
  console.log('  - Comment "TEST payment ref: CHECK-001" is printed')
}
