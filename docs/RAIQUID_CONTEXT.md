# Raiquid API — context notes

Cross-cutting notes that don't belong in code comments or the README: things
learned from the frontend that affect future backend work.

## Open decisions

- **Investor funding minimum — enforced.** The ₦5,000 per-investment floor
  from the frontend screens is now `@Min(5000)` on `FundInvoiceDto.amount`.
  This is the only confirmed constant on that screen; if product later adds
  a per-tier or per-invoice minimum, it goes here too.

- **Investor fee model is unmodeled.** Investors are charged a fee taken out
  of their *return* on a funded invoice — a different concept from
  `Invoice.platformFeePct` / `Invoice.reserveContributionPct`, which are
  business-side fees charged against the invoice itself. Nothing in the
  schema currently represents an investor-side fee. This needs a schema
  decision (a field on `Holding`? a platform-wide config value?) before
  Investor funding logic is implemented — flagging so it isn't silently
  missed, not deciding it here.

- **Provenance fee schedule has only one confirmed tier.**
  `src/business/provenance-fee-schedule.ts` sets each invoice's
  `platformFeePct` / `reserveContributionPct` from the buyer's provenance
  tier (server-side; the client cannot send these). Only **Carried** is
  confirmed against the frontend: 3% platform fee, 1% reserve contribution.
  **Quarried** and **Anchored** currently reuse those same numbers as
  placeholders — this is not a "all tiers are equal" decision. Real numbers
  for those two are needed from product before this ships.

- **`InvoiceStatus` has no declined / disputed state.** When a buyer
  reviews an invoice via the magic link and chooses *dispute*
  (`POST /confirm/:invoiceId/review` with `accept: false`), the backend
  only emails the business — it does not change `Invoice.status`, because
  the enum has no value for "buyer rejected this" and the frontend's
  `InvoiceStatus` type mirrors this enum exactly. Adding a value is a
  cross-repo contract change, not a backend-only call. Consequence until
  then: a disputed invoice stays `submitted` and its dispute exists only
  as an email, and the decline path is replayable (nothing records that a
  review already happened, unlike accept which sets `confirmedAt`).

- **Buyer reputation metrics are not computed.** `Buyer.acceptanceRate`,
  `onTimePaymentRate`, and `invoicesFinancedCount` are left at their
  defaults. The confirm/accept/decline and pay flows deliberately do not
  touch them: there's no agreed formula yet (what's the denominator? does
  a decline count against acceptance? does an early payment help
  on-time rate?). These metrics are what a buyer's provenance tier is
  expected to be derived from, and the tier drives the fee schedule, so a
  wrong formula would eventually mis-price invoices. Needs a
  product-defined formula before wiring up.

- **Repayment fan-out is principal-only — no investor return.**
  `POST /buyer/invoices/:id/pay` now distributes the repayment: one
  `repayment` `WalletTransaction` per `Holding` for exactly
  `holding.amount`, `Holding.repaidAmount` set, `dto.paymentReference`
  written to each transaction's `description`. But investors get back
  only their principal — there's no yield/return. The real product pays
  a return, and there's no field to compute it from: `Invoice` has
  `platformFeePct` / `reserveContributionPct` (business-side), nothing
  investor-side. Blocked on (a) a schema field like
  `Invoice.expectedReturnPct` and (b) a decision on how/when that rate
  is set (at tokenization? per provenance tier? investor-negotiated?).
  Until then a "repaid" investor is made whole but earns nothing.

- **Partial invoice payments aren't supported.** `payInvoice` requires
  `dto.amount` to exactly equal `Invoice.amount`; a mismatch is a 400.
  There's no field on `Invoice` tracking a running paid balance, and
  adding one is a schema change (cross-repo coordination point).

- **Marketplace browsing is open; funding is whitelist-gated.**
  `GET /investor/marketplace` and `/marketplace/:id` only require an
  Investor profile — not a `whitelisted` status — matching the frontend,
  where the marketplace is always visible. `POST /marketplace/:id/fund`
  rejects (403) unless `whitelistStatus === whitelisted`. Recording this
  because it's a deliberate asymmetry, not an oversight.

