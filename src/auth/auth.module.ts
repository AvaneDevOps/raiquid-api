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
    { provide: APP_GUARD, useClass: ClerkAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [ClerkClientProvider],
})
export class AuthModule {}
