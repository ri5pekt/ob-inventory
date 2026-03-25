import { readFileSync } from 'fs'

// Try to extract text streams from PDF
// PDFs store text in "BT ... ET" blocks (Begin Text / End Text)
const files = [
  'b_docdate_taxinvoice_6813.pdf',
  'c_docdate_receipt_invoice_632753.pdf',
  'e_custom_tid1_632754.pdf',
  'h_cheque_01mar_632762.pdf',
]

for (const f of files) {
  console.log(`\n${'='.repeat(50)}\n${f}`)
  const buf = readFileSync(`scripts/test-pdfs/${f}`)
  const str = buf.toString('latin1')

  // Extract text between BT and ET markers
  const textBlocks = []
  let pos = 0
  while (true) {
    const start = str.indexOf('BT', pos)
    if (start === -1) break
    const end = str.indexOf('ET', start)
    if (end === -1) break
    const block = str.slice(start, end + 2)
    // Extract string literals: (text) and <hex>
    const literals = block.match(/\(([^)]{1,100})\)/g) ?? []
    const readable = literals
      .map(s => s.slice(1, -1))
      .filter(s => /[\x20-\x7E\u05D0-\u05EA]/.test(s))
      .join(' | ')
    if (readable) textBlocks.push(readable)
    pos = end + 2
  }

  if (textBlocks.length) {
    console.log('Text blocks:', textBlocks.join('\n'))
  } else {
    console.log('No readable text layer found (image-only PDF)')
  }

  // Also try to find any readable ASCII strings 5+ chars
  const ascii = str.match(/[ -~]{5,}/g) ?? []
  const meaningful = ascii.filter(s =>
    /\d{2}[\/]\d{2}[\/]\d{4}/.test(s) ||
    /\d{1,3}[.]\d{2}/.test(s) ||
    /[a-zA-Z]{4,}/.test(s)
  ).slice(0, 20)
  if (meaningful.length) console.log('ASCII strings:', meaningful)
}
