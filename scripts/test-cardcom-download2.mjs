import { writeFileSync } from 'fs'

// Download the latest test PDFs (TaxId, DocumentDate, ValueDate tests)
const pdfs = {
  'testA_taxid_6811.pdf':          'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=Il4kt/HOONbhdLgX8SkeSXebZZU85XKQ04pti3hvsJvQvxi9gkzbEFrNE4ff3l00',
  'testC_docdate_01_03_6812.pdf':  'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=ArzE2C3tdGd4euieetXNJl38sKKvLJDno27LoSd7Fiy5x22u3EvZolFH05pA7ATH',
  'testD_valuedate_15_03_632736.pdf': 'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=W+hXrFYq9wK4qUbisSU/hHOsfrGq7QQAJdiodMnQRoaZHDRjByDJ+5zdMSD7bpWe',
  'testE_all_fields_632737.pdf':   'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=GRjlu+Evhbl83VjYraV6zsAtBuxw/lg2q5SDqvLewJ7QL6zyptcfWKXBdkf1sYsR',
}

for (const [filename, url] of Object.entries(pdfs)) {
  const res  = await fetch(url)
  const buf  = await res.arrayBuffer()
  const path = `scripts/test-pdfs/${filename}`
  writeFileSync(path, Buffer.from(buf))
  console.log(`Saved: ${path} (${buf.byteLength} bytes)`)
}
console.log('\nDone. Opening folder...')
