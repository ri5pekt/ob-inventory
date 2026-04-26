# Cardcom API Guide

## Credentials

| | Production | Test |
|---|---|---|
| API Name | `LXwAI1p7F2COVRLCcLEi` | `kzFKfohEvL6AOF8aMEJz` |
| API Password | `WOSLh5tWsiASpNmWlqxE` | `FIDHIh4pAadw3Slbdsjg` |
| Terminal | `157669` | `1000` |

**Admin dashboard login:** `Cardtest1994` / `Terminaltest2026`
**API docs:** https://secure.cardcom.solutions/swagger/index.html?url=/swagger/v11/swagger.json
**Base URL:** `https://secure.cardcom.solutions/api/v11`

All credentials are also stored in `.env`:
```
CARDCOM_API_NAME, CARDCOM_API_PASSWORD, CARDCOM_TERMINAL
CARDCOM_TEST_API_NAME, CARDCOM_TEST_API_PASSWORD, CARDCOM_TEST_TERMINAL
```

---

## Sandbox / Test Environment

There is **no separate sandbox URL** — everything hits `https://secure.cardcom.solutions`.
Use the **test terminal** (Terminal `1000`) for development. It creates real documents but on a test account that has no financial impact.

---

## Document Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /Documents/CreateTaxInvoice` | Create tax invoice / receipt documents (main endpoint used by the app) |
| `POST /Documents/CreateDocument` | Newer document endpoint used mostly with `DocumentTypeToCreate` payloads |
| `POST /Documents/GetReport` | Query / list documents by date range |
| `POST /Documents/CreateDocumentUrl` | Get a PDF download URL for an existing document |
| `POST /Documents/CancelDoc` | Cancel a document + issue refund |
| `POST /Documents/SendAllDocumentsToEmail` | Bulk-send PDFs by date range |
| `POST /Documents/CrossDocument` | Cross (match) a TaxInvoice with a Receipt |

---

## Document Types We Use

This terminal has historically used only these 4 types:

| Hebrew | App value | `CreateTaxInvoice.InvoiceType` | Requires payment? |
|---|---|---|---|
| חשבונית מס קבלה | `TaxInvoiceAndReceipt` | `1` | ✅ Yes |
| חשבונית מס | `TaxInvoice` | `305` | ❌ No |
| קבלה לחשבונית | `Receipt` | `400` | ✅ Yes |
| חשבונית מס זיכוי | `TaxInvoiceRefund` | `330` | ❌ No |

**"Requires payment"** means you must include `Cash`, `Cheques`, `CustomLines`, or `DealNumbers` in the request body that sums to the document total — otherwise the API returns `"Total items not equal to some form of payment"`.

### All Available Document Types (full enum)
`Auto`, `TaxInvoiceAndReceipt`, `TaxInvoiceAndReceiptRefund`, `Receipt`, `ReceiptRefund`,
`Quote`, `Order`, `OrderConfirmation`, `OrderConfirmationRefund`, `DeliveryNote`,
`DeliveryNoteRefund`, `ProformaInvoice`, `ProformaInvoiceRefund`, `ProformaDealInvoice`,
`ProformaDealInvoiceRefund`, `DemandForPayment`, `DemandForPaymentRefund`, `TaxInvoice`,
`TaxInvoiceRefund`, `ReceiptForTaxInvoice`, `ReceiptForTaxInvoiceRefund`, `DonationReceipt`,
`DonationReceiptRefund`, `CouponDocumentAndReceipt`, `CouponDocumentAndReceiptRefund`

---

## Creating a Document

### Without payment (TaxInvoice, TaxInvoiceRefund)

```json
POST /api/v11/Documents/CreateTaxInvoice

{
  "ApiName": "kzFKfohEvL6AOF8aMEJz",
  "ApiPassword": "FIDHIh4pAadw3Slbdsjg",
  "InvoiceType": 305,
  "InvoiceHead": {
    "CustName": "Customer Name",
    "Email": "customer@example.com",
    "SendByEmail": true,
    "Languge": "he"
  },
  "InvoiceLines": [
    { "Description": "Product name", "Price": 100, "Quantity": 1, "IsPriceIncludeVAT": true }
  ]
}
```

### With payment (TaxInvoiceAndReceipt, ReceiptForTaxInvoice)

```json
POST /api/v11/Documents/CreateTaxInvoice

{
  "ApiName": "kzFKfohEvL6AOF8aMEJz",
  "ApiPassword": "FIDHIh4pAadw3Slbdsjg",
  "InvoiceType": 1,
  "Cash": 100,
  "InvoiceHead": {
    "CustName": "Customer Name",
    "Email": "customer@example.com",
    "SendByEmail": true,
    "Languge": "he"
  },
  "InvoiceLines": [
    { "Description": "Product name", "Price": 100, "Quantity": 1, "IsPriceIncludeVAT": true }
  ]
}
```

Use `InvoiceType: 1` for `TaxInvoiceAndReceipt`.
Use `InvoiceType: 400` for `ReceiptForTaxInvoice` / קבלה לחשבונית.

Payment can be provided as:
- `Cash` — amount paid in cash (number, top-level field)
- `Cheques` — array of cheque objects
- `CustomLines` — array of custom payment objects for bank transfer / Bit / other payments
- `DealNumbers` — array of `{ DealNumber: int }` (links to existing Cardcom transactions)

### Successful response

