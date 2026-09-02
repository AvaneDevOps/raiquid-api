import type { UserRole } from '../common/enums';

/**
 * The authenticated principal attached to `request.user` by `ClerkAuthGuard`
 * and surfaced in controllers via the `@CurrentUser()` decorator.
 *
 * `role` / `dbUserId` are only populated once the Clerk user has been matched
 * to a local `User` row — until then they may be undefined (e.g. first request
 * after sign-up, before the user is provisioned).
 */
export interface AuthUser {
  /** Clerk user id (`user_...`), i.e. `User.clerkUserId`. */
  clerkUserId: string;
  /** Clerk session id. */
  sessionId: string;
  /** Local `User.id`, once resolved. */
  dbUserId?: string;
  /** Local `User.role`, once resolved. */
  role?: UserRole;
  email?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
