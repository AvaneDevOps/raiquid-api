import type { UserRole } from '../common/enums';

export interface AuthUser {
  clerkUserId: string;
  sessionId: string;
  dbUserId?: string;
  role?: UserRole;
  email?: string;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
  }
}
