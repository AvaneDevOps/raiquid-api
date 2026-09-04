import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../config/env.validation';

// Sending domain needs to be verified in the Resend dashboard before this
// works outside of Resend's sandbox mode.
const FROM_ADDRESS = 'Raiquid <no-reply@raiquid.io>';

/** Wrapper around the Resend transactional-email client. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
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
  async sendBuyerConfirmationLink(
    to: string,
    confirmUrl: string,
  ): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: 'An invoice is awaiting your review',
      html: `<p>A business has submitted an invoice that lists you as the buyer.</p><p><a href="${confirmUrl}">Review and confirm it</a></p>`,
      text: `A business has submitted an invoice that lists you as the buyer.\n\nReview and confirm it: ${confirmUrl}`,
    });

    if (error) {
      this.logger.error(
        `Resend failed to send confirmation link to ${to}: ${error.message}`,
      );
      throw new Error(
        `Failed to send buyer confirmation email: ${error.message}`,
      );
    }
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
