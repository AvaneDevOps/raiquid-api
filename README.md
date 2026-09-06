# Raiquid API

NestJS backend for the Raiquid tokenized invoice–financing platform. Handles
everything **not** on-chain: identity, invoices, funding bookkeeping,
notifications, file storage, email. On-chain actions (minting / whitelisting /
transfers / burns on Base Sepolia via Brickken) are a separate service; this
API only **mirrors** their results in the `OnChainEvent` table for the admin
ledger.

> Status: project scaffold. Controllers/services are wired but their bodies are
> stubs (`NotImplementedException`) — the Prisma schema, the DTOs, and all
> infra wiring are real.

## Tech stack

| Concern        | Choice                                             |
| -------------- | -------------------------------------------------- |
| Framework      | NestJS 11, TypeScript strict, Node 22              |
| Database       | PostgreSQL + Prisma 7 (`prisma-client` generator)  |
| Auth           | Clerk (`@clerk/backend` + a custom NestJS guard)   |
| Validation     | class-validator / class-transformer + ValidationPipe |
| API docs       | `@nestjs/swagger` at `/docs`                       |
| Config         | `@nestjs/config` + zod-validated env schema        |
| Logging        | `nestjs-pino`                                      |
| Health         | `@nestjs/terminus` at `/health`                    |
| Rate limiting  | `@nestjs/throttler` (in-memory)                    |
| File storage   | Cloudflare R2 via `@aws-sdk/client-s3`             |
| Email          | Resend                                             |
| Git hooks      | Husky + lint-staged + commitlint                   |

## Quick start

```bash
# 1. Node version (matches .nvmrc)
nvm use

# 2. Start Postgres
docker compose up -d

# 3. Install deps (postinstall runs `prisma generate`)
npm install

# 4. Configure environment
cp .env.example .env      # then edit values

# 5. Create the database schema
npx prisma migrate dev --name init

# 6. Run the API
npm run start:dev
```

- API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs`
- Health: `http://localhost:3000/health`

### Useful scripts

| Script                    | What it does                              |
| ------------------------- | ----------------------------------------- |
| `npm run start:dev`       | Watch-mode dev server                     |
| `npm run build`           | Compile to `dist/`                        |
| `npm run lint`            | ESLint (`--fix`)                          |
| `npm test`                | Jest unit tests                           |
| `npm run test:e2e`        | Jest e2e tests against a real Postgres (see below) |
| `npm run prisma:migrate`  | `prisma migrate dev`                      |
| `npm run prisma:studio`   | Prisma Studio                             |
| `npm run db:up` / `db:down` | Start/stop the Postgres container       |

### e2e tests

`npm run test:e2e` boots the real `AppModule` against a real Postgres — point
`DATABASE_URL` at a migrated database (the default in `test/setup-env.ts` is a
throwaway container on `localhost:5544`, override it via env if you use a
different one). It overrides `ClerkAuthGuard` and `EmailService` so no real
Clerk session or Resend call is needed. The script runs Jest under
`--experimental-vm-modules`: Prisma 7's driver-adapter query compiler loads
itself via a dynamic `import()`, which Jest only supports with that flag.

The script also passes `--runInBand`. Every spec generates unique fixture
ids per run (`randomUUID()`), so parallel workers won't collide on
`User.clerkUserId` / `User.email` — but these suites all hammer one shared
Postgres, and serial execution keeps table-level contention and interleaving
out of the picture, which matters more for a DB integration suite than the
~2s parallelism would save.

## Environment variables

Validated at boot by [`src/config/env.validation.ts`](src/config/env.validation.ts);
the process exits if any is missing or malformed. See
[`.env.example`](.env.example).

`NODE_ENV`, `PORT`, `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
`CLERK_WEBHOOK_SECRET`, `FRONTEND_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `RESEND_API_KEY`.

> Prisma 7 note: `DATABASE_URL` is **not** read from `schema.prisma` anymore.
> It lives in [`prisma.config.ts`](prisma.config.ts) for the CLI, and the app
> opens its own connection through the `@prisma/adapter-pg` driver adapter in
> [`src/prisma/prisma.service.ts`](src/prisma/prisma.service.ts).

## Routes

Base paths line up 1:1 with the frontend route groups, so a frontend screen at
`/investor/marketplace` calls `GET /investor/marketplace` here.

### Auth

Every route requires a valid Clerk session (`Authorization: Bearer <token>`),
enforced globally by `ClerkAuthGuard`, **except** routes marked _public_ below.
`AdminController` additionally requires the `admin` role (`RolesGuard`).

### Cross-cutting

| Method | Path       | Auth   | Frontend / purpose                          |
| ------ | ---------- | ------ | ------------------------------------------- |
| GET    | `/health`  | public | Uptime/readiness probe (checks DB)          |
| GET    | `/docs`    | public | Swagger UI                                  |
| POST   | `/webhooks/clerk` | public (svix-signed) | Provisions a local `User` (+ profile row) on Clerk `user.created` |

### Business — frontend `/business/*` (supplier dashboard)

