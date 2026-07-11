import type { FastifyPluginAsync } from 'fastify'
import { isNotNull, sql } from 'drizzle-orm'
import { db } from '../db.js'
import { sales, customers } from '@ob-inventory/db'

export const toolsRoutes: FastifyPluginAsync = async (fastify) => {
  const adminOnly = {
    onRequest: [fastify.authenticate],
    preHandler: async (request: Parameters<typeof fastify.authenticate>[0], reply: Parameters<typeof fastify.authenticate>[1]) => {
      const user = request.user as { role?: string }
      if (user?.role !== 'admin') {
        reply.status(403).send({ error: 'Forbidden' })
      }
    },
  }

  // Only import sales that have a unique identifier: email
  // (id_number/hp_tz does not exist in the sales table — it lives only in the customers table)
  const eligibleWhere = isNotNull(sales.customerEmail)

  // ── Preview: how many distinct customers would be imported ────────────────
  fastify.get('/api/tools/customers/import-from-sales/preview', adminOnly, async () => {
    const rows = await db
      .selectDistinctOn([sql`lower(${sales.customerEmail})`], {
        customerName:  sales.customerName,
        customerEmail: sales.customerEmail,
      })
      .from(sales)
      .where(eligibleWhere)

    const existingEmails = await db
      .select({ email: customers.email })
      .from(customers)
      .where(isNotNull(customers.email))

    const existingSet = new Set(existingEmails.map(r => r.email?.toLowerCase()))
    const toCreate = rows.filter(r => !existingSet.has(r.customerEmail!.toLowerCase()))

    return {
      total:    rows.length,
      toCreate: toCreate.length,
      toSkip:   rows.length - toCreate.length,
    }
  })

  // ── Run: import customers from sales ──────────────────────────────────────
  fastify.post('/api/tools/customers/import-from-sales', adminOnly, async () => {
    // 1. Get all sales that have an email (the unique key)
    const salesRows = await db
      .select({
        customerName:    sales.customerName,
        customerEmail:   sales.customerEmail,
        customerPhone:   sales.customerPhone,
        customerAddress: sales.customerAddress,
      })
      .from(sales)
      .where(eligibleWhere)

    // 2. Deduplicate by email (case-insensitive), keep first occurrence
    const deduped = new Map<string, typeof salesRows[0]>()
    for (const row of salesRows) {
      const key = row.customerEmail!.toLowerCase()
      if (!deduped.has(key)) deduped.set(key, row)
    }

    // 3. Find emails that already exist in customers table
    const existingEmails = await db
      .select({ email: customers.email })
      .from(customers)
      .where(isNotNull(customers.email))
    const existingEmailSet = new Set(existingEmails.map(r => r.email?.toLowerCase()))

    // 4. Filter to only genuinely new records
    const toInsert: { name: string; email: string; phone: string | null; address: string | null }[] = []
    let skipped = 0

    for (const row of deduped.values()) {
      if (existingEmailSet.has(row.customerEmail!.toLowerCase())) {
        skipped++
        continue
      }
      toInsert.push({
        name:    row.customerName ?? row.customerEmail!,
        email:   row.customerEmail!,
        phone:   row.customerPhone   ?? null,
        address: row.customerAddress ?? null,
      })
    }

    if (toInsert.length === 0) {
      return { created: 0, skipped, customers: [] }
    }

    // 5. Bulk insert in batches of 100
    const created: typeof customers.$inferSelect[] = []
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100)
      const inserted = await db.insert(customers).values(batch).returning()
      created.push(...inserted)
    }

    return { created: created.length, skipped, customers: created }
  })
}
