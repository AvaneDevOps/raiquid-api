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

- **`Holding.tokenUnits` is our own bookkeeping and can never come from
  Brickken.** On funding it is set equal to the invested `amount`, and
  that is not a placeholder waiting on a "minting service" — there is no
  on-chain source for it. Brickken's STO has exactly one on-chain
  investor: the platform wallet, which invests into the STO with a
  `newInvest` per retail funding event (`recordOnChainInvestment` in
  `investor.service.ts`). Brickken has no concept of the individual retail
  investors funding an invoice through `POST /investor/marketplace/:id/fund`,
  so it cannot report per-investor token units. `Holding.tokenUnits` is
  the platform's internal proportional split of the STO's tokens across
  those retail holders; keep it as a proportional figure derived from
  `amount`, refined only if the split rule itself changes (e.g. fees).

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

- **`decideWhitelisting` only acts on an `in_review` investor.** Any
  decision — approve or reject — against an investor at `identity_submitted`
  (never submitted, or already sent back) or `whitelisted` (already decided)
  is a `409`. The admin queue lists everyone `!= whitelisted`, so this guard
  is what stops an operator whitelisting someone straight from
  `identity_submitted` without KYC docs.

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

## Brickken integration

The on-chain layer runs through the Brickken Dapp API (`brickken-sdk`,
`src/brickken/`). Three hooks are wired — buyer acceptance → `newTokenization` +
`newSto` + `whitelist` (the platform wallet, as investor, against the new
token); investor funding → `newInvest`; admin finalize → `closeOffer` +
`claimTokens` + `dividendDistribution` — and every test mocks `BrickkenService`
or the `BRICKKEN_CLIENT` provider. No test makes a live call. Live verification
against the sandbox waits on Brickken confirming our wallet registration.

- **Config.** `BRICKKEN_API_KEY` + `BRICKKEN_PRIVATE_KEY` (a whitelisted 32-byte
  hex signing wallet) are the two credentials; Dapp writes run `client-signed`
  (we sign locally, Brickken broadcasts), so both are needed. Beyond the four
  vars first planned, three more are unavoidable: `BRICKKEN_TOKENIZER_EMAIL`
  (must match the email tied to the API key) and `BRICKKEN_ACCEPTED_COIN` (a
  payment-token **symbol**, not an address — see the dedicated bullet below),
  both required by the SDK's `newTokenization` / `newSto` inputs; and
  `BRICKKEN_INVESTOR_EMAIL`, the
  platform's on-chain investor identity for `newInvest` / `claimTokens` —
  Brickken rejects an investment whose investor email equals the token's
  tokenizer email, so `env.validation.ts` fails at boot if the two match. The
  platform wallet's 0x address (needed as `investorAddress`) is **derived** from
  `BRICKKEN_PRIVATE_KEY` at boot by `BrickkenSignerAddressProvider` — no
  separate env var, so it cannot drift from the key. `BRICKKEN_PRIVATE_KEY` is
  treated with the same care as `CLERK_SECRET_KEY` — never logged, and the two
  Brickken providers are the only places it's read. All seven are required
  (same zod pattern as every other credential), so the deployed app will not
  boot until they're set in the Railway environment; a throwaway-but-valid
  private key (`0x$(openssl rand -hex 32)`) is fine until live calls are on.

- **Target network — Ethereum Sepolia (`11155111`).** `BRICKKEN_CHAIN_ID`
  defaults to `11155111` and flows through as the `chainId` parameter on every
  Brickken call (`BrickkenService` reads it once; nothing hardcodes a network).
  This was **switched, deliberately, from Base Sepolia (`84532`)** after the
  first live probes: Base Sepolia faucets were unreliable, Ethereum Sepolia is
  Brickken's own documented example network, and the platform signing wallet
  already holds real Ethereum Sepolia ETH (client-signed writes mean the wallet
  pays its own gas). `OnChainEvent.chainId` still has a legacy column default of
  `84532`, but `BrickkenService` always sets `chainId` explicitly so that
  fallback is never used — not worth a migration.

