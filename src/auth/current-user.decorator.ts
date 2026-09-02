import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth-user.type';

/**
 * Controller param decorator that pulls the authenticated user off the request.
 *
 *   @Get()
 *   list(@CurrentUser() user: AuthUser) { ... }
 *   @Get('me')
 *   me(@CurrentUser('clerkUserId') id: string) { ... }
 *
 * Only meaningful on routes protected by `ClerkAuthGuard`; on `@Public()`
 * routes `request.user` is undefined.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user;
    return data && user ? user[data] : user;
  },
);
