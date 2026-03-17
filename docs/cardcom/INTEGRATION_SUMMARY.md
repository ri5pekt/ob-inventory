# Cardcom Integration — Implementation Summary

## What was built

A "Cardcom" button on the sale detail modal that opens a document management panel for creating and viewing Israeli tax documents via the Cardcom API.

---

## Files Created

| File | Purpose |
|---|---|
| `packages/db/src/schema/cardcom.ts` | `cardcom_documents` DB table schema |
| `apps/api/src/services/cardcom.ts` | Cardcom HTTP client (create doc + get PDF URL) |
| `apps/api/src/routes/invoices.ts` | `GET /api/sales/:id/documents` + `POST /api/sales/:id/documents` |
| `apps/web/src/api/invoices.ts` | Frontend API module with TypeScript types |
| `apps/web/src/components/sales/CardcomDocumentsModal.vue` | Full documents modal component |

## Files Modified

| File | Change |
|---|---|
| `packages/db/src/schema/index.ts` | Added `export * from './cardcom.js'` |
| `apps/api/src/index.ts` | Registered `invoicesRoutes` |
| `apps/web/src/components/sales/SaleDetailDialog.vue` | Added "Cardcom" button + `CardcomDocumentsModal` |
| `apps/api/src/env.ts` | Added Cardcom env vars |
| `.env` | Added Cardcom credentials |
| `docs/cardcom/CARDCOM_API_GUIDE.md` | Full Cardcom API reference doc |

---

## Database

Table `cardcom_documents` was created directly via SQL (drizzle-kit has ESM resolution issues on this Windows setup — use Docker psql as the workaround for future migrations on this table):

```sql
docker exec ob-inventory-postgres-1 psql -U ob_user -d ob_inventory -c "
CREATE TABLE IF NOT EXISTS cardcom_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id         UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  document_type   TEXT NOT NULL,
  document_number INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS cardcom_documents_sale_id_idx ON cardcom_documents(sale_id);
"
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/sales/:id/documents` | List all Cardcom documents for a sale (includes fresh PDF URL each time) |
| `POST` | `/api/sales/:id/documents` | Create a new document. Body: `{ documentType, sendEmail }` |

### POST validation errors (400)
- `customerName` missing on sale → required for all document types
- `totalPrice` missing → required for `TaxInvoiceAndReceipt` and `Receipt` only

---

## Document Types

| Hebrew | `documentType` value | Requires payment field |
|---|---|---|
| חשבונית מס קבלה | `TaxInvoiceAndReceipt` | Yes (`Cash = totalPrice`) |
| חשבונית מס | `TaxInvoice` | No |
| קבלה | `Receipt` | Yes (`Cash = totalPrice`) |
| חשבונית מס זיכוי | `TaxInvoiceRefund` | No |

---

## Credentials

Always uses the **test terminal** for now. Single-line switch to production when ready.

```
# .env
CARDCOM_TEST_API_NAME=kzFKfohEvL6AOF8aMEJz
CARDCOM_TEST_API_PASSWORD=FIDHIh4pAadw3Slbdsjg
CARDCOM_TEST_TERMINAL=1000

CARDCOM_API_NAME=LXwAI1p7F2COVRLCcLEi
CARDCOM_API_PASSWORD=WOSLh5tWsiASpNmWlqxE
CARDCOM_TERMINAL=157669
```

To switch to production, change these two lines in `apps/api/src/services/cardcom.ts`:
```ts
const API_NAME     = env.CARDCOM_TEST_API_NAME!   // → env.CARDCOM_API_NAME!
const API_PASSWORD = env.CARDCOM_TEST_API_PASSWORD! // → env.CARDCOM_API_PASSWORD!
```

---

## UI Flow

1. Admin opens a sale → clicks **"Cardcom"** button in the footer
2. Modal opens, fetches existing documents from local DB
3. Each document shows: Hebrew type badge, doc number, date, PDF download link
4. Four create buttons at the bottom — one per document type
5. Click a type → confirmation dialog shows customer name, total, email checkbox (checked by default)
6. Confirm → document created on Cardcom → stored in DB → toast notification → list refreshes

### Missing data handling
- `customerName` missing → warning banner, all create buttons disabled
- `totalPrice` missing → `TaxInvoiceAndReceipt` + `Receipt` buttons disabled with tooltip
- `customerEmail` missing → email checkbox unchecked and disabled, document still created without email

---

## Pending Decisions

- **Multiple documents per type?** Currently allowed (no restriction). Needs business decision — add a warning or hard-block if re-issuing same type.
- **Partial refunds on חשבונית מס זיכוי?** Currently creates refund with all sale items at full quantities. If partial refunds are needed, confirmation dialog needs an editable items table.
