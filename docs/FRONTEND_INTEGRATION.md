# Raiquid API — Frontend Integration Guide

For frontend developers building against this API. It explains **how the
endpoints fit together into real flows** — the ordering, the preconditions, the
state each call moves the system through.

It is **not** a field-by-field reference. For exact request/response shapes,
always check `/docs` (Swagger) — it's generated from the real code and this
guide is not. Where this guide and Swagger disagree, Swagger is right.

You do not need to read anything else in this repo to use the API. If you want
the *why* behind a limitation, `docs/RAIQUID_CONTEXT.md` has it.

---

## 1. Getting started

**Base URLs**

| Environment | Base URL |
| ----------- | -------- |
| Production  | `https://raiquid-api-production.up.railway.app` |
| Local dev   | `http://localhost:3000` — see the README's **Quick start** section to run it |

There is no `/api` prefix. A frontend screen at `/investor/marketplace` calls
`GET https://<base>/investor/marketplace`.

- Swagger UI: `<base>/docs` (public, works in production too)
- Health check: `<base>/health` (public)

**One thing to know before you write a fetch call:** for exact request bodies,
query params, and response shapes, use `/docs`. This guide deliberately does not
repeat them, and describing them from memory is how they drift.

**CORS heads-up.** The API allows exactly one browser origin, read from its
`FRONTEND_URL` environment variable, with credentials. The **deployed** API's
`FRONTEND_URL` is currently `http://localhost:3000`, so browser calls to
production from any other origin are CORS-blocked until that variable is pointed
at your real frontend origin. Server-to-server calls (no `Origin` header) are
unaffected.

---

## 2. Authentication

Every route requires a **Clerk session token** as a bearer header:

```
Authorization: Bearer <clerk session token>
```

**...except these public routes** (verified against the controllers — nothing
else is public):

| Route | Why it's public |
| ----- | --------------- |
| `GET /health` | uptime probe |
| `GET /docs` | Swagger UI |
| `POST /webhooks/clerk` | called by Clerk's servers, authenticated by svix signature, not a session |
| `GET /confirm/:invoiceId` | buyer magic-link confirm page — reached with no login (see §4) |
| `POST /confirm/:invoiceId/review` | buyer accept/dispute action on that same page |

### How the guard actually behaves

`ClerkAuthGuard` runs on every non-public route and does two things:

1. **Verifies the bearer token.** Missing or invalid/expired token →
   **`401 Unauthorized`**.
2. **Looks up the matching local `User` record** (by Clerk user id) to attach
   the caller's role and internal id. This lookup is *best-effort* — it does not
   fail the request if there's no local record.

A local `User` record is only created by the Clerk **webhook**, when Clerk fires
`user.created`. So there's a window right after sign-up where the session token
is valid but the backend hasn't provisioned the user yet.

**In that window, calls do not 401 — they `403 Forbidden` with the message
`"User is not provisioned yet"`**, thrown by whichever endpoint you hit.

Practical consequence for the frontend: after login, treat

- `401` → session problem — re-authenticate.
- `403 "User is not provisioned yet"` → provisioning hasn't caught up — retry
  with backoff; it should resolve within seconds of `user.created` being
  delivered.

### The role, and where it comes from (open item)

When Clerk fires `user.created`, the webhook reads the user's role from:

```
data.public_metadata.role   ?? data.unsafe_metadata.role
```

Which of those two fields actually carries the role is **an unverified
assumption** — the real Clerk integration on the frontend doesn't exist yet.
`public_metadata` is checked first (in case the role ends up being set
server-side), falling back to `unsafe_metadata` (which is all Clerk's
client-side `signUp` can write directly).

Whoever builds the sign-up flow needs to set `role` to one of
`business` / `buyer` / `investor` / `admin` in one of those metadata fields. If
neither is a valid role, the webhook logs it and **skips provisioning entirely**
(no `User` record, so every authed call 403s). Webhook provisioning is
idempotent, so a redelivery of the same `user.created` is harmless.

`user.updated` and `user.deleted` are **not handled yet** — changing your
name/email in Clerk won't propagate to the backend.

---

## 3. Core domain concepts

A primer. `docs/RAIQUID_CONTEXT.md` has the reasoning behind the gaps.

### Roles

