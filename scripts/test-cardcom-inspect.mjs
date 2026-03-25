import { writeFileSync } from 'fs'

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
  try { return JSON.parse(text) } catch { return text }
}

// ── 1. Query GetReport to see what was stored for today's test docs ────────
console.log('\n=== GetReport — today\'s test documents ===')
const report = await post('/Documents/GetReport', {
  ApiName: API_NAME, ApiPassword: API_PASSWORD,
  FromDateYYYYMMDD: '20260319',
  ToDateYYYYMMDD:   '20260319',
  DocType: -2,
  PageNumber: 1,
})

if (report?.Invoices) {
  // Filter for our test docs 6806-6810 + 632735
  const testDocs = report.Invoices.filter(d =>
    (d.Invoice_Number >= 6806 && d.Invoice_Number <= 6810) ||
    d.Invoice_Number === 632735
  )
  console.log(`Found ${testDocs.length} test documents:`)
  for (const d of testDocs) {
    console.log(JSON.stringify(d, null, 2))
  }
} else {
  console.log(JSON.stringify(report, null, 2))
}

// ── 2. Save the "all fields" PDF (test 6) and open URLs for manual review ──
console.log('\n=== PDF URLs for manual browser check ===')
const pdfTests = {
  'Test1 HP_TZ in Document (#6806)':         'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=Ter4WafZSgBbL6BF5Wiu1rLcKv5OqaZnCfd/o9Rzcz4uEwTd4CNHd0prylPsZLkk',
  'Test3 Date DDMMYYYY (#6808)':             'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=+YPGK6GuMaGjviBwcjDvjsFmC8XsIQN0KJGhJrtshRTRnjACTsiSMQbTMLQxdhkC',
  'Test4 Date DD/MM/YYYY (#6809)':           'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=MI6RTW36EliO7IJgm9YSpis/Kb1TwcqIsJy78bmiIYKGFlhSXZM7GaeY1n6KJ7Kt',
  'Test5 ValueDate (#6810)':                 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=VaAYbP/DImAnUhsImTh/cBEf15MheYgIgBnRalghqAYMfBEsZuuRfPYJFt8QWPhX',
  'Test6 All fields TaxInvRcpt (#632735)':   'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=QJTfWZoLcWAaJnALtxD/5iTt9pWg8t0VZHCl3QmHPGeYe4ROoAY4j47EIfl6R2Vb',
}
for (const [label, url] of Object.entries(pdfTests)) {
  console.log(`${label}\n  ${url}\n`)
}

// ── 3. Download PDF binaries and save locally ──────────────────────────────
console.log('\n=== Downloading PDFs to scripts/test-pdfs/ ===')
for (const [label, url] of Object.entries(pdfTests)) {
  const filename = label.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.pdf'
  const res = await fetch(url)
  const buf = await res.arrayBuffer()
  writeFileSync(`scripts/test-pdfs/${filename}`, Buffer.from(buf))
  console.log(`Saved: scripts/test-pdfs/${filename} (${buf.byteLength} bytes)`)
}