- **No investor deposit endpoint.** `GET /investor/wallet` exists, but
  there is no `POST` anywhere in this API for an investor to add funds to
  their wallet. A real investor's balance is therefore always 0, so
  `fundInvoice`'s balance check can never pass in production. The e2e
  tests seed a `deposit` `WalletTransaction` directly via Prisma to work
  around this. Needs a deposit flow (its own endpoint, or an off-platform
  payment webhook) before funding works end to end.

- **`Holding.tokenUnits` is a placeholder.** On funding, `tokenUnits` is
  set equal to the invested `amount`. Real on-chain unit accounting (how
  many invoice tokens a given ₦ amount buys) comes from the separate
  minting service, which doesn't exist here. Once it does, `tokenUnits`
  should be populated from the actual mint/transfer event, not mirrored
  from the fiat amount.

- **KYC upload isn't verified.** `POST /investor/whitelisting/upload-url`
  returns a presigned R2 PUT URL (key generated server-side as
  `kyc/{investorId}/{documentType}/{uuid}`, `contentType` bound into the
  signature). `submitWhitelisting` then records a `KycDocument` row per
  key. What it does **not** do: confirm the object actually landed in R2.
  A client can request a URL and never PUT to it, or claim it uploaded
  and pass the key anyway — the row would point at nothing. Real KYC
  review needs a HEAD check (at submit, or lazily when an admin opens the
  doc) or an R2 event notification. Also: this has only ever been
  exercised against placeholder R2 credentials — presigning is a local
  signature computation so the URL *shape* is verified, but no real
  upload has happened.

- **`/admin/overview` on-time repayment rate is an approximation.**
  There is no `repaidAt` column (deferred here twice already), so
  `AdminService.getOverview` uses `Invoice.updatedAt <= dueDate` (day
  granularity) as the on-time signal for repaid invoices. `updatedAt` is
  touched by *any* field write, not just the repaid transition, so the
  rate can drift in either direction. It's returned with an explicit
  `definitions.onTimeRepaymentRate` label and is `null` until anything is
  repaid. A real implementation needs the `repaidAt` field — the same one
  the partial-payment and repayment-audit gaps above also need. This is
  the third feature to want it; it's probably time.

- **Concurrent funding of the same invoice has a race window.**
  `fundInvoice` reads the invoice, checks `remaining >= amount`, then
  writes in a transaction using an atomic `increment` on `fundedAmount`.
  Two funds landing between the check and the write could together
  over-fund past the invoice amount. Low stakes at current volume;
  a `SELECT ... FOR UPDATE` (raw SQL) on the invoice inside the
  transaction would close it.

## Accepted npm audit findings

`npm audit` reports 4 high-severity findings (`mysql2`, `deepmerge-ts`).
Both come in only through the `prisma` CLI package:

- `prisma` is a **devDependency**. It bundles a driver for every database
  Prisma supports (`mysql2`, `postgres`, `better-sqlite3`, …) so CLI
  commands work whatever `provider` a schema uses. This schema is
  `postgresql` only, so the `mysql2` code path is never entered.
- `deepmerge-ts` (via `@prisma/config`) does run — but only when the CLI
  loads `prisma.config.ts` during `prisma generate` / `migrate` / `validate`.
  It merges our own local config object, not attacker-controlled input.
- Nothing under `src/` imports `prisma`, `@prisma/config`, `mysql2`, or
  `deepmerge-ts`. `prisma.config.ts` is excluded from `tsconfig.build.json`,
  so none of this is in `dist/` or runs in the deployed API.
- `@prisma/client` (a real runtime dependency) lists `prisma` only as an
  *optional* peer dependency, for version-compatibility checks — not a
  `require()`.

`npm audit fix --force` would downgrade `prisma` to 6.19.3, a breaking
regression from 7.10.0 — rejected. **Revisit** when bumping Prisma majors
(the CLI may drop `mysql2` or ship a patched version), or if `prisma` /
`@prisma/config` ever becomes an actual runtime import.
