import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { Env } from '../config/env.validation';

const FROM_ADDRESS = 'Raiquid <no-reply@raiquid.io>';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.resend = new Resend(
      this.config.get('RESEND_API_KEY', { infer: true }),
    );
  }

  get client(): Resend {
    return this.resend;
  }

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

  async sendBuyerReviewOutcome(
    to: string,
    opts: { invoiceNumber: string; accepted: boolean; note?: string },
  ): Promise<void> {
    const verdict = opts.accepted ? 'accepted' : 'disputed';
    const noteLine = opts.note ? `\n\nBuyer's note: ${opts.note}` : '';
    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject: `Invoice ${opts.invoiceNumber} was ${verdict} by the buyer`,
      html: `<p>The buyer has <strong>${verdict}</strong> invoice ${opts.invoiceNumber}.</p>${
        opts.note ? `<p>Buyer's note: ${opts.note}</p>` : ''
      }`,
      text: `The buyer has ${verdict} invoice ${opts.invoiceNumber}.${noteLine}`,
    });

    if (error) {
      this.logger.error(
        `Resend failed to send review outcome to ${to}: ${error.message}`,
      );
      throw new Error(
        `Failed to send buyer review outcome email: ${error.message}`,
      );
    }
  }

  async sendWhitelistDecision(to: string, approved: boolean): Promise<void> {
    const subject = approved
      ? 'Your investor account has been whitelisted'
      : 'Your whitelisting submission needs another look';
    const line = approved
      ? "You're now cleared to fund invoices on the Raiquid marketplace."
      : 'Your whitelisting submission was not approved. Please review your details and resubmit.';
    const { error } = await this.resend.emails.send({
      from: FROM_ADDRESS,
      to,
      subject,
      html: `<p>${line}</p>`,
      text: line,
    });

    if (error) {
      this.logger.error(
        `Resend failed to send whitelisting decision to ${to}: ${error.message}`,
      );
      throw new Error(
        `Failed to send whitelisting decision email: ${error.message}`,
      );
    }
  }
}