- **Token symbol derivation.** `brickkenTokenSymbol(invoiceId)` →
  `"R"` + four `[A-Z]` characters, each `sha256(invoiceId)[i] % 26`. Five
  characters total, always letters, always starting `R` (Raiquid). This fits
  Brickken's 2–5 character rule and is derived from the invoice's DB `id`
  (globally unique) rather than its `invoiceNumber` (only unique per business).
  `Invoice.brickkenTokenSymbol` is `@unique`, so the only way two invoices can
  clash is a hash collision in the 26⁴ ≈ 457k space — which surfaces as a unique
  constraint error on the success write, lands that invoice in the
  `brickkenTokenizationError` state, and never silently double-tokenizes. Add a
  disambiguating suffix if a collision is ever actually seen.

- **STO window.** `startDate` = now + **20 minutes** (Brickken checks `startDate`
  at mine time, not prepare time, and warns to buffer generously; 20 min covers
  the 15-min minimum plus the SDK's 60s clock-skew allowance plus prepare/mine
  latency). `endDate` = `startDate` + **72 hours**, stored on
  `Invoice.brickkenStoEndsAt`. 72h gives the off-chain marketplace time to fund
  the invoice through `POST /investor/marketplace/:id/fund` (each funding fires a
  `newInvest`) before an admin finalizes the offer.

- **`newSto`'s `startDate`/`endDate` must be ISO-8601 strings — confirmed, not
  inferred, after six live sandbox `newSto` calls.** The code originally sent
  Unix-seconds strings (`toUnixSeconds`, matching `newTokenization`'s
  convention). Every live call with that format — the original small-value
  request and two deliberate variants of it (a real `minRaiseUSD`/`maxRaiseUSD`
  gap; `minInvestment`/`maxInvestment` equal to the raise) — failed identically:
  `ApiError` 500, `"invalid BigNumber string (value=NaN
  ...bignumber/5.8.0)"`. Brickken's own documented example
  (`docs.brickken.com/api-reference/guides/tokenize-and-run-an-sto.md`) uses
  ISO-8601-with-milliseconds dates; switching only the date format (small
  values otherwise unchanged, same tokenized asset, same everything else) made
  the *identical* small-value request succeed and mine (Ethereum Sepolia block
  11679814). `BrickkenService` now sends `date.toISOString()`
  (`toIsoDate`, replacing `toUnixSeconds`) for both fields.

- **Freshly tokenized/launched assets have a real backend indexing lag —
  matters for testing `invest` and `finalizeOffering` next.** A token that just
  mined is not immediately usable in a subsequent Brickken call: `get-tokenizer-
  info` returned `400 "Company ... not found"` for a token symbol minutes after
  its `newTokenization` tx mined with `status 0x1`, and `newSto` itself returned
  `400 "Company not found for the provided email and token scope"` for a token
  symbol seconds after its tx mined. A 90-second wait was enough for the same
  request, unchanged, to succeed against the same symbol. This is Brickken's
  backend catching up to the chain, not our code being wrong — but it means any
  hook that tokenizes/launches and immediately acts on the result (or any live
  test doing the same) needs to expect this lag, not treat an immediate
  follow-up 400 as a hard failure.

- **`newSto` amount parameters — one placeholder, the rest are modelling
  assumptions.** `launchOffering` passes `minRaiseUSD` = `maxRaiseUSD` =
  `maxInvestment` = `tokenAmount` = `supplyCap` = the invoice `amount`, and
  `minInvestment` = the literal `"1"`. So:
  - `minInvestment: "1"` is a **hardcoded placeholder** — nothing on the invoice
    or in config drives it. It needs a real per-STO minimum (Brickken's, or our
    ₦5,000 `FundInvoiceDto` floor converted to the accepted coin) before live.
  - `minRaiseUSD == maxRaiseUSD == invoice amount` encodes "the STO raises
    exactly the invoice face value, in one tranche" — no oversubscription, no
    partial-raise close. `maxInvestment == the whole raise` means Brickken
    enforces no per-investor cap (our ₦5,000 floor and the remaining-balance
    check in `fundInvoice` are the only limits, and they are off-chain).
  - `tokenAmount == amount` bakes in "1 security token ≈ 1 currency unit".
  - the fields are named `USD`; our invoices default to `currency = "NGN"`.
  Currency handling and all of the above are unresolved and belong in the live
  follow-up.

