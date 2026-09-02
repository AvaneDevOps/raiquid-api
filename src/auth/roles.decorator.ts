import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../common/enums';

/**
 * Restricts a route (or controller) to the given role(s). Enforced by
 * `RolesGuard`, which runs after `ClerkAuthGuard`.
 *
 *   @Roles('admin')
 *   @Get('overview')
 *   overview() { ... }
 */
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
