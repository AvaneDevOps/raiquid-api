import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Webhook } from 'svix';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { UserRole } from '../common/enums';
import { isUniqueConstraintError } from '../common/prisma-errors';
import type { ClerkUserData, ClerkWebhookEvent } from './clerk-webhook.types';

function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (Object.values(UserRole) as string[]).includes(value)
  );
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly webhook: Webhook;

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.webhook = new Webhook(
      config.get('CLERK_WEBHOOK_SECRET', { infer: true }),
    );
  }

  async handleClerkWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<{ received: true }> {
    let event: ClerkWebhookEvent;
    try {
      event = this.webhook.verify(rawBody, headers) as ClerkWebhookEvent;
    } catch (err) {
      this.logger.warn(
        `Rejected webhook with bad signature: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'user.created':
        await this.provisionUser(event.data);
        break;
      case 'user.updated':
        // TODO: sync email/name changes onto the local User row.
        break;
      case 'user.deleted':
        // TODO: decide soft- vs hard-delete of the User + profile row.
        break;
      default:
        this.logger.debug(`Ignoring unhandled Clerk event: ${event.type}`);
    }

    return { received: true };
  }

  private async provisionUser(data: ClerkUserData): Promise<void> {
    // Clerk's client-side `signUp` can only write `unsafe_metadata` directly;
    // setting `public_metadata` requires a backend call with the secret key.
    // The frontend's real Clerk integration isn't wired up yet, so this is an
    // assumption to verify once it is — check public_metadata first in case
    // the role ends up being set server-side instead.
    const rawRole = data.public_metadata?.role ?? data.unsafe_metadata?.role;
    if (!isUserRole(rawRole)) {
      this.logger.warn(
        `Skipping provisioning for Clerk user ${data.id}: missing or invalid role "${String(rawRole)}"`,
      );
      return;
    }

    const rawEmail =
      data.email_addresses.find((e) => e.id === data.primary_email_address_id)
        ?.email_address ?? data.email_addresses[0]?.email_address;
    if (!rawEmail) {
      this.logger.warn(
        `Skipping provisioning for Clerk user ${data.id}: no email address on payload`,
      );
      return;
    }
    // Normalize so the same address in different casing always matches the
    // same local User row (email is unique, matched case-sensitively).
    const email = rawEmail.toLowerCase();

    const firstName = data.first_name ?? undefined;
    const lastName = data.last_name ?? undefined;
    const displayName =
      [firstName, lastName].filter(Boolean).join(' ') || email;

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { clerkUserId: data.id },
          create: {
            clerkUserId: data.id,
            email,
            firstName,
            lastName,
            role: rawRole,
          },
          update: { email, firstName, lastName, role: rawRole },
        });

        switch (rawRole) {
          case UserRole.business:
            await tx.business.upsert({
              where: { userId: user.id },
              create: {
                userId: user.id,
                legalName: displayName,
                contactEmail: email,
              },
              update: {},
            });
            break;
          case UserRole.buyer:
            await tx.buyer.upsert({
              where: { userId: user.id },
              create: {
                userId: user.id,
                legalName: displayName,
                contactEmail: email,
              },
              update: {},
            });
            break;
          case UserRole.investor:
            await tx.investor.upsert({
              where: { userId: user.id },
              create: { userId: user.id, displayName },
              update: {},
            });
            break;
          case UserRole.admin:
            // No profile table for admins.
            break;
        }

        return user.id;
      });
    } catch (err) {
      // A different clerkUserId already owns this email (e.g. a Clerk account
      // deleted then recreated — user.deleted isn't handled yet). Retrying
      // won't fix it, so log and skip instead of 500-ing into Clerk's retry
      // loop. Relinking accounts is a product decision, not made here.
      if (isUniqueConstraintError(err)) {
        this.logger.warn(
          `Skipping provisioning for Clerk user ${data.id}: email ${email} already belongs to another user`,
        );
        return;
      }
      throw err;
    }

    this.logger.log(
      `Provisioned ${rawRole} user ${userId} for Clerk user ${data.id}`,
    );
  }
}
