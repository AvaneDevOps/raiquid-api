import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (or whole controller) as not requiring a Clerk session.
 * `ClerkAuthGuard` skips token verification when this metadata is present.
 *
 * Used by the buyer magic-link confirm flow: GET /confirm/:invoiceId and
 * POST /confirm/:invoiceId/review are reached from an emailed link with no
 * logged-in user.
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
