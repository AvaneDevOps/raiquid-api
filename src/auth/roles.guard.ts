import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UserRole } from '../common/enums';
import { ROLES_KEY } from './roles.decorator';

/**
 * Enforces `@Roles(...)`. Assumes `ClerkAuthGuard` already ran and populated
 * `request.user`. Routes without `@Roles` are unaffected. Used to lock the
 * entire AdminController to the `admin` role.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const role = request.user?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException(
        `Requires one of the following roles: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