| Method | Path                       | Frontend screen                         |
| ------ | -------------------------- | --------------------------------------- |
| GET    | `/business/invoices`       | `/business/invoices` (list)             |
| POST   | `/business/invoices`       | `/business/invoices` (submit invoice)   |
| GET    | `/business/invoices/:id`   | `/business/invoices/[id]` (detail)      |
| GET    | `/business/wallet`         | `/business/wallet`                      |
| GET    | `/business/settings`       | `/business/settings`                    |
| PATCH  | `/business/settings`       | `/business/settings`                    |

### Buyer — frontend `/buyer/*` (debtor dashboard) + public confirm flow

| Method | Path                         | Auth   | Frontend screen                          |
| ------ | ---------------------------- | ------ | --------------------------------------- |
| GET    | `/buyer/invoices`            | Clerk  | `/buyer/invoices`                       |
| GET    | `/buyer/payment-schedule`    | Clerk  | `/buyer/payment-schedule`              |
| POST   | `/buyer/invoices/:id/pay`    | Clerk  | `/buyer/payment-schedule` (pay action)  |
| GET    | `/buyer/settings`            | Clerk  | `/buyer/settings`                       |
| PATCH  | `/buyer/settings`            | Clerk  | `/buyer/settings`                       |
| GET    | `/confirm/:invoiceId`        | public | `/confirm/[invoiceId]` (magic link)     |
| POST   | `/confirm/:invoiceId/review` | public | `/confirm/[invoiceId]` (accept/dispute) |

The `/confirm/*` routes are reached from an emailed magic link with no logged-in
user, matching the frontend's standalone confirm page. `:invoiceId` carries an
opaque confirm token.

### Investor — frontend `/investor/*` (funder dashboard)

| Method | Path                              | Frontend screen                    |
| ------ | --------------------------------- | ---------------------------------- |
| GET    | `/investor/marketplace`           | `/investor/marketplace`            |
| GET    | `/investor/marketplace/:id`       | `/investor/marketplace/[id]`       |
| POST   | `/investor/marketplace/:id/fund`  | `/investor/marketplace/[id]` (fund)|
| GET    | `/investor/portfolio`             | `/investor/portfolio`             |
| GET    | `/investor/portfolio/:id`         | `/investor/portfolio/[id]`        |
| GET    | `/investor/whitelisting`          | `/investor/whitelisting`          |
| POST   | `/investor/whitelisting`          | `/investor/whitelisting` (submit)  |
| GET    | `/investor/wallet`                | `/investor/wallet`               |
| GET    | `/investor/settings`              | `/investor/settings`             |
| PATCH  | `/investor/settings`              | `/investor/settings`             |

### Admin — frontend `/admin/*` (operator dashboard, `admin` role only)

| Method | Path                | Frontend screen      |
| ------ | ------------------- | -------------------- |
| GET    | `/admin/overview`   | `/admin/overview`    |
| GET    | `/admin/reserve`    | `/admin/reserve`     |
| GET    | `/admin/provenance` | `/admin/provenance`  |
| GET    | `/admin/ledger`     | `/admin/ledger` (reads the `OnChainEvent` mirror table) |

### Notifications

| Method | Path             | Frontend screen                  |
| ------ | ---------------- | -------------------------------- |
| GET    | `/notifications` | notifications tray (all layouts) |

## Conventions

- **No dead DTO fields.** A request-DTO field that no service method actually
  reads gets *fixed or removed* before merge — never left in with a comment.
  Swagger publishes every DTO field at `/docs`, and a frontend developer has
  no way to tell a real field from a placeholder one, so a field that can't
  do anything yet must not be in the public contract. Either wire it up in
  the same change, or drop it and reintroduce it alongside the code that
  makes it functional.
- **Commit scopes** are area-based and enforced by commitlint — see
  `commitlint.config.js`.

## Git hooks

This repo uses [Husky](https://typicode.github.io/husky/) to run checks
automatically around `git commit`. On `npm install`, the `prepare` script runs
`husky`, which sets git's `core.hooksPath` to `.husky/_`. That directory holds
tiny generated wrappers (one per hook name) that each invoke the matching
hand-written script at `.husky/<hook>`. Net effect: the scripts below run as
git hooks, and nothing is installed outside the repo.

| Hook                 | Runs                                | Why                                                                 |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| `.husky/pre-commit`  | `npx lint-staged`                   | ESLint `--fix` + Prettier on **staged** `.ts` files only; blocks the commit if an unfixable lint error remains. |
| `.husky/commit-msg`  | `npx --no -- commitlint --edit "$1"`| Rejects commit messages that don't follow Conventional Commits with an allowed scope (see `commitlint.config.js`). |

Allowed commit scopes: `business`, `buyer`, `investor`, `admin`, `auth`,
`prisma`, `infra`, `docs`, `deps`. Example: `feat(investor): add marketplace filter`.

### Bypassing hooks in an emergency

`git commit --no-verify` (alias `-n`) skips **all** local hooks. This is a
genuine-emergency escape hatch only — CI (`.github/workflows/ci.yml`) re-runs
lint, build, test, and commitlint independently, so a bypassed commit still has
to pass there before it can merge.

To disable Husky for a shell session: `export HUSKY=0` (the wrappers in
`.husky/_` check this and exit early). To undo Husky's setup completely:
`git config --unset core.hooksPath` — that's the entire mechanism, just
repointing where git looks for hook scripts.
