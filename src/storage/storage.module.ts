import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global so any feature module can inject `StorageService` without re-importing.
 * Configuration comes from `ConfigModule` (already global), so nothing to wire
 * here beyond the provider.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
