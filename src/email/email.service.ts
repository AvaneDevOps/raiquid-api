import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../config/env.validation';

/**
 * Wrapper around the Resend transactional-email client.
 *
 * Method bodies are stubs per the project-structure scope: the actual email
 * templates + send calls land with their features.
 */
@Injectable()
export class EmailService {
  private readonly resend: Resend;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.resend = new Resend(
      this.config.get('RESEND_API_KEY', { infer: true }),
    );
  }

  /** Raw client for callers that need Resend features not wrapped here. */
  get client(): Resend {
    return this.resend;
  }

  /**
   * Send the buyer the magic link that opens the standalone confirm flow
   * (frontend route /confirm/:invoiceId). Triggered from POST /business/invoices.
   */
  sendBuyerConfirmationLink(_to: string, _confirmUrl: string): Promise<void> {
    // TODO: implement Resend send with the "invoice awaiting your acceptance"
    // template.
    throw new NotImplementedException();
  }

  /**
   * Notify an investor that their whitelisting review completed.
   * Supports GET /investor/whitelisting status changes.
   */
  sendWhitelistDecision(_to: string, _approved: boolean): Promise<void> {
    // TODO: implement Resend send with the whitelisting-decision template.
    throw new NotImplementedException();
  }
}
