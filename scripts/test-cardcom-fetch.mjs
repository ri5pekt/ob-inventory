/**
 * Fetch text content from each test PDF to see what fields appear.
 * (Downloads HTML from the doc URLs and extracts text)
 */

const docs = {
  'Test1 HP_TZ in Document':           'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=Ter4WafZSgBbL6BF5Wiu1rLcKv5OqaZnCfd/o9Rzcz4uEwTd4CNHd0prylPsZLkk',
  'Test2 HP_TZ top-level':             'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=OdHFljcTp4n8MvacA73FArQolNRsbhwKQBTc0JeYrB59XdSGnXC+LNlea8l1kamX',
  'Test3 DocumentDate DDMMYYYY':       'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=+YPGK6GuMaGjviBwcjDvjsFmC8XsIQN0KJGhJrtshRTRnjACTsiSMQbTMLQxdhkC',
  'Test4 DocumentDate DD/MM/YYYY':     'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=MI6RTW36EliO7IJgm9YSpis/Kb1TwcqIsJy78bmiIYKGFlhSXZM7GaeY1n6KJ7Kt',
  'Test5 ValueDate DD/MM/YYYY':        'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=VaAYbP/DImAnUhsImTh/cBEf15MheYgIgBnRalghqAYMfBEsZuuRfPYJFt8QWPhX',
  'Test6 All fields (receipt+invoice)':'https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=QJTfWZoLcWAaJnALtxD/5iTt9pWg8t0VZHCl3QmHPGeYe4ROoAY4j47EIfl6R2Vb',
}

// Strip HTML tags and collapse whitespace
function extractText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

for (const [label, url] of Object.entries(docs)) {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${label}`)
  console.log('='.repeat(60))
  try {
    const res = await fetch(url)
    const html = await res.text()
    const text = extractText(html)
    // Print the first 800 chars — contains header/customer/date info
    console.log(text.slice(0, 800))
    // Also search for key fields
    const hits = []
    if (/123456789/.test(text))  hits.push('✅ HP_TZ (123456789) FOUND')
    if (/01.03.2026/.test(text)) hits.push('✅ DocumentDate (01/03/2026) FOUND')
    if (/15.03.2026/.test(text)) hits.push('✅ ValueDate (15/03/2026) FOUND')
    if (/Test comment/.test(text)) hits.push('✅ Comments FOUND')
    if (/מקור/.test(text))        hits.push('ℹ️  מקור field present')
    if (hits.length) console.log('\nFIELD CHECK:', hits.join(' | '))
    else console.log('\nFIELD CHECK: none of the test values found in visible text')
  } catch (e) {
    console.log('ERROR:', e.message)
  }
}
