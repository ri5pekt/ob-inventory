import { writeFileSync } from 'fs'

const pdfs = {
  // ValueDate test — does it show?
  'a_valuedate_01mar_632751.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=i+zYuX8O2es/b456R+JHKWN8PpWOIz1vv2qcwzDc3VLyycujYAnPj62V6lW7lC7b',
  // DocumentDate 01/03/2026 on TaxInvoice — does date change?
  'b_docdate_taxinvoice_6813.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=X//K3l/dzE/ck4RmYo5fOvxZs81OpcUnjI5d2p2nd20AXhOS/selhzfzjOdO5TS4',
  // DocumentDate on TaxInvoiceAndReceipt
  'c_docdate_receipt_invoice_632753.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=Oboih7dM53GgrM9Hg3qiApsb+N8XCOhHV4uDn6uwx31rfvBU6E5+mTFAUj3s1Fhd',
  // DocumentDate on Receipt
  'd_docdate_receipt_22631.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=1RKAdloT/FUA/9qIihT7aR/lYJjEeS/5DosnND5Pr6TCn0uk1FveL4A/mw15G1uC',
  // CustomFields tid=1 — what payment type name shows?
  'e_custom_tid1_632754.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=oji2qrN/bWFQPcwikAk8ABl2VMIr30o2B1vfwZQj9VADZ+DF2qsGvLnr79qyahF0',
  // CustomFields tid=2
  'f_custom_tid2_632755.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=RY9Htqq17WN1D7UKMDssRDuPPiRTfRlh/+taqRTzTlCFqEoC7m3Is9LnJQ/DNiba',
  // CustomFields tid=5
  'g_custom_tid5_632758.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=HW8Hj/v+qcj6cVI+ikscIa0R9Sff7Ldu1vQyD0a1s7XJqyhAdmBTySfDt627mCWU',
  // Cheque with DateCheque 01/03/2026
  'h_cheque_01mar_632762.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=7OATz75jHKxRq9oPBR3b/icOPYzFTFVerzTHxfuxb+iTiOZd/p3CNGAXVYjCUAEQ',
}

for (const [filename, url] of Object.entries(pdfs)) {
  const res  = await fetch(url)
  const buf  = await res.arrayBuffer()
  writeFileSync(`scripts/test-pdfs/${filename}`, Buffer.from(buf))
  console.log(`Saved: ${filename} (${buf.byteLength} bytes)`)
}
console.log('\nOpening folder...')