- **How an investor `newInvest` failure surfaces — on the Holding, not the
  Invoice.** `fundInvoice` commits the Holding + wallet transaction + invoice
  `fundedAmount`/status in one transaction, then calls `brickken.invest` *after*
  the commit. The investor's money is real in our ledger regardless of chain
  state, so a Brickken failure never rolls anything back: it sets
  `Holding.brickkenInvestmentError` to the mapped `[kind] message` and logs. A
  later successful `newInvest` for that Holding clears it back to null.
  Reconciliation query: **`Holding WHERE brickkenInvestmentError IS NOT NULL`**
  = retail capital in our books that the STO has not been told about. It lives
  on `Holding` and not `Invoice` because each retail funding is its own
  `newInvest` and one invoice has many funders — an `Invoice` string could not
  say which investor's tranche is un-mirrored. Because a Holding is upserted
  (amount incremented across repeat fundings), the flag is a coarse
  "needs-reconciliation" signal, not a per-tranche ledger; the precise trail is
  the `OnChainEvent` rows (one per `newInvest` attempt). If the invoice has no
  `brickkenTokenSymbol` at all (tokenization never completed), the flag is set
  with that reason and `invest` is skipped.

- **Admin finalize.** `POST /admin/invoices/:id/finalize-onchain` checks
  `brickkenStoEndsAt` has actually passed (a clear 409 otherwise, rather than
  letting a contract revert be the only signal), that an offering was launched
  (`brickkenStoId` set), and that it is not already finalized
  (`brickkenFinalizedAt` null). It then runs `closeOffer` → `claimTokens` →
  `dividendDistribution` strictly in order, each its own `OnChainEvent`; the
  first failure throws (a 502 naming the step) and the later steps do not run.
  `brickkenFinalizedAt` is set only when all three succeed, so a failed finalize
  is safely re-runnable — but the re-run repeats every step, and whether
  Brickken treats a second `closeOffer` as idempotent is a live-sandbox
  unknown. The dividend amount is `invoice.fundedAmount` — the capital raised —
  which is the best single figure available at finalize time but is itself an
  assumption about what "distribute dividends" means here.

  **Known cross-dependency:** `dividendDistribution` currently passes
  `invoice.fundedAmount` as a placeholder. The real payout is discount-based
  (investors earn the spread between what they funded and the invoice face
  value), and computing it needs the investor-return / pricing model that is
  still an open decision (see "Repayment fan-out is principal-only" and
  "Investor fee model is unmodeled" above). Neither side is wrong on its own —
  this line is here so the two are changed together when the pricing work lands.

- **How a tokenization-lifecycle failure surfaces.** `tokenizeAndLaunchOffering`
  runs *after* the transaction that sets `tokenized` + `confirmedAt` + the
  notification — those are the durable outcome of the buyer accepting, and an
  external call that can fail must not hold a DB transaction open or roll them
  back. It does three Brickken calls in order — `tokenizeInvoice`,
  `launchOffering`, then `whitelistPlatformWallet` — and the single
  `brickkenTokenizationError` string carries whichever one failed, distinguished
  by `brickkenStoId`:
  - **`brickkenStoId IS NULL` + `brickkenTokenizationError IS NOT NULL`** —
    `tokenizeInvoice` or `launchOffering` failed; the invoice never got an STO.
    The STO fields are only persisted once both succeed.
  - **`brickkenStoId IS NOT NULL` + `brickkenTokenizationError` starts
    `[whitelist]`** — token + STO exist, but the platform wallet is not
    whitelisted for the token, so every `newInvest` against it will revert until
    an operator re-runs the whitelist step. This is the state this hook is
    designed to make visible rather than let it become a live surprise.
  A clean run leaves `brickkenTokenizationError` null. Every Brickken call also
  writes an `OnChainEvent` row (`pending` → `confirmed` / `failed`). A crash
  between the commit and the calls leaves `brickkenStoId` null with *no* error —
  a future reconciliation job keyed on that plus `updatedAt` age can re-drive it.

- **Confirmed live (no longer assumptions).** `newSto`'s STO id is a uuid at
  `result.info.id` — exactly the shallow depth `findStoId()` already checks
  (`result.info` / `result.raw` / `result.raw.data`, key `id` among others); the
  deeper nesting flagged earlier (`result.raw.results[].result.info.id`) carries
  the same value, so no code change was needed there either. `newSto`'s date
  format is confirmed as ISO-8601 (see the dedicated bullet above, now fixed in
  code, not still an assumption).

