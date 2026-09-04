import { Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerErrorInterceptor } from 'nestjs-pino';

import { validateEnv, type Env } from './config/env.validation';
import { buildLoggerConfig } from './config/logger.config';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './health/health.module';

import { BusinessModule } from './business/business.module';
import { BuyerModule } from './buyer/buyer.module';
import { InvestorModule } from './investor/investor.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    // --- Config: one zod-validated env schema, available everywhere ---
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // --- Logging: nestjs-pino, pretty in dev / JSON otherwise ---
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerConfig(config.get('NODE_ENV', { infer: true })),
    }),

    // --- Rate limiting: in-memory store, 100 req / 60s per IP ---
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),

    // --- Cross-cutting infrastructure ---
    PrismaModule,
    AuthModule,
    StorageModule,
    EmailModule,
    HealthModule,
    WebhooksModule,

    // --- Feature areas (1:1 with the frontend route groups) ---
    BusinessModule,
    BuyerModule,
    InvestorModule,
    AdminModule,
    NotificationsModule,
  ],
  providers: [
    // Global input validation (DTOs + class-validator)
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        // No implicit conversion: DTOs opt in explicitly with @Type()/@Transform.
        // (Implicit conversion silently coerces e.g. any string to `true`,
        // defeating @IsBoolean on request bodies.)
      }),
    },
    // Consistent JSON error envelope
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Rate-limit every route
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Attach stack traces to pino error logs
    { provide: APP_INTERCEPTOR, useClass: LoggerErrorInterceptor },
  ],
})
export class AppModule {}
