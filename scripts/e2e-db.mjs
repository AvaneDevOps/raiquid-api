// Manage the throwaway Postgres that `npm run test:e2e` runs against.
//
//   node scripts/e2e-db.mjs up     start it (via docker-compose.e2e.yml) and
//                                  apply migrations
//   node scripts/e2e-db.mjs down   stop and remove it, passing -v so nothing
//                                  is left behind
//
// A plain Node script rather than an inline `DATABASE_URL=... npx prisma`
// npm script, because that env-var syntax does not work in cmd.exe on Windows.
import { execSync } from 'node:child_process';

const COMPOSE = 'docker compose -f docker-compose.e2e.yml';

// Must match the default in test/setup-env.ts.
const E2E_DATABASE_URL =
  'postgresql://raiquid:raiquid@127.0.0.1:5544/raiquid?schema=public';

const run = (cmd, extraEnv) =>
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...extraEnv } });

const mode = process.argv[2];

if (mode === 'up') {
  run(`${COMPOSE} up -d --wait`);
  run('npx prisma migrate deploy', { DATABASE_URL: E2E_DATABASE_URL });
} else if (mode === 'down') {
  run(`${COMPOSE} down -v`);
} else {
  console.error('usage: node scripts/e2e-db.mjs <up|down>');
  process.exit(1);
}