| Role | Who they are |
| ---- | ------------ |
| `business` | A supplier. Submits invoices for financing, gets paid out when they fund. |
| `buyer` | The debtor named on an invoice — the party that owes the money and eventually repays it. May act through the public confirm flow without ever signing in. |
| `investor` | A funder. Puts capital into tokenized invoices and gets repaid principal when the buyer pays. |
| `admin` | Platform operator. Read-only dashboards + the whitelisting review queue. |

Each of `business` / `buyer` / `investor` gets a 1:1 profile record created by
the Clerk webhook. `admin` has no profile record.

### `InvoiceStatus` — the lifecycle

The enum is `submitted → awaiting_acceptance → tokenized → funding → funded →
repaid`, plus `overdue`. **What the API actually does today:**

| From | To | Trigger |
| ---- | -- | ------- |
| *(none)* | `submitted` | `POST /business/invoices` — every new invoice starts here |
| `submitted` | `tokenized` | buyer accepts via `POST /confirm/:invoiceId/review` `{ accept: true }` (also sets `confirmedAt`) |
| `tokenized` | `funding` | an investor funds part of it (`POST /investor/marketplace/:id/fund`) |
| `funding` / `tokenized` | `funded` | funding reaches the full invoice amount |
| `funded` | `repaid` | buyer pays it (`POST /buyer/invoices/:id/pay` — also sets `repaidAt`) |

Gaps to know about:

- **`awaiting_acceptance` is never set.** Invoices go straight from `submitted`
  to `tokenized`. Don't build UI around it.
- **`overdue` is never set.** Nothing in the API moves an invoice to `overdue`
  (no scheduled job). The pay endpoint and payment schedule *accept* it, but you
  won't see it in practice — compute "overdue" on the client from `dueDate` for
  now.
- **There is no declined / disputed status.** A buyer disputing an invoice does
  not change its status (see §4). It stays `submitted`.

### `ProvenanceTier`

`quarried` / `carried` / `anchored` — a buyer's trust tier, on the `Buyer`
record. It determines the fee percentages the backend puts on that buyer's
invoices (`platformFeePct`, `reserveContributionPct`), server-side — a frontend
never sends fees. New buyers default to `quarried`. Only `carried`'s fee numbers
are product-confirmed; the other two are placeholders that currently mirror
`carried`.

### `WhitelistStatus`

An investor's KYC/eligibility state: `identity_submitted` → `in_review` →
`whitelisted`. New investors start at `identity_submitted`. Only a `whitelisted`
investor can fund invoices (browsing the marketplace is open to any investor).
There is **no `rejected` value** — an admin rejection sends the investor back to
`identity_submitted`.

---

## 4. Per-role workflows

Each sequence lists calls in the order a frontend would make them. Method +
path are copied from the real controllers. Standard success codes: `GET` and
`PATCH` → `200`; `POST` → `201` (except `POST /webhooks/clerk` → `200`).

List endpoints take `?page=` (default 1) and `?pageSize=` (default 20, max 100)
and return `{ data, page, pageSize, total }`.

### Business

The supplier journey: get set up, submit an invoice, watch it get funded, get
paid.

1. `GET /business/settings` — load the profile (created by the webhook).
   `PATCH /business/settings` — fill in `legalName`, `payoutWalletAddress`,
   contact fields, etc.
2. `POST /business/invoices` — submit an invoice. You send the invoice details
   **and the buyer's** `buyerLegalName` + `buyerContactEmail` (+ optional phone).
   You do **not** send fees — the backend sets them from the buyer's provenance
   tier. On success the backend:
   - creates the `Invoice` at status `submitted`,
   - finds-or-creates a `Buyer` record by that email,
   - generates a confirm token and **emails the buyer a magic link** to review it.
   - `409` if you reuse an `invoiceNumber` you've already used.
3. `GET /business/invoices` (optionally `?status=`) — list your invoices.
   `GET /business/invoices/:id` — one invoice, including its `buyer`, `holdings`
   (investor stakes) and `onChainEvents`.
4. The invoice now moves on its own: buyer accepts (→ `tokenized`), investors
   fund (→ `funding` → `funded`). When it becomes fully `funded` you receive a
   wallet credit (the invoice amount minus platform + reserve fees) and an
   in-app notification.
5. `GET /business/wallet` — `{ balance, currency, transactions }`.

