# Cardcom QR Payment Request — Development Plan

**Goal:** On the sale screen's payment options, add a "Pay by QR" flow alongside the existing
"Pay with Terminal" (manual card entry) flow. Staff clicks "Request Payment" → a modal opens with
a QR code → the customer scans it with their phone → they enter their own card details on
Cardcom's own hosted page (never on ours) → the sale's modal auto-closes and the sale gets the
exact same result data (last 4 digits, card brand, Tax Invoice & Receipt, PDF link) as if the
details had been typed into `CardcomTerminalModal.vue` manually.

Status: **Planning — not built yet.**

---

## Research finding (why this shape, not a different one)

Checked Cardcom's full API spec (`docs/cardcom/swagger.json`, 11.0) end to end — there is **no
native "QR code" field or endpoint anywhere in Cardcom's API.** What they do provide is exactly
the right building block:

- `POST /LowProfile/Create` — creates a one-time, Cardcom-hosted payment page. Returns:
  - `LowProfileId` (guid) — the id we track this request by
  - `Url` — link to the hosted page where the *customer* (not us) types their card in
  - `UrlToBit` — a Bit-app-specific link (Bit is Israel's dominant QR/app payment method)
- `POST /LowProfile/GetLpResult` — given a `LowProfileId`, returns the current result
  (`LowProfileResult`), including a `TranzactionInfo` block with **the same fields** our existing
  `chargeCard()` already extracts (`Last4CardDigits`, `CardName`/`CardInfo`, `DocumentNumber`,
  `DocumentType`, `ApprovalNumber`, etc.) and a `DocumentInfo` block if Cardcom auto-created the
  invoice as part of the flow (same `DocumentTypeToCreate: TaxInvoiceAndReceipt` pattern we
  already use in `chargeCard`).
- The `WebHookUrl` callback (fired by Cardcom on completion) posts the **same** `LowProfileResult`
  shape to our server — but there is **no signature/HMAC field anywhere on this callback** in the
  spec. Security implication captured in the decisions log below.

So: **we render the QR code ourselves** (a small client-side QR library encoding `Url`), Cardcom
never sends us an image. This is the standard pattern for "payment request with QR" — same
information, no compromise on the final data our app stores.

---

## Decisions Log

| Topic | Decision |
|---|---|
| Who generates the QR image | We do, client-side (e.g. `qrcode` npm package rendering `Url` to a `<canvas>`). Cardcom only gives us the URL. |
| Webhook trust | The `WebHookUrl` callback body is **not treated as authoritative** — no signature exists to verify it. On receipt, we look up the `LowProfileId` in our own pending-requests table (must already exist — created by us) and then make our **own authenticated** server-to-server call to `GetLpResult` to fetch the true state before recording anything. The webhook is only ever a "go check now" trigger, never a data source. |
| Webhook vs. polling | **Both**, sharing one `finalizeLowProfilePayment(lowProfileId)` function, idempotent (no-ops if the local row is already resolved). Webhook = fast path when reachable; polling from the open modal = fallback/primary in local dev (no public HTTPS callback URL) and a safety net if the webhook is ever dropped. Same "don't trust silent async delivery" lesson as the Woo stock-sync resilience work — don't repeat that mistake here. |
| New DB table vs. reusing `cardcom_documents` | New table, `cardcom_lowprofile_requests`. `cardcom_documents` represents a **completed** Cardcom document; a QR request that's still pending, expired, or cancelled has no document yet and needs its own lifecycle/status. On success, we still write a `cardcom_documents` row exactly like `charge-card` does today — same downstream data shape, same "קארדקום OB" payment-method auto-link. |
| Local expiry | Independent of whatever timeout Cardcom's hosted page itself uses. We mark our local row `'expired'` after **10 minutes** if still pending, and the frontend stops polling and offers "Generate a new QR code." Prevents zombie pending rows and infinite polling if a customer just closes their phone. |
| Cancel button | Staff can cancel a pending request from our side at any time (`'cancelled'` status). Does not call any Cardcom cancel endpoint (LowProfile pages don't have one) — it just stops us caring about that `LowProfileId`; if the customer pays anyway after that, the webhook/poll finalize function still runs but skips creating a document if the row is already `cancelled`, and flags it (`status: 'paid_after_cancel'`) for manual review rather than silently double-booking. |
| Amount source | Always derived from the sale's current items server-side (same rule `chargeCard` already follows: "Cardcom requires payment total == sum(Price × Quantity), always derive from lines") — never trust a client-supplied amount. |
| Bit-specific QR | Not in scope for v1. `UrlToBit` is captured in the response for a possible later "Pay with Bit" quick-action, but the default QR encodes the generic `Url` (works for any card, scanned by any camera app) — narrower, well-understood first cut. |
| Concurrent requests per sale | Creating a new QR request for a sale that already has a `'pending'` row auto-expires the old row first (mirrors the existing `enqueueSyncWooStock` "remove obsolete jobs" pattern) — only one live QR per sale at a time. |
| Success/fail redirect pages | Build small branded static pages (e.g. "Payment received — you can close this tab" / "Payment failed — please ask staff for a new QR code") under `apps/web/public/`, referenced by `SuccessRedirectUrl`/`FailedRedirectUrl`. Customer's own phone browser lands here after paying on Cardcom's hosted page — never seen by staff. |
| Local/dev webhook testing | Not required. The webhook is a pure optimization/fallback (per the "webhook vs. polling" decision above) — local dev relies on the polling path alone, no ngrok/tunnel setup needed. |
| "Request Payment (QR)" placement | Lives right next to "Pay with Terminal" in the same action area on the sale detail screen (same reachability as today's terminal button, including the mobile "More actions" pattern if that's where "Pay with Terminal" itself currently sits). |

---

## Schema change

`packages/db/src/schema/cardcom.ts` — new table:

```typescript
export const cardcomLpStatusEnum = pgEnum('cardcom_lp_status', [
  'pending', 'paid', 'failed', 'expired', 'cancelled', 'paid_after_cancel',
])

export const cardcomLowprofileRequests = pgTable('cardcom_lowprofile_requests', {
  id:            uuid('id').primaryKey().defaultRandom(),
  saleId:        uuid('sale_id').notNull().references(() => sales.id, { onDelete: 'cascade' }),
  lowProfileId:  text('low_profile_id').notNull().unique(), // Cardcom's guid
  amount:        numeric('amount', { precision: 10, scale: 2 }).notNull(),
  status:        cardcomLpStatusEnum('status').notNull().default('pending'),
  url:           text('url').notNull(),          // the page we turned into a QR
  rawResult:     jsonb('raw_result'),             // last GetLpResult payload, for debugging
  documentId:    uuid('document_id').references(() => cardcomDocuments.id), // set once paid
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  resolvedAt:    timestamp('resolved_at', { withTimezone: true }),
})
```

Migration `packages/db/src/migrations/00XX_add_cardcom_lowprofile_requests.sql`. No backfill.

---

## Phase 1 — Cardcom service functions

`apps/api/src/services/cardcom.ts` — add, alongside the existing `chargeCard`/`createDocument`:

```typescript
export async function createLowProfile(params: {
  saleId: string
  amount: number
  customerName: string
  customerEmail: string | null
  isVatFree: boolean
  items: Array<{ name: string; quantity: number; unitPrice: number }>
}): Promise<{ lowProfileId: string; url: string; urlToBit: string | null }>

export async function getLowProfileResult(lowProfileId: string): Promise<LowProfileResultShape>
```

- `createLowProfile` calls `POST /LowProfile/Create` with `Operation: 'ChargeOnly'`,
  `SuccessRedirectUrl`/`FailedRedirectUrl` pointed at a small static "you can close this tab" page
  we host (the customer's own phone browser lands there, we never see it), `WebHookUrl` pointed at
  the new webhook route below, and a `Document` block identical in shape to the one already built
  in `chargeCard` (`DocumentTypeToCreate: 'TaxInvoiceAndReceipt'`, `Products`, `Name`, `Email`,
  `IsVatFree`, `AdvancedDefinition.IsAutoCreateUpdateAccount` + `AccountForeignKey`).
- `getLowProfileResult` calls `POST /LowProfile/GetLpResult` with our `ApiName`/`ApiPassword` +
  the `lowProfileId` — this is the "ask Cardcom directly" call used by both the webhook handler
  and the polling endpoint, never trusting a webhook body directly (per decisions log).

**Effort:** small — thin wrappers around `post<T>()`, same pattern as every other function in this
file. The `Document` block is a near copy-paste from `chargeCard`.

---

## Phase 2 — Shared finalize logic (used by both webhook and polling)

Extract the "payment succeeded" tail of the existing `/api/sales/:id/charge-card` route
(`apps/api/src/routes/invoices.ts` lines ~438–460: insert `cardcom_documents` row, auto-link the
"קארדקום OB" payment method) into a shared helper, e.g. `apps/api/src/services/cardcom-payment.ts`:

```typescript
export async function recordCardcomPayment(saleId: string, result: {
  documentType: string; documentNumber: number
  transactionId: number; last4Digits: string; cardBrand: string
}): Promise<{ documentId: string }>
```

`chargeCard`'s route and the new LowProfile finalize path both call this — guarantees byte-for-byte
identical downstream behavior ("the sale gets all the details as if entered manually" isn't just a
data-shape promise, it's the *same code path*).

Then, `finalizeLowProfilePayment(lowProfileId)`:
1. Load the local `cardcom_lowprofile_requests` row by `lowProfileId`. If missing → log + ignore
   (webhook for a request we don't recognize, e.g. stale/replayed). If `status !== 'pending'` →
   no-op (idempotent — handles webhook + poll racing each other, or a duplicate webhook delivery).
2. Call `getLowProfileResult(lowProfileId)` — the authoritative check.
3. `ResponseCode === 0` and `TranzactionInfo` present → call `recordCardcomPayment`, set local row
   `status: 'paid'`, `documentId`, `resolvedAt`. If the row had been `cancelled` in the meantime,
   use `'paid_after_cancel'` instead and still record the document (money moved — must not lose
   the paper trail) but leave a note for manual review (surfaced in the sale's audit log/notes).
4. Non-zero `ResponseCode` with a terminal failure → `status: 'failed'`, `resolvedAt`, store
   `rawResult`. Anything else (still genuinely pending on Cardcom's side) → leave `pending`.

**Effort:** medium — the idempotency/race handling is the only subtle part; everything else reuses
existing patterns 1:1.

---

## Phase 3 — Routes

```
POST /api/sales/:id/qr-payment-request        (auth — staff-initiated, same as charge-card)
GET  /api/sales/:id/qr-payment-request/:reqId  (auth — frontend polls this while modal is open)
POST /api/sales/:id/qr-payment-request/:reqId/cancel  (auth)
POST /api/webhooks/cardcom/lowprofile          (public — Cardcom calls this; no bearer, see below)
```

- `POST .../qr-payment-request`: expires any existing `pending` row for the sale, computes amount
  from current sale items (never client-supplied), calls `createLowProfile`, inserts the local row,
  returns `{ requestId, url, expiresAt }` to the frontend. `url` is what gets QR-encoded client-side.
- `GET .../qr-payment-request/:reqId`: if `status === 'pending'` **and** more than ~3s has passed
  since the last check (basic self-throttle so a laggy poller can't hammer Cardcom), calls
  `finalizeLowProfilePayment` inline before responding, then returns the current row's
  `{ status, documentId, last4Digits, cardBrand, documentNumber, docUrl }` once resolved. This
  makes the poll itself the mechanism that advances state — no separate cron needed for this
  feature (unlike the Woo reconciliation job, requests here are always short-lived and
  actively watched by an open modal).
- `.../cancel`: sets `status: 'cancelled'` if currently `pending`, else 409.
- `POST /api/webhooks/cardcom/lowprofile`: **no per-request secret to check against** (per the
  spec finding above) — accepts the callback, extracts `LowProfileId` from the body, and calls
  `finalizeLowProfilePayment(lowProfileId)`. Since that function always re-verifies against
  Cardcom's own `GetLpResult` before doing anything, a forged callback body can't cause a false
  "paid" — worst case it triggers a wasted `GetLpResult` call for a `LowProfileId` that isn't
  `pending` locally, which is a no-op. Always returns `200` (Cardcom's callback contract expects
  this to mean "accepted").

**Effort:** medium.

---

## Phase 4 — Frontend

New `apps/web/src/components/sales/CardcomQrPaymentModal.vue`, sibling to the existing
`CardcomTerminalModal.vue`, reusing its success-state layout (`result.cardBrand`, `****last4`,
document link) so the two flows feel consistent.

- Wherever "Pay with Terminal" is currently triggered on the sale screen, add a second action
  "Request Payment (QR)" opening this new modal instead.
- On open: call `POST /qr-payment-request`, render the returned `url` as a QR code (`qrcode`
  package — lightweight, no extra backend dependency, pure client-side canvas render).
- Poll `GET /qr-payment-request/:reqId` every ~2s while `status === 'pending'`.
- `status === 'paid'` → stop polling, swap to the same success view as
  `CardcomTerminalModal.vue`, emit `charged` so the parent sale view refreshes exactly like the
  manual flow does today.
- `status === 'failed' | 'expired'` → show the error/expired state with a "Generate new QR code"
  button (re-runs the create call).
- "Cancel" button → calls the cancel route, closes the modal.
- Stop polling and show a local timeout state at 10 minutes even if the backend hasn't marked it
  `expired` yet (belt-and-suspenders, avoids a runaway `setInterval`).

**Effort:** medium — mostly UI; no new interaction patterns beyond what `CardcomTerminalModal.vue`
already establishes.

---

## Open questions before starting to build

**None — all resolved.** See the three added rows in the Decisions Log above (redirect pages,
local webhook testing, button placement).

---

## Documentation & hardening (applies across all phases)

- [ ] `docs/cardcom/CARDCOM_API_GUIDE.md` — add a `## LowProfile (QR payment) Endpoints` section
      once built, matching the existing guide's style.
- [ ] Bump `package.json` (root + `apps/web`) per project convention on ship.
- [ ] Manual production smoke test: real small-amount charge on the test terminal (`1000`) first,
      then one live low-amount run on the production terminal before calling it done — same
      "exercise happy path + failure path" convention used for every other Cardcom feature so far.
- [ ] `pnpm --filter @ob-inventory/api build` / web typecheck clean before every deploy.

---

## Build sequence

```
Schema    cardcom_lowprofile_requests table + migration
Phase 1   Cardcom service: createLowProfile, getLowProfileResult
Phase 2   Shared recordCardcomPayment + finalizeLowProfilePayment
Phase 3   Routes: create / status-poll / cancel / webhook
Phase 4   Frontend: CardcomQrPaymentModal.vue + entry point next to "Pay with Terminal"
```

Straight-line build — no phase is independently shippable ahead of the others the way the API
write-expansion plan's phases were; this is one feature, sequenced by dependency order.