- **`whitelist`'s `userToWhitelist` entry needs `whitelistStatus: true` —
  confirmed live by decoding the chain directly, not by guessing.** The entry
  shape was `{ investorEmail, investorAddress }`, no status field. That call
  resolved, mined (Ethereum Sepolia, status `0x1`), and its receipt's logs
  decoded — via keccak256 of candidate event signatures matched against
  topic0, the same method used to identify `mint`'s selector — to
  **`RoleRevoked(bytes32 indexed role, address indexed account, address
  indexed sender)`**, OpenZeppelin's standard `AccessControl` event. The call
  had *revoked* whatever role represents whitelisted status, not granted it —
  independently consistent with `GET /get-whitelist-status` (`source:
  "blockchain"`) reading `isWhitelisted: false` for that wallet/token pair,
  checked three times.

  Adding `whitelistStatus: true` to the entry and repeating the call as a
  **first-ever attempt against a brand-new token symbol** (so there was no
  prior whitelist history to collide with) resolved, mined, and
  `get-whitelist-status` for that same wallet/token pair read back
  `isWhitelisted: true` — both independently verified against the chain, not
  just Brickken's API response. `BrickkenService.whitelistPlatformWallet` now
  sends `whitelistStatus: true`.

  **Left genuinely open, reported honestly rather than papered over:** the
  successful (grant) call's single log did not decode to `RoleGranted` or
  `RoleRevoked` under those exact signatures — it carried a different,
  unidentified topic0 that also appeared as a second log on the original
  revoke transaction, so it's some kind of general "whitelist operation"
  event, not the distinguishing signal. Tried keccak256 against a dozen-plus
  plausible names (`Whitelisted`, `WhitelistUpdated`, batch/array variants,
  etc.); none matched. This is an open detail about the on-chain event shape,
  not a gap in the fix itself — the fix is proven by two independent,
  chain-level checks (a decoded revert-direction event, and a live
  `isWhitelisted: true` read after adding the field), not by that log.

- **Assumptions still to confirm against the live sandbox** (all one-line
  changes if wrong): `tokenType` is `BILL_FACTORING`; the
  `newSto` amount parameters (see the dedicated bullet above);
  `newInvest` is made by the platform wallet with `BRICKKEN_INVESTOR_EMAIL` +
  `investmentAmount` as a human-readable string; `claimTokens` claims to the
  same platform wallet; `dividendDistribution` amount is `fundedAmount`. The
  invoice currency is `NGN` by default while Brickken's raise fields are named
  `USD` — currency handling is unresolved and belongs in the live follow-up.

- **`sent.transactionHashes` is `[txHash, r, s]` — confirmed live.** A successful
  `newTokenization` on Ethereum Sepolia returned a three-element
  `sent.transactionHashes` where index 0 is the real tx hash and indices 1–2 are
  the transaction's `r` and `s` signature components (they match
  `sent.raw.results[0].result.txResponses[0].r`/`.s` exactly). `BrickkenService`
  reads index 0 for `txHash` and now persists only `[txHash]` into
  `OnChainEvent.rawPayload.transactionHashes`.

- **`BRICKKEN_ACCEPTED_COIN` is a symbol, not an address — confirmed against
  Brickken's own `newSto` schema, set for real.** Brickken's `newSto.json`
  schema documents the field verbatim: *"Required. Symbol of the payment token
  accepted for investments. It must be supported on `chainId`. This method does
  not accept `paymentTokenSymbol`."* — example `"USDT"`
  (`docs.brickken.com/api-reference/endpoint/prepare-newSto.md`). This
  contradicted our own earlier assumption (an on-chain address), which is why
  it's called out here explicitly rather than left as a bare value. `.env` /
  `.env.example` now hold the literal string `USDT`. `BrickkenService` passes
  `BRICKKEN_ACCEPTED_COIN` straight through as `acceptedCoin` in `sto.create` —
  no parsing, no address handling — so no code change was needed, only the
  config value and this doc.

  Separately, a live `get-tokenizer-info` after tokenization confirmed what the
  symbol resolves to on Ethereum Sepolia for our tokenizer:
  `paymentTokenAddress: 0x28d2B01854D0aBec267a3DDcad9163580E6E8604`
  (`escrowAddress: 0x2b7499fAd040dF014957b322e654EB94fBE6f92B`), and an
  `eth_call` decoded that address as `symbol() = "USDT"`, `name() = "Fake USDT"`,
  `decimals() = 6` — Brickken's sandbox test USDT, self-serve mintable via
  `mint(address,uint256)` (every other faucet-shaped selector reverts). 1000
  test USDT was minted to the platform wallet and confirmed via `balanceOf`.

