/**
 * Seed the database with full inventory data from docs/INVENTORY.csv.
 * Idempotent: safe to run multiple times (uses onConflictDoNothing).
 * Run: pnpm db:seed-data
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'
import { createDb } from '../packages/db/src/index.js'
import {
  brands,
  categories,
  attributeDefinitions,
  attributeOptions,
  products,
  productAttributes,
  warehouses,
  inventoryStock,
  inventoryLedger,
} from '../packages/db/src/schema/index.js'

const db = createDb(
  process.env.DATABASE_URL ?? 'postgresql://ob_user:changeme@localhost:5432/ob_inventory',
)

// ── Types ─────────────────────────────────────────────────────────────────────

interface Row {
  boxNumber: string
  product: string
  brand: string
  category: string
  model: string
  size: string
  color: string
  sku: string
  unit: string
  dateAdded: string | null
  picture: string
  qty: number
}

// ── CSV Parsing ───────────────────────────────────────────────────────────────

const CAT_NORMALIZE: Record<string, string> = {
  'SHIN GUARD': 'SHIN GUARDS',
  'GRAPPLING GLOVE': 'GRAPPLING GLOVES',
  'MG': 'MOUTH GUARD',
  'mouth guard': 'MOUTH GUARD',
  'HEAVY BAG': 'HEAVY BAGS',
  'KICKING PADS': 'KICKING PADS',
  'KICKING PAD': 'KICKING PADS',
}

function parseCsv(): Row[] {
  const csvPath = path.join(process.cwd(), 'docs', 'INVENTORY.csv')
  const skuMap = new Map<string, Row>()

  for (const raw of fs.readFileSync(csvPath, 'utf-8').split('\n').slice(1)) {
    const line = raw.trim()
    if (!line) continue
    const p = line.split(',')
    if (p.length < 12) continue

    const sku = p[7]?.trim()
    const product = p[1]?.trim()
    if (!sku || !product) continue

    const rawQty = p[11]?.trim()
    const parsed = parseInt(rawQty ?? '', 10)
    const qty = isNaN(parsed) || parsed < 0 ? 0 : parsed

    const rawCat = p[3]?.trim() ?? ''
    const category = CAT_NORMALIZE[rawCat] ?? rawCat

    if (skuMap.has(sku)) {
      skuMap.get(sku)!.qty += qty
    } else {
      const rawDate = p[9]?.trim() ?? ''
      const rawPic  = p[10]?.trim() ?? ''
      skuMap.set(sku, {
        boxNumber: p[0]?.trim() ?? '',
        product,
        brand: p[2]?.trim() ?? '',
        category,
        model: p[4]?.trim() ?? '',
        size: p[5]?.trim() ?? '',
        color: p[6]?.trim() ?? '',
        sku,
        unit: p[8]?.trim() ?? '',
        dateAdded: parseMonYY(rawDate),
        picture:   (rawPic  && rawPic  !== '???') ? rawPic  : '',
        qty,
      })
    }
  }

  return [...skuMap.values()]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/**
 * Converts "Mon-YY" (e.g. "Jan-23") to "YYYY-MM-01" ISO date string.
 * Returns null for unparseable values like "bc" or "???".
 */
