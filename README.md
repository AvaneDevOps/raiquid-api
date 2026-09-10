# Raiquid API

NestJS backend for the Raiquid tokenized invoice–financing platform. Handles
everything **not** on-chain: identity, invoices, funding bookkeeping,
notifications, file storage, email. On-chain actions (minting / whitelisting /
transfers / burns on Base Sepolia via Brickken) are a separate service; this
API only **mirrors** their results in the `OnChainEvent` table for the admin
ledger.

## Documentation

| Doc | For |
| --- | --- |
| `/docs` (Swagger, served by the running app) | exact request/response shapes — the field-by-field reference |
| [`docs/FRONTEND_INTEGRATION.md`](docs/FRONTEND_INTEGRATION.md) | frontend developers: how the endpoints fit together into real flows, auth, error handling, known limitations |
| [`docs/RAIQUID_CONTEXT.md`](docs/RAIQUID_CONTEXT.md) | backend-internal reasoning: deferred decisions, gaps, implementation notes |
| this README | running, building, deploying, conventions |

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
| `npm run test:e2e:db:up` / `test:e2e:db:down` | Start / tear down the throwaway e2e Postgres by hand |
| `npm run prisma:migrate`  | `prisma migrate dev`                      |
| `npm run prisma:studio`   | Prisma Studio                             |
| `npm run db:up` / `db:down` | Start/stop the Postgres container       |

### e2e tests

`npm run test:e2e` boots the real `AppModule` against a real Postgres. A
`pretest:e2e` hook runs `scripts/e2e-db.mjs up`, which starts the throwaway
database defined in [`docker-compose.e2e.yml`](docker-compose.e2e.yml)
(`raiquid-e2e-pg`, `localhost:5544`, matching the default `DATABASE_URL` in
`test/setup-env.ts`) and applies migrations with `prisma migrate deploy`. Point
`DATABASE_URL` at a different migrated database via env if you'd rather. The run
overrides `ClerkAuthGuard` and `EmailService` so no real Clerk session or
Resend call is needed. The script runs Jest under `--experimental-vm-modules`:
Prisma 7's driver-adapter query compiler loads itself via a dynamic `import()`,
which Jest only supports with that flag.

The e2e container's data directory is a **tmpfs** (RAM, wiped on stop), and
`npm run test:e2e:db:down` — like every teardown of a throwaway container in
this repo — passes `docker compose down -v`. Never tear an e2e database down
with a bare `docker rm -f` / `docker compose down`: that orphans the data
volume, and enough of those will fill the disk. The container is left running
between test runs on purpose (faster iteration); run `test:e2e:db:down` when
you're finished.

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
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `RESEND_API_KEY`, `BRICKKEN_API_KEY`,
`BRICKKEN_PRIVATE_KEY`, `BRICKKEN_TOKENIZER_EMAIL`, `BRICKKEN_ACCEPTED_COIN`,
`BRICKKEN_ENV` (default `sandbox`), `BRICKKEN_CHAIN_ID` (default `84532`).

> Prisma 7 note: `DATABASE_URL` is **not** read from `schema.prisma` anymore.
> It lives in [`prisma.config.ts`](prisma.config.ts) for the CLI, and the app
> opens its own connection through the `@prisma/adapter-pg` driver adapter in
> [`src/prisma/prisma.service.ts`](src/prisma/prisma.service.ts).

## Docker

[`Dockerfile`](Dockerfile) is a two-stage build (`node:22-slim`): stage one
runs `npm ci` (+ `prisma generate`) and `nest build`; stage two carries only
the pruned production `node_modules`, `dist/`, and `package.json`, and runs as
the non-root `node` user. `CMD` is `node dist/main` (the same as
`npm run start:prod`).

```bash
docker build -t raiquid-api .
docker run --rm -p 3000:3000 --env-file .env raiquid-api
# GET /health -> 200 once the DB in DATABASE_URL is reachable
```

The image runs no migrations — apply them from a machine that has the `prisma`
CLI (`DATABASE_URL=… npx prisma migrate deploy`) before rolling out.

