import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ClerkClientProvider } from './clerk.provider';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { RolesGuard } from './roles.guard';

@Global()
@Module({
  providers: [
    ClerkClientProvider,
    ClerkAuthGuard,
    RolesGuard,
    { provide: APP_GUARD, useExisting: ClerkAuthGuard },
    { provide: APP_GUARD, useExisting: RolesGuard },
  ],
  exports: [ClerkClientProvider],
})
export class AuthModule {}