function parseMonYY(raw: string): string | null {
  if (!raw || raw === '???') return null
  const m = raw.match(/^([A-Za-z]{3})-(\d{2})$/)
  if (!m) return null
  const month = MONTH_MAP[m[1].toLowerCase()]
  if (!month) return null
  const year = parseInt(m[2], 10) + 2000
  return `${year}-${month}-01`
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function makeProductName(r: Row): string {
  const prod = r.product.trim()
  const model = r.model.trim()
  if (!model || model.toLowerCase() === prod.toLowerCase()) return prod
  return `${prod} ${model}`
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n📦  Seeding inventory data from INVENTORY.csv…\n')

  const rows = parseCsv()
  console.log(`  Parsed ${rows.length} unique SKUs from CSV\n`)

  // ── 1. Brands ────────────────────────────────────────────────────────────
  const uniqueBrands = [...new Set(rows.map(r => r.brand).filter(Boolean))].sort()
  await db.insert(brands)
    .values(uniqueBrands.map(name => ({ name })))
    .onConflictDoNothing()
  const brandId = new Map(
    (await db.select().from(brands)).map(b => [b.name, b.id]),
  )
  console.log(`  ✅  Brands (${uniqueBrands.length}): ${uniqueBrands.join(', ')}`)

  // ── 2. Categories ────────────────────────────────────────────────────────
  const uniqueCats = [...new Set(rows.map(r => r.category).filter(Boolean))].sort()
  await db.insert(categories)
    .values(uniqueCats.map(name => ({ name })))
    .onConflictDoNothing()
  const catId = new Map(
    (await db.select().from(categories)).map(c => [c.name, c.id]),
  )
  console.log(`  ✅  Categories (${uniqueCats.length}): ${uniqueCats.join(', ')}`)

  // ── 3. Attribute definitions ─────────────────────────────────────────────
  // Size and Color are now 'select' type — update existing records if they were 'text'
  const attrDefs = [
    { name: 'Model', inputType: 'text'   as const, sortOrder: 0 },
    { name: 'Size',  inputType: 'select' as const, sortOrder: 1 },
    { name: 'Color', inputType: 'select' as const, sortOrder: 2 },
    { name: 'Unit',  inputType: 'select' as const, sortOrder: 3 },
  ]
  await db.insert(attributeDefinitions)
    .values(attrDefs.map(d => ({ name: d.name, inputType: d.inputType, isRequired: false, sortOrder: d.sortOrder })))
    .onConflictDoUpdate({
      target: attributeDefinitions.name,
      set: { inputType: sql`excluded.input_type` },
    })
  const defId = new Map(
    (await db.select().from(attributeDefinitions)).map(d => [d.name, d.id]),
  )

  // ── 4. Unit / Size / Color options ───────────────────────────────────────
  const unitDefId  = defId.get('Unit')!
  const sizeDefId  = defId.get('Size')!
  const colorDefId = defId.get('Color')!

  // Unit
  await db.insert(attributeOptions)
    .values([
      { definitionId: unitDefId, code: 'PIECE', label: 'Piece', sortOrder: 0 },
      { definitionId: unitDefId, code: 'PAIR',  label: 'Pair',  sortOrder: 1 },
    ])
    .onConflictDoNothing()

  // Size — collect every non-empty value from the CSV
  const uniqueSizes = [...new Set(rows.map(r => r.size).filter(Boolean))].sort()
  await db.insert(attributeOptions)
    .values(uniqueSizes.map((s, i) => ({
      definitionId: sizeDefId,
      code: s.toUpperCase(),
      label: s,
      sortOrder: i * 10,
    })))
    .onConflictDoNothing()

  // Color — same approach
  const uniqueColors = [...new Set(rows.map(r => r.color).filter(Boolean))].sort()
  await db.insert(attributeOptions)
    .values(uniqueColors.map((c, i) => ({
      definitionId: colorDefId,
      code: c.toUpperCase(),
      label: c,
      sortOrder: i * 10,
    })))
    .onConflictDoNothing()

  // Build lookup maps: code → option id
  const unitOptId = new Map(
    (await db.select().from(attributeOptions).where(eq(attributeOptions.definitionId, unitDefId)))
      .map(o => [o.code, o.id]),
  )
  const sizeOptId = new Map(
    (await db.select().from(attributeOptions).where(eq(attributeOptions.definitionId, sizeDefId)))
      .map(o => [o.code.toUpperCase(), o.id]),
  )
  const colorOptId = new Map(
    (await db.select().from(attributeOptions).where(eq(attributeOptions.definitionId, colorDefId)))
      .map(o => [o.code.toUpperCase(), o.id]),
  )

  console.log(`  ✅  Attribute definitions: Model (text), Size (${uniqueSizes.length} opts), Color (${uniqueColors.length} opts), Unit (PIECE/PAIR)`)

  // ── 5. Main Warehouse ────────────────────────────────────────────────────
  const [existingWh] = await db.select().from(warehouses)
    .where(eq(warehouses.type, 'main'))
    .limit(1)

  let whId: string
  if (existingWh) {
    whId = existingWh.id
    console.log(`  ✅  Warehouse: using existing "${existingWh.name}"`)
  } else {
    const [wh] = await db.insert(warehouses)
      .values({ name: 'Main Warehouse', type: 'main', isActive: true, notes: 'Primary stock location' })
      .returning()
    whId = wh.id
    console.log(`  ✅  Warehouse: created "Main Warehouse"`)
  }

  // ── 6. Products + Attributes + Stock ─────────────────────────────────────
  console.log(`\n  Inserting products, attributes and stock…`)

  let newProducts = 0
  let newStock = 0
  let batchNum = 0

  for (const batch of chunk(rows, 50)) {
    batchNum++

    // Upsert all product fields on duplicate SKU
    await db.insert(products)
      .values(batch.map(r => ({
        sku: r.sku,
        name: makeProductName(r),
        brandId:   brandId.get(r.brand) ?? null,
        categoryId: catId.get(r.category) ?? null,
        dateAdded: r.dateAdded  || null,
        picture:   r.picture    || null,
      })))
      .onConflictDoUpdate({
        target: products.sku,
        set: {
          name:       sql`excluded.name`,
          brandId:    sql`excluded.brand_id`,
          categoryId: sql`excluded.category_id`,
          dateAdded:  sql`excluded.date_added`,
          picture:    sql`excluded.picture`,
        },
      })

    // Fetch IDs for all skus in this batch in one query
    const prodMap = new Map(
      (await db.select({ id: products.id, sku: products.sku })
        .from(products)
        .where(inArray(products.sku, batch.map(r => r.sku))))
        .map(p => [p.sku, p.id]),
    )

    // Product attributes (PK: productId + definitionId → safe to upsert)
    const attrs: typeof productAttributes.$inferInsert[] = []
    for (const r of batch) {
      const pid = prodMap.get(r.sku)
      if (!pid) continue
      if (r.model) attrs.push({ productId: pid, definitionId: defId.get('Model')!, valueText: r.model })
      if (r.size) {
        const oid = sizeOptId.get(r.size.toUpperCase()) ?? null
        attrs.push({ productId: pid, definitionId: sizeDefId, optionId: oid, valueText: oid ? null : r.size })
      }
      if (r.color) {
        const oid = colorOptId.get(r.color.toUpperCase()) ?? null
        attrs.push({ productId: pid, definitionId: colorDefId, optionId: oid, valueText: oid ? null : r.color })
      }
      if (r.unit) {
        const oid = unitOptId.get(r.unit) ?? null
        attrs.push({ productId: pid, definitionId: unitDefId, optionId: oid, valueText: oid ? null : r.unit })
      }
    }
    if (attrs.length) {
      await db.insert(productAttributes)
        .values(attrs)
        .onConflictDoUpdate({
          target: [productAttributes.productId, productAttributes.definitionId],
          set: {
            optionId:  sql`excluded.option_id`,
            valueText: sql`excluded.value_text`,
          },
        })
    }

    // Inventory stock – use RETURNING to know which are genuinely new
    const stockValues = batch
      .map(r => ({
        productId: prodMap.get(r.sku),
        warehouseId: whId,
        boxNumber: r.boxNumber || null,
        quantity: r.qty,
      }))
      .filter((s): s is { productId: string; warehouseId: string; boxNumber: string | null; quantity: number } => !!s.productId)

    if (stockValues.length) {
      const inserted = await db.insert(inventoryStock)
        .values(stockValues)
        .onConflictDoNothing()
        .returning({ productId: inventoryStock.productId })

      newProducts += prodMap.size
      newStock += inserted.length

      // Only write ledger entries for newly-created stock rows
      if (inserted.length > 0) {
        const newPids = new Set(inserted.map(s => s.productId))
        const ledgerValues = batch
          .filter(r => r.qty > 0 && newPids.has(prodMap.get(r.sku) ?? ''))
          .map(r => ({
            productId: prodMap.get(r.sku)!,
            warehouseId: whId,
            actionType: 'receive' as const,
            quantityDelta: r.qty,
            notes: 'Initial stock – CSV import',
          }))
        if (ledgerValues.length) {
          await db.insert(inventoryLedger).values(ledgerValues)
        }
      }
    }

    process.stdout.write(`\r  Processing batch ${batchNum}/${Math.ceil(rows.length / 50)}…`)
  }

  console.log('\n')
  console.log(`  ✅  Products processed : ${newProducts}`)
  console.log(`  ✅  Stock rows created : ${newStock}`)
  console.log('\n🎉  All inventory data seeded!\n')

  process.exit(0)
}

seed().catch(err => {
  console.error('\n❌  Seed failed:', err.message ?? err)
  process.exit(1)
})
