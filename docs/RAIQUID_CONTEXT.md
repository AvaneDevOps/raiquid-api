# Raiquid API — context notes

Cross-cutting notes that don't belong in code comments or the README: things
learned from the frontend that affect future backend work.

## Open decisions

- **Investor funding minimum.** The frontend's investor screens enforce a
  hard minimum of ₦5,000 per investment. Nothing in this API enforces it yet.
  When the Investor module (`POST /investor/marketplace/:id/fund`) is
  implemented for real, add `@Min(5000)` to `FundInvoiceDto.amount`.

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
