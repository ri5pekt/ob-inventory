/**
 * Test correct field names: TaxId, DocumentDate (not DocumentDateDDMMYYYY), ValueDate formats
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
  const json = await res.json()
  return json
}

async function getUrl(documentType, documentNumber) {
  return post('/Documents/CreateDocumentUrl', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    DocumentType: documentType, DocumentNumber: documentNumber,
  })
}

async function getReport(docNumber) {
  const r = await post('/Documents/GetReport', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    FromDateYYYYMMDD: '20260319',
    ToDateYYYYMMDD: '20260319',
    DocType: -2,
    PageNumber: 1,
  })
  if (!r.Documents) { console.log('GetReport error:', r); return null }
  return r.Documents.find(d => d.Invoice_Number === docNumber) ?? null
}

// ──────────────────────────────────────────────────────────────
// Test A: TaxId field (instead of HP_TZ)
// ──────────────────────────────────────────────────────────────
console.log('\n=== TEST A: TaxId field ===')
const A = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Document: {
    DocumentTypeToCreate: 'TaxInvoice',
    Name: 'Test TaxId',
    TaxId: '123456789',
    Languge: 'he',
    Products: [{ Description: 'Test', UnitCost: 100, Quantity: 1 }],
  },
})
console.log('Result:', A)
if (A?.ResponseCode === 0) {
  const report = await getReport(A.DocumentNumber)
  console.log('Report Comp_ID:', JSON.stringify(report?.Comp_ID))
  const url = await getUrl(A.DocumentType, A.DocumentNumber)
  console.log('PDF:', url?.DocUrl)
}

// ──────────────────────────────────────────────────────────────
// Test B: DocumentDate with YYYY-MM-DD
// ──────────────────────────────────────────────────────────────
console.log('\n=== TEST B: DocumentDate = "2026-03-01" (ISO YYYY-MM-DD) ===')
const B = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Document: {
    DocumentTypeToCreate: 'TaxInvoice',
    Name: 'Test DocumentDate ISO',
    DocumentDate: '2026-03-01',
    Languge: 'he',
    Products: [{ Description: 'Test', UnitCost: 100, Quantity: 1 }],
  },
})
console.log('Result:', B)
if (B?.ResponseCode === 0) {
  const report = await getReport(B.DocumentNumber)
  console.log('Report InvoiceDateOnly:', report?.InvoiceDateOnly)
  const url = await getUrl(B.DocumentType, B.DocumentNumber)
  console.log('PDF:', url?.DocUrl)
}

// ──────────────────────────────────────────────────────────────
// Test C: DocumentDate with DD/MM/YYYY
// ──────────────────────────────────────────────────────────────
console.log('\n=== TEST C: DocumentDate = "01/03/2026" (DD/MM/YYYY) ===')
const C = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Document: {
    DocumentTypeToCreate: 'TaxInvoice',
    Name: 'Test DocumentDate Slash',
    DocumentDate: '01/03/2026',
    Languge: 'he',
    Products: [{ Description: 'Test', UnitCost: 100, Quantity: 1 }],
  },
})
console.log('Result:', C)
if (C?.ResponseCode === 0) {
  const report = await getReport(C.DocumentNumber)
  console.log('Report InvoiceDateOnly:', report?.InvoiceDateOnly)
  const url = await getUrl(C.DocumentType, C.DocumentNumber)
  console.log('PDF:', url?.DocUrl)
}

// ──────────────────────────────────────────────────────────────
// Test D: ValueDate with DD/MM/YYYY format (TaxInvoiceAndReceipt)
// ──────────────────────────────────────────────────────────────
console.log('\n=== TEST D: ValueDate = "15/03/2026" on TaxInvoiceAndReceipt ===')
const D = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: {
    DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
    Name: 'Test ValueDate',
    ValueDate: '15/03/2026',
    Languge: 'he',
    Products: [{ Description: 'Test', UnitCost: 100, Quantity: 1, IsPriceIncludeVAT: true }],
  },
})
console.log('Result:', D)
if (D?.ResponseCode === 0) {
  const report = await getReport(D.DocumentNumber)
  console.log('Report ValueDate:', report?.ValueDate)
  const url = await getUrl(D.DocumentType, D.DocumentNumber)
  console.log('PDF:', url?.DocUrl)
}

// ──────────────────────────────────────────────────────────────
// Test E: All correct fields together
// ──────────────────────────────────────────────────────────────
console.log('\n=== TEST E: All correct fields — TaxId, DocumentDate, ValueDate ===')
const E = await post('/Documents/CreateDocument', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 100,
  Document: {
    DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
    Name: 'Denis Bogdanov',
    Email: 'denisb9@gmail.com',
    TaxId: '123456789',
    IsSendByEmail: false,
    DocumentDate: '01/03/2026',
    ValueDate: '15/03/2026',
    Comments: 'Test comment on document',
    Languge: 'he',
    Products: [{ Description: 'Test Product', UnitCost: 100, Quantity: 1, IsPriceIncludeVAT: true }],
  },
})
console.log('Result:', E)
if (E?.ResponseCode === 0) {
  const report = await getReport(E.DocumentNumber)
  console.log('Report Comp_ID:', JSON.stringify(report?.Comp_ID))
  console.log('Report InvoiceDateOnly:', report?.InvoiceDateOnly)
  console.log('Report ValueDate:', report?.ValueDate)
  console.log('Report UserComments:', report?.UserComments)
  const url = await getUrl(E.DocumentType, E.DocumentNumber)
  console.log('PDF:', url?.DocUrl)
}
