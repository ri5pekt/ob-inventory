import { mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

// __dirname here is dist/lib/ — go up two levels to reach apps/api/, then into
// uploads/products, matching the fastify-static root (apps/api/uploads) in index.ts
// and the identical convention already used by the CSV importer (routes/import.ts).
const UPLOADS_DIR = join(__dirname, '../../uploads/products')
if (!existsSync(UPLOADS_DIR)) mkdirSync(UPLOADS_DIR, { recursive: true })

export type ProductImageResult =
  | { ok: true; path: string }
  | { ok: false; error: string }

/**
 * Fetches an image from `url`, resizes it to a full-size (1200px) + thumbnail
 * (240px) JPEG pair, and stores both under uploads/products/. Returns the
 * thumbnail's public path (what gets stored in products.picture) — same
 * convention as the CSV bulk importer, reused here for the external
 * write API (POST/PUT /api/v1/products) so agents can supply an image URL
 * instead of a multipart upload.
 */
export async function downloadAndStoreProductImage(url: string, sku: string): Promise<ProductImageResult> {
  const safeSku = sku.replace(/[^a-zA-Z0-9_-]/g, '_')

  let res: Response
  try {
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 12_000)
    try {
      res = await fetch(url, { signal: ctrl.signal })
    } finally {
      clearTimeout(timer)
    }
  } catch (err) {
    return { ok: false, error: `Could not fetch imageUrl: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!res.ok) return { ok: false, error: `imageUrl returned HTTP ${res.status}` }

  let buf: Buffer
  try {
    buf = Buffer.from(await res.arrayBuffer())
  } catch (err) {
    return { ok: false, error: `Could not read imageUrl response: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    await sharp(buf)
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toFile(join(UPLOADS_DIR, `${safeSku}.jpg`))

    await sharp(buf)
      .resize(240, 240, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 80 })
      .toFile(join(UPLOADS_DIR, `${safeSku}-thumb.jpg`))
  } catch (err) {
    return { ok: false, error: `imageUrl did not point to a valid image: ${err instanceof Error ? err.message : String(err)}` }
  }

  return { ok: true, path: `/uploads/products/${safeSku}-thumb.jpg` }
}
