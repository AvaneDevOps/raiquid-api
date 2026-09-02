import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import type { Request } from 'express';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthUser } from './auth-user.type';

/**
 * Verifies the Clerk session JWT on the `Authorization: Bearer <token>` header
 * and attaches an `AuthUser` to `request.user`.
 *
 * This is real, working code (not a stub): it performs Clerk's networkless
 * token verification via `verifyToken` from `@clerk/backend`. Routes/controllers
 * marked with `@Public()` bypass it entirely — used by the buyer magic-link
 * confirm flow.
 *
 * After verification it does a best-effort lookup of the local `User` row to
 * populate `role` / `dbUserId`; a missing row is not fatal (the user may not be
 * provisioned yet) — `RolesGuard` will reject role-restricted routes.
 */
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let claims: Awaited<ReturnType<typeof verifyToken>>;
    try {
      claims = await verifyToken(token, {
        secretKey: this.config.get('CLERK_SECRET_KEY', { infer: true }),
      });
    } catch (err) {
      this.logger.debug(
        `Token verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid or expired session token');
    }

    const clerkUserId = claims.sub;
    const dbUser = await this.prisma.user.findUnique({
      where: { clerkUserId },
      select: { id: true, role: true, email: true },
    });

    const authUser: AuthUser = {
      clerkUserId,
      sessionId: typeof claims.sid === 'string' ? claims.sid : '',
      dbUserId: dbUser?.id,
      role: dbUser?.role,
      email: dbUser?.email,
    };
    request.user = authUser;

    return true;
  }

  private extractBearerToken(request: Request): string | null {
    const header = request.headers.authorization;
    if (!header) {
      return null;
    }
    const [scheme, value] = header.split(' ');
    return scheme?.toLowerCase() === 'bearer' && value ? value : null;
  }
}
