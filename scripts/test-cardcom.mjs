/**
 * Direct Cardcom API test — run with:  node scripts/test-cardcom.mjs
 * Tests which fields actually appear on the generated document.
 */

const BASE_URL    = 'https://secure.cardcom.solutions/api/v11'
const API_NAME    = 'kzFKfohEvL6AOF8aMEJz'
const API_PASSWORD = 'FIDHIh4pAadw3Slbdsjg'

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  console.log(`\n--- ${path} HTTP ${res.status} ---`)
  try { return JSON.parse(text) } catch { console.log('Raw:', text); return null }
}

async function getUrl(documentType, documentNumber) {
  return post('/Documents/CreateDocumentUrl', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    DocumentType: documentType, DocumentNumber: documentNumber,
  })
}

// ──────────────────────────────────────────────────────────────
// Test 1: HP_TZ as Document field
// ──────────────────────────────────────────────────────────────
async function test1_hptz_document_field() {
  console.log('\n\n=== TEST 1: HP_TZ as Document.HP_TZ ===')
  const res = await post('/Documents/CreateDocument', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    Document: {
      DocumentTypeToCreate: 'TaxInvoice',
      Name: 'Test Customer',
      HP_TZ: '123456789',
      Languge: 'he',
      Products: [{ Description: 'Test Item', UnitCost: 100, Quantity: 1 }],
    },
  })
  console.log(res)
  if (res?.ResponseCode === 0) {
    const url = await getUrl(res.DocumentType, res.DocumentNumber)
    console.log('PDF:', url?.DocUrl)
  }
  return res
}

// ──────────────────────────────────────────────────────────────
// Test 2: HP_TZ at top level (not inside Document)
// ──────────────────────────────────────────────────────────────
async function test2_hptz_top_level() {
  console.log('\n\n=== TEST 2: HP_TZ at top level ===')
  const res = await post('/Documents/CreateDocument', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    HP_TZ: '123456789',
    Document: {
      DocumentTypeToCreate: 'TaxInvoice',
      Name: 'Test Customer',
      Languge: 'he',
      Products: [{ Description: 'Test Item', UnitCost: 100, Quantity: 1 }],
    },
  })
  console.log(res)
  if (res?.ResponseCode === 0) {
    const url = await getUrl(res.DocumentType, res.DocumentNumber)
    console.log('PDF:', url?.DocUrl)
  }
  return res
}

// ──────────────────────────────────────────────────────────────
// Test 3: DocumentDateDDMMYYYY — try DDMMYYYY (no slashes)
// ──────────────────────────────────────────────────────────────
async function test3_date_noSlash() {
  console.log('\n\n=== TEST 3: DocumentDateDDMMYYYY = "01032026" (no slashes) ===')
  const res = await post('/Documents/CreateDocument', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    Document: {
      DocumentTypeToCreate: 'TaxInvoice',
      Name: 'Test Customer',
      DocumentDateDDMMYYYY: '01032026',
      Languge: 'he',
      Products: [{ Description: 'Test Item', UnitCost: 100, Quantity: 1 }],
    },
  })
  console.log(res)
  if (res?.ResponseCode === 0) {
    const url = await getUrl(res.DocumentType, res.DocumentNumber)
    console.log('PDF:', url?.DocUrl)
  }
  return res
}

// ──────────────────────────────────────────────────────────────
// Test 4: DocumentDateDDMMYYYY — try DD/MM/YYYY (with slashes)
// ──────────────────────────────────────────────────────────────
async function test4_date_slash() {
  console.log('\n\n=== TEST 4: DocumentDateDDMMYYYY = "01/03/2026" (with slashes) ===')
  const res = await post('/Documents/CreateDocument', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    Document: {
      DocumentTypeToCreate: 'TaxInvoice',
      Name: 'Test Customer',
      DocumentDateDDMMYYYY: '01/03/2026',
      Languge: 'he',
      Products: [{ Description: 'Test Item', UnitCost: 100, Quantity: 1 }],
    },
  })
  console.log(res)
  if (res?.ResponseCode === 0) {
    const url = await getUrl(res.DocumentType, res.DocumentNumber)
    console.log('PDF:', url?.DocUrl)
  }
  return res
}

// ──────────────────────────────────────────────────────────────
// Test 5: ValueDate — try DD/MM/YYYY
// ──────────────────────────────────────────────────────────────
async function test5_valueDate() {
  console.log('\n\n=== TEST 5: ValueDate = "15/03/2026" ===')
  const res = await post('/Documents/CreateDocument', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    Document: {
      DocumentTypeToCreate: 'TaxInvoice',
      Name: 'Test Customer',
      ValueDate: '15/03/2026',
      Languge: 'he',
      Products: [{ Description: 'Test Item', UnitCost: 100, Quantity: 1 }],
    },
  })
  console.log(res)
  if (res?.ResponseCode === 0) {
    const url = await getUrl(res.DocumentType, res.DocumentNumber)
    console.log('PDF:', url?.DocUrl)
  }
  return res
}

// ──────────────────────────────────────────────────────────────
// Test 6: All fields together — payment-required with Cash
// ──────────────────────────────────────────────────────────────
async function test6_all_fields() {
  console.log('\n\n=== TEST 6: TaxInvoiceAndReceipt with all new fields ===')
  const res = await post('/Documents/CreateDocument', {
    ApiName: API_NAME, ApiPassword: API_PASSWORD,
    Cash: 100,
    Document: {
      DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
      Name: 'Denis Bogdanov',
      Email: 'denisb9@gmail.com',
      IsSendByEmail: false,
      HP_TZ: '123456789',
      DocumentDateDDMMYYYY: '01032026',
      ValueDate: '15/03/2026',
      Comments: 'Test comment printed on doc',
      Languge: 'he',
      Products: [{ Description: 'Test Product', UnitCost: 100, Quantity: 1, IsPriceIncludeVAT: true }],
    },
  })
  console.log(res)
  if (res?.ResponseCode === 0) {
    const url = await getUrl(res.DocumentType, res.DocumentNumber)
    console.log('PDF:', url?.DocUrl)
  }
  return res
}

// ──────────────────────────────────────────────────────────────
// Run all tests
// ──────────────────────────────────────────────────────────────
;(async () => {
  await test1_hptz_document_field()
  await test2_hptz_top_level()
  await test3_date_noSlash()
  await test4_date_slash()
  await test5_valueDate()
  await test6_all_fields()
})()
