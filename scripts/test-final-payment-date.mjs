/**
 * Verify the final implementation:
 * - BankTransfer uses CustomFields (not Cash) with Hebrew label + TranDate (MM/DD/YYYY)
 * - Cheque uses Cheques with DateCheque (MM/DD/YYYY)
 * - Cash: just Cash, no date
 * - DocumentDate changes header date
 */

const BASE_URL     = 'https://secure.cardcom.solutions/api/v11'
const API_NAME     = 'kzFKfohEvL6AOF8aMEJz'
const API_PASSWORD = 'FIDHIh4pAadw3Slbdsjg'

// Same helper as cardcom.ts: DD/MM/YYYY → MM/DD/YYYY for TranDate/DateCheque
function toMMDD(ddmmyyyy) {
  const [dd, mm, yyyy] = ddmmyyyy.split('/')
  return `${mm}/${dd}/${yyyy}`
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

async function create(label, body) {
  console.log(`\n--- ${label} ---`)
  const res = await post('/Documents/CreateDocument', body)
  if (res.ResponseCode === 0) {
    const u = await post('/Documents/CreateDocumentUrl', {
      ApiName: API_NAME, ApiPassword: API_PASSWORD,
      DocumentType: res.DocumentType, DocumentNumber: res.DocumentNumber,
    })
    console.log(`✅ #${res.DocumentNumber} PDF: ${u?.DocUrl}`)
  } else {
    console.log(`❌ Error: ${JSON.stringify(res)}`)
  }
}

const items = [{ Description: 'ABDOMINAL PROTECTION black', UnitCost: 321, Quantity: 1 }]
const docBase = (extra = {}) => ({
  DocumentTypeToCreate: 'TaxInvoiceAndReceipt',
  Name: 'Denis Bogdanov',
  Email: 'denisb9@gmail.com',
  IsSendByEmail: false,
  TaxId: '987654321',
  DocumentDate: '01/03/2026',  // DD/MM/YYYY — header date
  Comments: 'Test comment printed on doc',
  Languge: 'he',
  Products: items,
  ...extra,
})

const paymentDate = '15/03/2026'  // DD/MM/YYYY from user

// 1. BankTransfer with payment date
await create('BankTransfer + payment date (CustomFields)', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  CustomFields: [{
    TransactionID: 1,
    Description: 'העברה בנקאית',
    TranDate: toMMDD(paymentDate),  // MM/DD/YYYY: 03/15/2026
    Sum: 321,
  }],
  Document: docBase(),
})

// 2. Bit with payment date
await create('Bit + payment date (CustomFields)', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  CustomFields: [{
    TransactionID: 1,
    Description: 'ביט',
    TranDate: toMMDD(paymentDate),
    Sum: 321,
  }],
  Document: docBase(),
})

// 3. Cash (no payment date)
await create('Cash (no payment date)', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cash: 321,
  Document: docBase(),
})

// 4. Cheque with DateCheque
await create('Cheque + cheque date', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  Cheques: [{
    ChequeNumber: '99999',
    BankNumber: 12,
    SnifNumber: 100,
    AccountNumber: '123456',
    DateCheque: toMMDD(paymentDate),  // MM/DD/YYYY
    Sum: 321,
  }],
  Document: docBase(),
})

console.log('\nOpen these PDFs and verify:')
console.log('- BankTransfer: shows "העברה בנקאית" + date "15/03/2026" in payment section')
console.log('- Bit: shows "ביט" + date "15/03/2026" in payment section')
console.log('- Cash: shows "מזומן", no payment date')
console.log('- Cheque: shows "המחאות" + cheque number + date "15/03/2026"')
console.log('- All: header date = 01/03/2026 (not today), TaxId 987654321 on document, comment printed')
