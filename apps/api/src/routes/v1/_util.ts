import { z } from 'zod'

const uuidSchema = z.string().uuid()

/** Returns true if `id` is a syntactically valid UUID — call before querying by :id
 *  so malformed params get a clean 400 instead of leaking a Postgres error as a 500. */
export function isValidUuid(id: string): boolean {
  return uuidSchema.safeParse(id).success
}