### Buyer

Two separate surfaces. Most buyers first meet the product through the
**public confirm flow** (they may never sign in); the authenticated dashboard is
for buyers who do have an account.

#### Public confirm flow (no auth — build this as a standalone page)

The buyer gets an email linking to `{FRONTEND_URL}/confirm/{token}`, where
`{token}` is a 64-character opaque string (it is **not** an invoice id — the
route param is named `:invoiceId` for historical reasons but it's the confirm
token).

1. `GET /confirm/{token}` — **no `Authorization` header**. Returns the invoice
   with its `buyer` and `business` embedded, for the buyer to review.
   `404` if the token is unknown.
2. `POST /confirm/{token}/review` — **no `Authorization` header** —
   `{ accept: true }` or `{ accept: false, note?: string }`.
   - `accept: true` → invoice → `tokenized`, `confirmedAt` set. The business is
     notified + emailed. Returns the updated invoice.
   - `accept: false` (dispute) → **no status change** — there is no "disputed"
     state. The business is notified (warning tone) + emailed with the note.
     Returns the invoice unchanged.
   - `409` if the invoice was already **accepted** (`confirmedAt` is set). A
     dispute does not set `confirmedAt`, so a dispute can be submitted more than
     once — don't assume this call is single-use on the decline path.

#### Authenticated buyer dashboard

