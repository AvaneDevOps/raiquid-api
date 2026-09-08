# Raiquid API — context notes

Cross-cutting notes that don't belong in the README and — per the Conventions
section there — no longer live in code comments: deferred decisions, gaps
learned from the frontend, and behavioural details that would otherwise be a
`/** */` block.

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
  notifies + emails the business — it does not change `Invoice.status`,
  because the enum has no value for "buyer rejected this" and the
  frontend's `InvoiceStatus` type mirrors this enum exactly. Adding a
  value is a cross-repo contract change, not a backend-only call.
  Consequence until then: a disputed invoice stays `submitted` and its
  dispute exists only as a notification + email, and the decline path is
  replayable (nothing records that a review already happened, unlike
  accept which sets `confirmedAt`). Because the notification + email are
  the *entire* outcome on dispute, that path is **not** best-effort — a
  send failure fails the request (safe, since the path is replayable).
  The accept path stays best-effort: the status change is durable and a
  failed email is only logged.

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

- **`Holding.tokenUnits` is a placeholder.** On funding, `tokenUnits` is
  set equal to the invested `amount`. Real on-chain unit accounting (how
  many invoice tokens a given ₦ amount buys) comes from the separate
  minting service, which doesn't exist here. Once it does, `tokenUnits`
  should be populated from the actual mint/transfer event, not mirrored
  from the fiat amount.

- **KYC upload isn't verified.** `POST /investor/whitelisting/upload-url`
  returns a presigned R2 PUT URL. The object key is generated server-side
  as `kyc/{investorId}/{documentType}/{uuid}` and is **never** taken from
  the client — a client-supplied key is a path-traversal / overwrite-
  someone-else's-document risk. `contentType` is bound into the signature
  (R2 rejects a PUT sending a different `Content-Type`).
  `submitWhitelisting` records a `KycDocument` row per key and rejects any
  key outside the caller's own `kyc/{investorId}/` prefix. What it does
  **not** do: confirm the object actually landed in R2.
  A client can request a URL and never PUT to it, or claim it uploaded
  and pass the key anyway — the row would point at nothing. Real KYC
  review needs a HEAD check (at submit, or lazily when an admin opens the
  doc) or an R2 event notification. Also: this has only ever been
  exercised against placeholder R2 credentials — presigning is a local
  signature computation so the URL *shape* is verified, but no real
  upload has happened.

- **Concurrent funding of the same invoice has a race window.**
  `fundInvoice` reads the invoice, checks `remaining >= amount`, then
  writes in a transaction using an atomic `increment` on `fundedAmount`.
  Two funds landing between the check and the write could together
  over-fund past the invoice amount. Low stakes at current volume;
  a `SELECT ... FOR UPDATE` (raw SQL) on the invoice inside the
  transaction would close it.

- **`WhitelistStatus` has no `rejected` state.** `POST /admin/whitelisting/:id/decision`
  with `approve: false` moves the investor back to `identity_submitted` — the
  same enum value as "submitted but never reviewed". The enum mirrors the
  frontend's shared type, so adding `rejected` is a cross-repo contract change,
  not a backend-only call (same reasoning as the invoice decline state above).
  Consequence until then: a rejected investor is indistinguishable from a
  fresh submitter apart from the warning notification they receive, and the
  admin queue (`whitelistStatus != whitelisted`) shows them again immediately.
  No audit trail records who decided what or when.

