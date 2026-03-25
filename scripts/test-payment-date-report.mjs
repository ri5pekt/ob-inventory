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

const targets = {
  632751: 'ValueDate DD/MM/YYYY 01/03/2026',
  632752: 'ValueDate MM/DD/YYYY 03/01/2026',
  6813:   'DocumentDate TaxInvoice',
  632753: 'DocumentDate TaxInvoiceAndReceipt',
  22631:  'DocumentDate Receipt',
  632754: 'CustomFields tid=1',
  632755: 'CustomFields tid=2',
  632758: 'CustomFields tid=5',
  632762: 'Cheque DateCheque=01/03/2026',
  632763: 'ValueDate top-level',
}

const r = await post('/Documents/GetReport', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  FromDateYYYYMMDD: '20260319',
  ToDateYYYYMMDD: '20260319',
  DocType: -2,
  PageNumber: 1,
})

console.log('Docs on page 1:', r.Documents?.map(d => d.Invoice_Number))

for (const [num, label] of Object.entries(targets)) {
  const d = r.Documents?.find(x => x.Invoice_Number === Number(num))
  if (!d) { console.log(`\n❓ ${label} (#${num}) — NOT FOUND on page 1`); continue }
  console.log(`\n✅ ${label} (#${num})`)
  console.log(`   InvoiceDateOnly: ${d.InvoiceDateOnly}`)
  console.log(`   ValueDate:       ${d.ValueDate}`)
  console.log(`   TotalChashNIS:   ${d.TotalChashNIS}`)
  console.log(`   TotalChequesNIS: ${d.TotalChequesNIS}`)
  console.log(`   TotalCustomeTransactionNIS: ${d.TotalCustomeTransactionNIS}`)
}

// Check page 2 for 22631 (Receipt)
const r2 = await post('/Documents/GetReport', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  FromDateYYYYMMDD: '20260319',
  ToDateYYYYMMDD: '20260319',
  DocType: -2,
  PageNumber: 2,
})
console.log('\nDocs on page 2:', r2.Documents?.map(d => d.Invoice_Number))
const d22631 = r2.Documents?.find(x => x.Invoice_Number === 22631)
if (d22631) {
  console.log(`\n✅ Receipt #22631 (page 2) — DocumentDate=01/03/2026`)
  console.log(`   InvoiceDateOnly: ${d22631.InvoiceDateOnly}`)
  console.log(`   ValueDate:       ${d22631.ValueDate}`)
}