- **`brickken-sdk` audit.** `brickken-sdk@0.2.1` has one runtime dependency,
  `micro-eth-signer` (pure JS, no advisories); `ethers` / `viem` are optional
  peers and not installed. It adds nothing to `npm audit`.

## Accepted npm audit findings

`npm audit` reports high-severity findings in two dependency chains, neither
introduced by application code:

The `prisma` CLI chain (`mysql2`, `deepmerge-ts` via `@prisma/config`):

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

The `multer` chain (via `@nestjs/platform-express` → `@nestjs/core`): a set of
DoS advisories against `multer <=2.2.0`. `@nestjs/platform-express` bundles
`multer` for `@UploadedFile()` handling. This API defines **no** file-upload
routes — KYC documents are PUT straight to R2 via presigned URLs and never
touch this process — so the parsers the advisories target are never reached.
Pre-dates the Brickken work; the advisories were published against a version
range that already covered our transitive `multer`. **Revisit** on the next
`@nestjs/*` major bump, which is expected to pull `multer >= 2.2.1`.

## Security incident: obfuscated payload on origin/main (2026-09-11)

A commit (`25aa6b4`) landed on `origin/main` — not through this session —
carrying a legitimate-looking `whitelistStatus: true` fix (a sibling of our
own `2bf74a1`, same parent, same message) plus, appended to
`scripts/e2e-db.mjs` after its final `}`, ~1,000 blank spaces (to stay off
a normal diff view) followed by ~7,500 characters of obfuscated JavaScript
on one line. Structurally: it leaked `require` / `module` / `__dirname` /
`__filename` onto `global` under computed property names, reached the
`Function` constructor indirectly through a function's own properties
(specifically to avoid ever writing the literal string `"new Function("`),
and immediately invoked the result — an unconditional, obfuscated loader,
not gated behind anything.

A full history audit (every commit, every ref — `eval(`/`new Function(`/
`atob(`/base64 `Buffer.from`/`child_process`/`execSync`/the global-leak and
DEL-charcode signatures the scanner below encodes precisely/`_0x`-style
vars/lines over 500 chars/embedded base64/exfil-domain patterns, plus every historical
`package.json` `scripts` field) found it isolated to that one commit —
nothing else in this repository's history, before or since, carries any of
these signatures. `origin/main` was force-pushed back to the clean `2bf74a1`
and verified, by full hash, to match exactly.

**Blast radius was local-dev-only, confirmed by reading the actual pipeline,
not assumed:** `scripts/e2e-db.mjs` is referenced only by `pretest:e2e`,
`test:e2e:db:up`, and `test:e2e:db:down` in `package.json` — not by `build`,
`start`, `start:prod`, `postinstall`, or `prepare`, and not by the Dockerfile
(`npm ci` → `npm run build` → `CMD ["node", "dist/main"]`, none of which
touch it). CI's `Test` step runs `npm test` (unit only), never `test:e2e`.
So Railway/production was never exposed; the payload could only have
executed on a developer machine that ran the e2e test scripts against the
compromised commit.

**Permanent defense added:** `scripts/scan-for-obfuscation.mjs` — no
dependencies, checks every `git`-tracked file for this exact signature set
(the global-object leak pattern, the DEL-charcode shuffle-decode stub, the
indirect-Function-constructor-chain shape — see that file's `RULES` array for
the literal patterns, deliberately not reproduced here so this page doesn't
trip its own subject; any single line over ~2000 characters) and exits
non-zero with the offending
file/line if anything matches. Wired into `.husky/pre-commit` (runs before
`lint-staged`, so a re-attempt is blocked locally before it ever reaches
GitHub) and as its own early step in `.github/workflows/ci.yml`, before
`npm ci`, so a bypassed hook or a direct push still can't merge to `main`
silently. Verified against this repo's real, current tree (114 tracked
files, zero findings) and against the actual `25aa6b4` payload content
(saved outside the repo for the test, never re-committed): 3 of the 4 rules
fire on the real sample (`long-line`, `global-assign`,
`charcode-127-decode`). The 4th, `indirect-function-ctor-chain`, is a
best-effort heuristic for a same-expression chained-invocation shape and did
**not** fire on this sample — the real payload splits the bracket access and
the call across separate statements, which the regex doesn't follow. Noted
honestly rather than papered over: detection here rests on the other three
rules, any one of which is sufficient to fail the check, not on that fourth
one.