- **No mark-all-as-read.** `PATCH /notifications/:id/read` marks one
  notification read (idempotent; 404 for a notification that isn't the
  caller's). There is deliberately no bulk "mark all read" endpoint — no
  confirmed screen needs one. Add it if a tray design calls for it.

- **Only *full* funding notifies the business.** `fundInvoice` posts a
  notification when the invoice crosses to `funded`, not on each partial
  funding — otherwise a thinly-sliced raise would spam the supplier. If
  product wants "you've received a partial funding of ₦X" updates, that's a
  separate, opt-in notification.

- **Whitelisting submission doesn't notify admins.** `submitWhitelisting`
  sets the investor to `in_review` and stores KYC docs but pushes no
  notification anywhere — the admin whitelisting queue
  (`GET /admin/whitelisting`) is pull-based. There is no admin
  push-notification target (no admin contact list / channel defined).

- **Clerk role source is an unverified assumption.** The webhook reads the
  role as `data.public_metadata?.role ?? data.unsafe_metadata?.role`.
  Clerk's client-side `signUp` can only write `unsafe_metadata`; setting
  `public_metadata` needs a backend call with the secret key. The
  frontend's real Clerk integration isn't wired up yet, so which one
  actually carries the role is a guess — `public_metadata` is checked
  first in case it ends up being set server-side. Provisioning is
  idempotent (`upsert` keyed on `clerkUserId`), so a svix redelivery of
  the same `user.created` is a no-op. `user.updated` / `user.deleted`
  webhook events are not handled yet (TODOs in `WebhooksService`).

- **Webhook provisioning skips on an email collision.** If a Clerk
  `user.created` carries an email that already belongs to a different
  `clerkUserId` (e.g. a Clerk account deleted then recreated), the unique
  constraint on `User.email` trips; `provisionUser` logs and returns
  rather than 500-ing into Clerk's retry loop. Relinking accounts is an
  unmade product decision.

- **Email sends from `send.avane.online`.** `EmailService` sends from
  `Raiquid <no-reply@send.avane.online>` — a verified subdomain of
  `avane.online`, not the root domain and not `raiquid.io`. It's a
  subdomain on purpose: `avane.online`'s root already runs Zoho-hosted
  email (its own MX / SPF records), so Resend's sending infrastructure
  lives on an isolated subdomain to avoid clashing with that. This is a
  real verified working domain, not a placeholder — no obligation to
  change it. Revisit only if a dedicated `raiquid.io` domain is acquired
  and set up in Resend later.

- **Buyers are matched by lowercased `contactEmail`.** On invoice submit,
  `createInvoice` does a find-or-create on the buyer by lowercased email —
  a small race window between find and create, acceptable at this scale. A
  buyer reached only through the magic-link confirm flow has no Clerk
  account, so `Buyer.userId` is optional.

## Implementation notes

Behavioural details that live only in the code (no comments there any more —
see the Conventions section of the README). Not gaps; just things worth
knowing before you change the surrounding code.

- **Auth: session vs. role vs. local `User` row.** A valid Clerk token
  passes `ClerkAuthGuard`; the local `User` lookup it then does is
  best-effort, so `AuthUser.role` / `AuthUser.dbUserId` can be `undefined`
  for a signed-in-but-unprovisioned user. Only `AdminController` is
  role-locked (`@Roles(admin)`, enforced by `RolesGuard`, which runs after
  `ClerkAuthGuard`). The `business` / `buyer` / `investor` controllers
  require only a session — a signed-in investor hitting `/business/*` gets
  a 404 "Business profile not found" from the service, not a 403. Each
  service's `getXForUser` throws `ForbiddenException('User is not
  provisioned yet')` when `dbUserId` is missing and `NotFoundException`
  when the profile row doesn't exist.

- **Clerk client is hand-rolled.** There is no official `@clerk/nestjs`
  package, so `ClerkClientProvider` builds a `@clerk/backend` client and
  exposes it via the `CLERK_CLIENT` token. Nothing injects it yet —
  `ClerkAuthGuard` uses the networkless `verifyToken` directly. It's
  scaffolding for the unhandled `user.updated` / `user.deleted` webhook
  events, which will need real Clerk API calls.

- **Guard registration is shaped for e2e overrides.** `ClerkAuthGuard` and
  `RolesGuard` are registered in `AuthModule` as concrete providers plus
  `{ provide: APP_GUARD, useExisting: <Guard> }` — not inline `useClass`.
  A `useClass`-only `APP_GUARD` entry gets a synthetic token that
  `overrideProvider(ClerkAuthGuard)` in e2e tests can't reach; the
  `useExisting` alias keeps the guard independently overridable.

- **Global `ValidationPipe`** runs `whitelist` + `forbidNonWhitelisted` +
  `transform` but **not** `enableImplicitConversion` — DTOs opt into
  coercion explicitly with `@Type()` / `@Transform()`. Implicit conversion
  silently coerces any string to `true`, defeating `@IsBoolean()` on
  request bodies. `forbidNonWhitelisted` also means a request carrying a
  field the DTO doesn't declare (e.g. a client trying to send invoice
  fees) is rejected outright.

- **Raw body for webhooks.** `NestFactory.create` is called with
  `{ rawBody: true }` so `WebhooksController` can verify svix signatures
  against the exact bytes Clerk sent. Removing it breaks webhook auth.

- **Error envelope.** `AllExceptionsFilter` renders every error as
  `{ statusCode, message, error, path, timestamp }`. Statuses ≥ 500 are
  logged with a stack server-side and returned without internals.

- **CORS** (`src/config/cors.config.ts`, called from `main.ts`) pins
  `Access-Control-Allow-Origin` to `FRONTEND_URL` with `credentials: true`.
  The `cors` middleware answers *every* request with that single value, so
  a foreign origin receives `FRONTEND_URL` (never its own origin, never
  `*`) and the browser blocks it. Server-to-server callers send no `Origin`
  and are unaffected.

- **Rate limiting.** `@nestjs/throttler`, in-memory, 100 requests / 60s per
  IP, on every route.

- **Logging.** `nestjs-pino`; `pino-pretty` single-line in development,
  newline-delimited JSON elsewhere. `req.headers.authorization` and
  `req.headers.cookie` are redacted; every HTTP line carries a request id
  and `context: 'HTTP'`.

- **Wallet balance.** `walletBalance()` (`src/common/wallet-balance.ts`) is
  the one signed-sum used by both the business and investor wallet views.
  `deposit` and `repayment` credit a wallet; `withdrawal` and `invested`
  debit it.

- **Emails are lowercased before storage and lookup.** `User.email` and
  `Buyer.contactEmail` are unique and matched case-sensitively by Postgres.

- **The `admin` role has no profile table** (unlike `business` / `buyer` /
  `investor`, which each get a 1:1 profile row from the Clerk webhook).

- **`/admin/overview` on-time repayment rate** compares `Invoice.repaidAt`
  (set in `payInvoice`'s transaction) against `dueDate` at **day
  granularity** (`utcDay()`), not exact timestamp — `dueDate` is a
  calendar date at midnight, so an invoice paid any time on its due date
  counts as on time. The rate is `null` until at least one invoice is
  repaid.

- **R2 storage is presigned-URL only** — the API never proxies file bytes.
  Presigned URLs expire after 600s (`PRESIGN_EXPIRY_SECONDS`): long enough
  to pick and upload a file, short enough that a leaked URL isn't a durable
  capability. `StorageService.createDownloadUrl` exists for admin KYC
  document review but no route consumes it yet.

- **Domain enums** are re-exported from `src/common/enums.ts` — import from
  there, not `src/generated/prisma`.

- **e2e specs set `jest.setTimeout(30_000)`** because cold-starting
  Prisma's query compiler plus a real DB round-trip can exceed Jest's 5s
  default hook timeout under load.

- **`admin.e2e-spec.ts` truncates every table in `beforeAll`** — it
  asserts exact platform-wide aggregates, so it needs an empty slate. This
  relies on `--runInBand` and on the spec running after the others'
  teardown; don't parallelize the e2e suites.

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