The Prisma generator block in `schema.prisma` pins `moduleFormat = "cjs"` /
`importFileExtension = "js"` so the generated client compiles to runnable
CommonJS even though `prisma generate` runs in the Docker layer before
`tsconfig.json` is copied in.

## Routes

Base paths line up 1:1 with the frontend route groups, so a frontend screen at
`/investor/marketplace` calls `GET /investor/marketplace` here.

### Auth

Every route requires a valid Clerk session (`Authorization: Bearer <token>`),
enforced globally by `ClerkAuthGuard`, **except** routes marked _public_ below.
`AdminController` additionally requires the `admin` role (`RolesGuard`).

CORS is locked to `FRONTEND_URL` (credentialed); every other browser origin is
blocked. See `docs/RAIQUID_CONTEXT.md` → Implementation notes for the details of
this and the other cross-cutting behaviour (validation pipe, rate limiting,
error envelope, logging).

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
| POST   | `/investor/wallet/deposit`        | `/investor/wallet` (Deposit — adds simulated sandbox funds) |
| GET    | `/investor/settings`              | `/investor/settings`             |
| PATCH  | `/investor/settings`              | `/investor/settings`             |

### Admin — frontend `/admin/*` (operator dashboard, `admin` role only)

| Method | Path                | Frontend screen      |
| ------ | ------------------- | -------------------- |
| GET    | `/admin/overview`   | `/admin/overview`    |
| GET    | `/admin/reserve`    | `/admin/reserve`     |
| GET    | `/admin/provenance` | `/admin/provenance`  |
| GET    | `/admin/ledger`     | `/admin/ledger` (reads the `OnChainEvent` mirror table) |
| GET    | `/admin/whitelisting` | `/admin/whitelisting` review queue (investors not yet whitelisted, with KYC docs) |
| POST   | `/admin/whitelisting/:investorId/decision` | approve / reject an investor whitelisting (`{ approve, note? }`) |

### Notifications

| Method | Path             | Frontend screen                  |
| ------ | ---------------- | -------------------------------- |
| GET    | `/notifications` | notifications tray (all layouts) |
| PATCH  | `/notifications/:id/read` | tray (mark one read — idempotent) |

`GET /notifications` returns the caller's own rows newest-first, paginated
(`page`, `pageSize`, `unreadOnly`), plus a top-level `unreadCount`. `PATCH
/notifications/:id/read` marks one read (404 if it isn't the caller's; a
second call is a no-op). Rows are written by domain events — no endpoint
creates them directly:

| Event | Recipient | Tone |
| ----- | --------- | ---- |
| Buyer accepts an invoice (`POST /confirm/:id/review`) | invoice's business owner | positive |
| Buyer disputes an invoice | invoice's business owner | warning |
| Invoice becomes fully funded (`POST /investor/marketplace/:id/fund`) | invoice's business owner | positive |
| Invoice repaid (`POST /buyer/invoices/:id/pay`) | every investor holding a stake | positive |
| Whitelisting approved / rejected (`POST /admin/whitelisting/:id/decision`) | the investor | positive / warning |

Each notification is written in the same transaction as the state change that
triggered it. The matching email (where one exists) stays best-effort — a
failed send is logged, not rolled back.

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
- **Source comments are TODO / FIXME / placeholder markers only** — a
  single-line `//` for unimplemented or deferred work, nothing else. No
  explanatory `/** */` blocks or prose `//` comments. The reasoning a comment
  would carry — a business rule, an edge case, a why, an assumption, a
  deferred decision — belongs in `docs/RAIQUID_CONTEXT.md` (Open Decisions
  for a gap, Implementation notes for a behavioural detail) or the README.
  Move it there first, then delete it from the code; rename anything the
  comment was propping up so the code reads on its own. Swagger decorator
  text (`@ApiProperty` / `@ApiOperation` descriptions) is API content, not a
  comment — it stays.
- **Keep `.env.example` in sync** with the zod schema in
  `src/config/env.validation.ts`.

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