```json
{
  "ResponseCode": 0,
  "Description": "Successful operation",
  "InvoiceNumber": 632507,
  "InvoiceType": 1,
  "AccountID": 12345
}
```

`ResponseCode: 0` = success. Any other value = error, read `Description`.

---

## Getting a PDF URL

After creating a document, get a download link:

```json
POST /api/v11/Documents/CreateDocumentUrl

{
  "ApiName": "kzFKfohEvL6AOF8aMEJz",
  "ApiPassword": "FIDHIh4pAadw3Slbdsjg",
  "DocumentType": "TaxInvoiceAndReceipt",
  "DocumentNumber": 632507
}
```

Response:
```json
{
  "ResponseCode": 0,
  "DocUrl": "https://secure.cardcom.solutions/api/v11/documents/DownloadDoc/?c=1&code=..."
}
```

Note: the field is `DocUrl`, not `DocumentUrl`.
`DocumentType` cannot be `Auto` in this endpoint — must be the explicit type.

---

## Querying Documents

```json
POST /api/v11/Documents/GetReport

{
  "ApiName": "LXwAI1p7F2COVRLCcLEi",
  "ApiPassword": "WOSLh5tWsiASpNmWlqxE",
  "FromDateYYYYMMDD": "20260101",
  "ToDateYYYYMMDD": "20260317",
  "DocType": -2,
  "PageNumber": 1
}
```

`DocType` filter: `-1` = all invoices, `-2` = all documents, `-3` = refunds only.

Each document in the response has:
- `Invoice_Number` — document number
- `InvoiceType` — integer document type (`1` = TaxInvoiceAndReceipt, `305` = TaxInvoice, `330` = TaxInvoiceRefund, `400` = ReceiptForTaxInvoice)
- `IsOpen` — `false` for TaxInvoiceAndReceipt (always closed immediately), `true` for unpaid TaxInvoice
- `IsNegetive` — `true` for refund documents
- `ExternalId` — our own order ID, empty by default — **use this to link documents to our orders**
- `TotalIncludeVATNIS` — total amount including VAT in ILS

---

## Document Status & Lifecycle

- **`TaxInvoiceAndReceipt`** — born closed (`IsOpen: false`). Payment + document in one shot. Final immediately.
- **`TaxInvoice`** — born open (`IsOpen: true`). Waiting for payment. Close it by issuing a `ReceiptForTaxInvoice` and crossing via `CrossDocument`.
- **`ReceiptForTaxInvoice`** — Cardcom legacy `InvoiceType: 400`, a receipt for an existing tax invoice.
- **`TaxInvoiceRefund`** — Cardcom legacy `InvoiceType: 330`, a tax invoice credit document.
- **Cancellation** — call `CancelDoc`. Cardcom may create a refund document such as `InvoiceType: 2` for tax-invoice-and-receipt cancellation.

This terminal has used **only `TaxInvoiceAndReceipt`** for all real transactions since launch (Aug 2024).

---

## Key Fields on `InvoiceHead`

| Field | Notes |
|---|---|
| `CustName` | Customer name, required, max 50 chars |
| `Email` | Where to send the PDF |
| `SendByEmail` | Set `true` to email PDF, `false` to suppress |
| `Languge` | `"he"` or `"en"` (note the typo in the API — it's `Languge` not `Language`) |
| `CustAddresLine1` | Customer address, line 1 |
| `CustMobilePH` | Customer mobile phone |
| `CompID` | Customer ID / company ID. Required when creating/updating a customer card |
| `IsAutoCreateUpdateAccount` | Set `"true"` with `CompID` to create/update a Cardcom customer card. If the customer already exists, Cardcom will not create a duplicate |
| `AccountForeignKey` | External customer key used when creating/updating a customer card |
| `ExtIsVatFree` | `true` to mark entire document as VAT-exempt |
| `ExternalId` | Our own reference ID — max 50 chars, good for linking to internal order IDs |
| `Comments` | Printed on the document, max 250 chars |
| `CoinID` | Currency: `1` = ILS (default), `2` = USD |
| `DepartmentId` | For reporting segmentation in admin panel |

### InvoiceLines array

```json
{
  "Description": "Product name",
  "Price": 100,
  "Quantity": 1,
  "IsPriceIncludeVAT": true
}
```

---

## Important Gotchas

1. **`Languge` is a typo** in the Cardcom API — it's spelled wrong and must be passed as `Languge`, not `Language`.
2. **Payment is required** for `Receipt` and `TaxInvoiceAndReceipt` — the `Cash`/`Cheques`/`CustomLines`/`DealNumbers` total must equal the invoice lines total.
3. **`InvoiceType: 400`** is `ReceiptForTaxInvoice` / קבלה לחשבונית, not a standalone tax invoice. `TaxInvoice` is `305`.
4. **Customer card creation** requires `InvoiceHead.IsAutoCreateUpdateAccount = "true"` and `InvoiceHead.CompID`. If `CompID` is missing, Cardcom cannot create the customer card.
5. **`DocumentType: Auto`** is not allowed in `CreateDocumentUrl` — must pass the explicit type.
6. **No sandbox** — test terminal (`1000`) is on the same production URL.
7. **Hebrew names** may appear garbled in shell/terminal output due to encoding — they are stored correctly in Cardcom.
8. **`ExternalId` is empty** on all existing documents — we should populate this with our order IDs going forward.
9. **Refunds have a separate numbering sequence** from regular invoices (e.g., refunds are #1–6, invoices are #95–138).
