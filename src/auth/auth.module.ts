import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClerkClientProvider } from './clerk.provider';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Wires authentication app-wide:
 *  - `ClerkAuthGuard` is registered as a global `APP_GUARD`, so every route
 *    requires a valid Clerk session unless marked `@Public()`.
 *  - `RolesGuard` runs next and enforces `@Roles(...)`.
 *  - The configured Clerk SDK client is exposed via the `CLERK_CLIENT` token.
 *
 * Global module so `@CurrentUser()` / `@Roles()` work in any feature module
 * without re-importing.
 */
@Global()
@Module({
  providers: [
    ClerkClientProvider,
    // Registered as their own providers (not just inline `useClass` on the
    // APP_GUARD entries) so `overrideProvider(ClerkAuthGuard)` works in e2e
    // tests — Nest gives `useClass`-only APP_GUARD entries a synthetic token
    // that isn't reachable by the guard's own class.
    ClerkAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: ClerkAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [ClerkClientProvider],
})
export class AuthModule {}
