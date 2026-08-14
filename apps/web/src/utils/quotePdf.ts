import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { QuoteDetail } from '@/api/quotes'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function money(value: string | number | null | undefined, currency: string) {
  if (value == null || value === '') return '—'
  const n = typeof value === 'number' ? value : parseFloat(value)
  if (Number.isNaN(n)) return '—'
  return `${n.toFixed(2)} ${escapeHtml(currency)}`
}

function buildQuoteHtml(quote: QuoteDetail): string {
  const items = quote.items ?? []
  const customerLines = [
    quote.customerName ? `<div class="value" dir="auto">${escapeHtml(quote.customerName)}</div>` : '',
    quote.customerEmail ? `<div class="muted" dir="ltr">${escapeHtml(quote.customerEmail)}</div>` : '',
    quote.customerPhone ? `<div class="muted" dir="ltr">${escapeHtml(quote.customerPhone)}</div>` : '',
    quote.customerIdNumber ? `<div class="muted" dir="auto">ID / ח.פ.: ${escapeHtml(quote.customerIdNumber)}</div>` : '',
    quote.customerAddress ? `<div class="muted" dir="auto">${escapeHtml(quote.customerAddress)}</div>` : '',
  ].filter(Boolean).join('')

  const itemRows = items.map((item, i) => `
    <tr class="${i % 2 === 0 ? 'odd' : 'even'}">
      <td class="sku" dir="ltr">${escapeHtml(item.sku)}</td>
      <td class="name" dir="auto">${escapeHtml(item.name)}</td>
      <td class="num">${item.quantity}</td>
      <td class="num">${item.unitPrice != null ? parseFloat(item.unitPrice).toFixed(2) : '—'}</td>
      <td class="num">${item.lineTotal != null ? parseFloat(item.lineTotal).toFixed(2) : '—'}</td>
    </tr>
  `).join('')

  const notesBlock = quote.notes?.trim()
    ? `
      <section class="section notes-section">
        <h2>Notes</h2>
        <pre class="notes" dir="auto">${escapeHtml(quote.notes.trim())}</pre>
      </section>
    `
    : ''

  return `
    <div class="sheet">
      <header class="header">
        <div>
          <div class="brand">Active Brands</div>
          <div class="subtitle">Price Quote</div>
        </div>
        <div class="header-meta">
          <div><span class="k">Quote</span> #${quote.quoteNumber}</div>
          <div><span class="k">Date</span> ${escapeHtml(formatDate(quote.quoteDate ?? quote.createdAt))}</div>
        </div>
      </header>

      <section class="section grid">
        <div>
          <h2>Customer</h2>
          ${customerLines || '<div class="muted">—</div>'}
        </div>
        <div>
          <h2>Details</h2>
          ${quote.warehouseName ? `<div><span class="k">Warehouse</span> <span dir="auto">${escapeHtml(quote.warehouseName)}</span></div>` : ''}
          <div><span class="k">Status</span> ${escapeHtml(quote.status)}</div>
        </div>
      </section>

      <section class="section">
        <h2>Items</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Product</th>
              <th class="num">Qty</th>
              <th class="num">Unit</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemRows || '<tr><td colspan="5" class="muted">No items</td></tr>'}
          </tbody>
        </table>
        <div class="total-row">
          <span>Grand Total</span>
          <strong>${money(quote.totalPrice, quote.currency)}</strong>
        </div>
      </section>

      ${notesBlock}

      <footer class="footer">
        This is a price quote — not an invoice or order. Stock is not reserved.
        · Generated ${escapeHtml(formatDate(new Date().toISOString()))} · Active Brands
      </footer>
    </div>
  `
}

const STYLES = `
  .sheet {
    width: 794px;
    box-sizing: border-box;
    padding: 36px 40px 28px;
    background: #ffffff;
    color: #0f172a;
    font-family: "Segoe UI", "Arial Hebrew", "Noto Sans Hebrew", Arial, sans-serif;
    font-size: 13px;
    line-height: 1.45;
  }
  .header {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 18px;
    border-bottom: 2px solid #0f766e;
    margin-bottom: 22px;
  }
  .brand {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #0f766e;
  }
  .subtitle {
    margin-top: 4px;
    font-size: 14px;
    font-weight: 600;
    color: #334155;
  }
  .header-meta { text-align: right; font-size: 12px; color: #334155; }
  .header-meta .k, .k {
    display: inline-block;
    min-width: 72px;
    color: #64748b;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.04em;
    margin-right: 6px;
  }
  .section { margin-bottom: 22px; }
  .section h2 {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #64748b;
  }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .value { font-size: 15px; font-weight: 700; }
  .muted { color: #64748b; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  th {
    text-align: left;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
    background: #f8fafc;
  }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td.sku {
    font-family: ui-monospace, "Courier New", monospace;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  tr.odd td { background: #ffffff; }
  tr.even td { background: #f8fafc; }
  .total-row {
    display: flex;
    justify-content: flex-end;
    align-items: baseline;
    gap: 16px;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 2px solid #cbd5e1;
    font-size: 14px;
  }
  .total-row strong { font-size: 18px; color: #0f766e; }
  .notes-section {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 14px 16px;
  }
  .notes {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 12.5px;
    line-height: 1.55;
    color: #1e293b;
  }
  .footer {
    margin-top: 28px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 11px;
    color: #94a3b8;
    text-align: center;
  }
`

export async function downloadQuotePdf(quote: QuoteDetail): Promise<void> {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1;'
  host.innerHTML = `<style>${STYLES}</style>${buildQuoteHtml(quote)}`
  document.body.appendChild(host)

  try {
    const sheet = host.querySelector('.sheet') as HTMLElement
    const canvas = await html2canvas(sheet, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
    })

    const imgData = canvas.toDataURL('image/jpeg', 0.95)
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 8
    const usableWidth = pageWidth - margin * 2
    const imgHeight = (canvas.height * usableWidth) / canvas.width

    let heightLeft = imgHeight
    let position = margin

    pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight)
    heightLeft -= pageHeight - margin * 2

    while (heightLeft > 0) {
      position = margin - (imgHeight - heightLeft)
      pdf.addPage()
      pdf.addImage(imgData, 'JPEG', margin, position, usableWidth, imgHeight)
      heightLeft -= pageHeight - margin * 2
    }

    const date = new Date(quote.quoteDate ?? quote.createdAt)
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    pdf.save(`quote-${quote.quoteNumber}-${y}${m}${d}.pdf`)
  } finally {
    document.body.removeChild(host)
  }
}