1. `GET /buyer/invoices` (optionally `?status=`) — invoices this buyer owes.
2. `GET /buyer/payment-schedule` — invoices in `funded` or `overdue`, soonest
   `dueDate` first. (In practice `overdue` won't appear — see §3.)
3. `POST /buyer/invoices/:id/pay` — `{ amount, paymentReference? }`. Records the
   repayment.
   - `amount` must **exactly equal the full invoice amount** — no partial
     payments. A mismatch is `400`.
   - The invoice must be `funded` or `overdue`, else `409`.
   - On success: invoice → `repaid` (`repaidAt` set), and every investor holding
     a stake gets a `repayment` wallet transaction for their **principal** (no
     yield) plus a notification. `paymentReference` is stored on each of those
     transactions.
4. `GET /buyer/settings` / `PATCH /buyer/settings`.

### Investor

The funder journey: get whitelisted, add funds, invest, get repaid.

1. `GET /investor/settings` / `PATCH /investor/settings` — `displayName`,
   `countryOfResidence`, `investingWalletAddress`.
2. **Whitelisting** (required before funding):
   1. `GET /investor/whitelisting` — current `{ whitelistStatus, countryOfResidence, displayName }`.
   2. For each KYC document: `POST /investor/whitelisting/upload-url` with
      `{ documentType: "identity" | "proof_of_address", contentType: "image/jpeg" | "image/png" | "application/pdf" }`
      → `{ uploadUrl, objectKey }`.
   3. `PUT` the file bytes **directly to `uploadUrl`** (an S3-style presigned
      PUT). You must send the same `Content-Type` you asked for — R2 rejects a
      mismatch. The API never sees the file.
   4. `POST /investor/whitelisting` with
      `{ countryOfResidence, legalName, identityDocumentKey?, proofOfAddressKey? }`
      — the `objectKey`s from step 2. Status → `in_review`. A key that isn't
      under your own namespace is a `400`.
   5. An admin reviews (§ Admin). Approve → `whitelisted` (+ notification).
      Reject → back to `identity_submitted` (+ notification) — you re-do the
      submission.
3. `POST /investor/wallet/deposit` — `{ amount }` — adds **simulated sandbox
   funds** to your wallet. There is no payment integration; this is the only way
   to get a wallet balance. `amount` must be positive, ≤ 2 decimal places,
   ≤ 1,000,000,000.
4. **Marketplace** (open to any investor, whitelisted or not):
   `GET /investor/marketplace` — invoices open for investment (status
   `tokenized` or `funding`). `GET /investor/marketplace/:id` — one listing
   (`404` if it isn't open for investment).
5. `POST /investor/marketplace/:id/fund` — `{ amount }`.
   - Requires `whitelistStatus === "whitelisted"` → `403` otherwise.
   - Minimum `amount` is **5,000** → `400` below that.
   - `amount` can't exceed the invoice's remaining unfunded balance → `400`.
   - `amount` can't exceed your wallet balance → `400`.
   - `409` if the invoice isn't `tokenized` / `funding` any more.
   - On success: a `Holding` is created (or your existing one is topped up), an
     `invested` wallet transaction is written, and the invoice advances to
     `funding` or (if now fully funded) `funded`.
6. `GET /investor/portfolio` — your holdings (each with its `invoice`).
   `GET /investor/portfolio/:id` — one holding.
7. `GET /investor/wallet` — `{ balance, currency, transactions }`.
8. When the buyer repays a funded invoice you hold, you get a `repayment` wallet
   transaction for exactly your principal, plus a notification. No return/yield
   is paid (see §6).

### Admin

Requires the `admin` role — **any other role gets `403`** on every `/admin/*`
route.

- `GET /admin/overview` — `{ totalValueFinanced, activeInvoices, onTimeRepaymentRate, activeInvestors, definitions }`. `definitions` is a map of human-readable explanations of each metric; `onTimeRepaymentRate` is `null` until at least one invoice is repaid.
- `GET /admin/reserve` — `{ reserveBalance, totalValueFinanced, coverageRatio, claims, note }`. `claims` is always `[]` — there is no claims model. `coverageRatio` is `null` until anything is financed.
- `GET /admin/provenance` — `{ buyers, byTier, note }`. Every buyer with its
  tier and reputation metrics; `byTier` is a count per `ProvenanceTier`. The
  reputation metrics are all `0` (see §6).
- `GET /admin/ledger` (optionally `?action=` and `?status=`) — the
  `OnChainEvent` mirror table, paginated. **Populated by the separate on-chain
  service, not this API** — it may be empty. `action` ∈
  `mint|whitelist|transfer|burn`, `status` ∈ `confirmed|pending|failed`.
- `GET /admin/whitelisting` — the review queue: every investor whose
  `whitelistStatus != whitelisted`, each with its `user` (email, name) and
  `kycDocuments`. Paginated.
- `POST /admin/whitelisting/:investorId/decision` — `{ approve: boolean, note?: string }`.
  Approve → `whitelisted`; reject → `identity_submitted`. `404` for an unknown
  investor id; `409` if you approve someone who is already `whitelisted`. The
  investor gets a notification either way; `note` is included in it.

### Notifications (any authenticated user)

- `GET /notifications` — `{ data, page, pageSize, total, unreadCount }`, newest
  first. `?unreadOnly=true` filters to unread. `unreadCount` is always the
  caller's total unread, regardless of the filter.
- `PATCH /notifications/:id/read` — mark one read. Idempotent (a second call is
  a no-op and still `200`). `404` if the notification isn't yours — the API does
  not distinguish "not found" from "not yours".

No endpoint *creates* notifications — they're side effects of domain events:

| Event | Recipient |
| ----- | --------- |
| Buyer accepts an invoice | the invoice's business owner |
| Buyer disputes an invoice | the invoice's business owner |
| An invoice becomes fully funded | the invoice's business owner |
| An invoice is repaid | every investor holding a stake in it |
| A whitelisting decision is made | the investor |

Each notification has `tone` (`positive` / `informational` / `warning`),
`title`, `body`, an optional `href` (a frontend route to deep-link to), and
`readAt` (null until marked read).

---

## 5. Error handling

Every error — from validation, guards, or business logic — comes back in one
shape (from `AllExceptionsFilter`):

```json
{
  "statusCode": 403,
  "message": "User is not provisioned yet",
  "error": "Forbidden",
  "path": "/investor/wallet",
  "timestamp": "2026-09-08T21:59:41.518Z"
}
```

`message` is a **string** for most errors, or a **string array** for validation
failures (one entry per invalid field). `error` is the HTTP status name. 5xx
responses never leak internals — `message` is just `"Internal server error"`.

### Status codes used by this API

| Code | In this API it means |
| ---- | -------------------- |
| `200` | OK (`GET`, `PATCH`, and `POST /webhooks/clerk`) |
| `201` | Created / action accepted (all other `POST`s) |
| `400` | Request body/params failed validation, **or** a business rule on the values you sent (e.g. fund amount over the remaining balance, pay amount ≠ invoice amount, KYC key not in your namespace). Also returned by `forbidNonWhitelisted` if you send a field the DTO doesn't declare. |
| `401` | No bearer token, or the token is invalid/expired. **Purely a token problem** — re-authenticate. Also returned by the webhook on a bad signature. |
| `403` | You're authenticated but not allowed: `"User is not provisioned yet"` (local record not created yet — retry), a non-`admin` calling `/admin/*`, or a non-whitelisted investor calling `fund`. **Not a token problem.** |
| `404` | The thing doesn't exist *or isn't yours* — profile not found, invoice / listing / holding / notification / investor not found, unknown confirm token. |
| `409` | State conflict — duplicate `invoiceNumber`, invoice already reviewed, invoice not in a fundable/payable state, investor already whitelisted. |
| `429` | Rate limit — 100 requests per 60 seconds per IP, across all routes. |
| `500` | Unexpected server error. |

The `401` vs `403` split is the important one post-login: `401` means *fix the
session*, `403 "User is not provisioned yet"` means *wait and retry*.

---

## 6. Known limitations — build around these

These are current gaps. Don't build UI that assumes they work.

- **No partial invoice payments.** `POST /buyer/invoices/:id/pay` requires the
  exact full invoice amount; anything else is `400`. No "pay ₦X of ₦Y".
- **No declined / disputed invoice state.** Disputing via the confirm flow
  leaves the invoice `submitted`; the dispute is only a notification + email to
  the business. Don't drive a "disputed" badge/filter off invoice status. The
  dispute action is also replayable.
- **No rejected whitelist state.** An admin rejection returns the investor to
  `identity_submitted`, indistinguishable from a fresh submitter. Surface the
  outcome from the notification the investor receives, not from status.
- **`overdue` invoice status is never assigned.** No job transitions invoices to
  `overdue`. Compute overdue-ness on the client from `dueDate`.
- **`awaiting_acceptance` invoice status is never assigned.** `submitted` goes
  straight to `tokenized`.
- **Buyer reputation metrics are always zero.** `acceptanceRate`,
  `onTimePaymentRate`, `invoicesFinancedCount` on every `Buyer` (in
  `/admin/provenance` and anywhere a buyer is embedded) read as `0`. No formula
  is wired up. Don't present them as real figures.
- **Investor repayment is principal only.** A repaid investor gets back exactly
  what they invested — no yield, no return. Don't show projected or realised
  returns; there's no field to compute them from yet.
- **`Holding.tokenUnits` is a placeholder.** On funding it's set equal to the
  amount invested. Real on-chain unit accounting comes from the separate
  minting service, which isn't wired up. Don't present `tokenUnits` as a
  meaningful token quantity — it's just a copy of the fiat amount right now.
- **KYC uploads aren't verified server-side.** The API stores the `objectKey`
  you submit but never confirms the file actually reached R2. A whitelisting
  submission is accepted regardless of whether the `PUT` happened.
- **No "mark all notifications read".** Only `PATCH /notifications/:id/read`, one
  at a time. `unreadCount` only decreases as you mark individual items read.
- **Provenance fee tiers aren't all confirmed.** Only `carried` has
  product-confirmed fee percentages; `quarried` and `anchored` currently use the
  same placeholder numbers. The fees shown on an invoice may change later.
- **Concurrent funding can slightly over-fund.** Two investors funding the last
  slice of an invoice at the same instant could push `fundedAmount` a little
  past `amount`. Rare; don't hard-assert `fundedAmount <= amount` in the UI.
- **Investor wallet balances are simulated.** `POST /investor/wallet/deposit`
  just credits the wallet — there is no real payment rail. Every money movement
  in the product is sandbox.
- **`/admin/ledger` depends on an external service.** The `OnChainEvent` rows
  are ingested by the separate on-chain service; this API only reads them. The
  ledger can be empty.
- **Clerk `user.updated` / `user.deleted` aren't handled.** A user changing
  their name or email in Clerk won't update the backend record.
- **The whitelisting queue has no audit trail.** Nothing records which admin
  made a decision or when.

---

## 7. Where to go for more

- **`<base>/docs`** — Swagger UI, generated from the code. The authoritative
  reference for every request and response shape. Use it constantly.
- **`docs/RAIQUID_CONTEXT.md`** (in this repo) — the reasoning behind every
  limitation above, plus backend implementation notes. Read it if you need the
  *why*, not just the *what*.
