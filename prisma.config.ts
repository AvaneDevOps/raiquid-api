import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 moved connection config out of schema.prisma and into this file.
 * The Prisma CLI (`prisma migrate`, `prisma studio`, seeding) reads the
 * connection string from here; the app itself connects via a driver adapter
 * in src/prisma/prisma.service.ts.
 *
 * We read `DATABASE_URL` directly (not via prisma's `env()` helper) and fall
 * back to the local docker-compose DSN, so `prisma generate` / `prisma
 * validate` work on a fresh clone that has not created `.env` yet. Commands
 * that actually touch the database still need a real `DATABASE_URL`.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://raiquid:raiquid@localhost:5432/raiquid?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: DATABASE_URL,
  },
});
