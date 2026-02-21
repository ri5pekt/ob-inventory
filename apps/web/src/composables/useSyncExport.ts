import { ref } from 'vue'
import JSZip from 'jszip'

export type SyncStatus = 'synced' | 'qty_mismatch' | 'ob_only' | 'woo_only' | 'untracked'

export interface SyncItem {
  sku:        string | null
  obName:     string | null
  wooName:    string | null
  wooType:    string | null
  obQty:      number | null
  wooQty:     number | null
  status:     SyncStatus
  wooId:      number | null
  wooParentId: number | null
}

const CSV_HEADERS = ['SKU', 'Name', 'Woo Type', 'OB Qty', 'Woo Qty', 'Diff', 'Status', 'Woo Edit URL']

function statusLabel(s: SyncStatus): string {
  return {
    synced: 'Synced', qty_mismatch: 'Mismatch',
    ob_only: 'OB Only', woo_only: 'Woo Only', untracked: 'Not Tracked',
  }[s]
}

function csvEscape(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildRow(item: SyncItem, storeUrl: string): string {
  const diff = item.obQty !== null && item.wooQty !== null ? item.obQty - item.wooQty : null
  const base = storeUrl.replace(/\/$/, '')
  const postId = item.wooParentId ?? item.wooId
  const editUrl = postId ? `${base}/wp-admin/post.php?post=${postId}&action=edit` : ''
  return [
    csvEscape(item.sku),
    csvEscape(item.obName ?? item.wooName),
    csvEscape(item.wooType),
    csvEscape(item.obQty),
    csvEscape(item.wooQty),
    csvEscape(diff !== null ? (diff > 0 ? `+${diff}` : diff) : null),
    csvEscape(statusLabel(item.status)),
    csvEscape(editUrl || null),
  ].join(',')
}

function buildCSV(items: SyncItem[], storeUrl: string): string {
  return [CSV_HEADERS.join(','), ...items.map(i => buildRow(i, storeUrl))].join('\r\n')
}

export function useSyncExport(getStoreUrl: () => string | undefined, getItems: () => SyncItem[] | undefined) {
  const exporting = ref(false)

  async function exportAllCSV() {
    const items    = getItems()
    const storeUrl = getStoreUrl() ?? ''
    if (!items) return

    exporting.value = true
    try {
      const files: Array<{ name: string; filter: SyncStatus | 'all' }> = [
        { name: 'sync-all.csv',         filter: 'all'          },
        { name: 'sync-mismatch.csv',    filter: 'qty_mismatch' },
        { name: 'sync-ob-only.csv',     filter: 'ob_only'      },
        { name: 'sync-woo-only.csv',    filter: 'woo_only'     },
        { name: 'sync-not-tracked.csv', filter: 'untracked'    },
      ]

      const zip = new JSZip()
      for (const { name, filter } of files) {
        const rows = filter === 'all' ? items : items.filter(r => r.status === filter)
        zip.file(name, '\uFEFF' + buildCSV(rows, storeUrl))
      }

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = `woo-sync-export-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      exporting.value = false
    }
  }

  return { exporting, exportAllCSV }
}
