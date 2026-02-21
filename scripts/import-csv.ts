// One-time inventory migration script
// Reads docs/INVENTORY.csv and seeds the database with opening stock
//
// Phase 1.5: Implement the following steps:
//   1. Parse CSV, skip blank rows
//   2. Deduplicate SKUs (multiple box# → sum QTY, concatenate bin_locations)
//   3. Normalize data (trim, uppercase SKUs, map 'bc' dates → null, blank QTY → 0)
//   4. Upsert: brands, categories, attribute_options (sizes + colors)
//   5. Insert products
//   6. For QTY > 0: write inventory_ledger entry (action_type: receive, "Opening stock import")
//      and set inventory_stock.quantity
//   7. Report skipped rows (blank SKU) to console
//
// Usage:
//   Set DATABASE_URL in .env, then run:
//   pnpm import:csv

export {};
