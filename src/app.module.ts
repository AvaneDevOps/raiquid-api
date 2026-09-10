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
import { BrickkenModule } from './brickken/brickken.module';
import { HealthModule } from './health/health.module';

import { BusinessModule } from './business/business.module';
import { BuyerModule } from './buyer/buyer.module';
import { InvestorModule } from './investor/investor.module';
import { AdminModule } from './admin/admin.module';
import { NotificationsModule } from './notifications/notifications.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerConfig(config.get('NODE_ENV', { infer: true })),
    }),

    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    }),

    PrismaModule,
    AuthModule,
    StorageModule,
    EmailModule,
    BrickkenModule,
    HealthModule,
    WebhooksModule,

    BusinessModule,
    BuyerModule,
    InvestorModule,
    AdminModule,
    NotificationsModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggerErrorInterceptor },
  ],
})
export class AppModule {}
