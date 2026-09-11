import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Brickken, WriteResult } from 'brickken-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { OnChainAction, OnChainStatus } from '../common/enums';
import type { Env } from '../config/env.validation';
import { BRICKKEN_CLIENT, BRICKKEN_SIGNER_ADDRESS } from './brickken.tokens';
import { BrickkenIntegrationError, mapBrickkenError } from './brickken.errors';

const STO_ID_KEYS = ['stoId', 'offeringId', 'id', 'uuid'] as const;

// newSto's startDate/endDate must be ISO-8601 strings, not Unix-seconds — a
// Unix-seconds string reliably threw a server-side "invalid BigNumber string
// (value=NaN)" on newSto, confirmed by isolating every other variable (chain id
// format, raise/investment magnitudes, token identity, indexing lag) across six
// live sandbox attempts. See docs/RAIQUID_CONTEXT.md.
function toIsoDate(date: Date): string {
  return date.toISOString();
}

function findStoId(result: WriteResult): string | null {
  const candidates: unknown[] = [
    result.info,
    result.raw,
    (result.raw as { data?: unknown } | null)?.data,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object') {
      for (const key of STO_ID_KEYS) {
        const value = (candidate as Record<string, unknown>)[key];
        if (typeof value === 'string' && value.length > 0) {
          return value;
        }
      }
    }
  }
  return null;
}

export interface TokenizeInvoiceInput {
  invoiceId: string;
  tokenSymbol: string;
  name: string;
  supplyCap: string;
}

export interface LaunchOfferingInput {
  invoiceId: string;
  tokenSymbol: string;
  offeringName: string;
  tokenAmount: string;
  raiseAmount: string;
  startDate: Date;
  endDate: Date;
}

export interface InvestInput {
  invoiceId: string;
  tokenSymbol: string;
  /** Human-readable amount, in the STO's accepted-coin units. */
  amount: string;
}

export interface FinalizeOfferingInput {
  invoiceId: string;
  tokenSymbol: string;
  /** Human-readable dividend amount to distribute to token holders. */
  dividendAmount: string;
}

@Injectable()
export class BrickkenService {
  private readonly logger = new Logger(BrickkenService.name);
  private readonly chainId: string;
  private readonly tokenizerEmail: string;
  private readonly investorEmail: string;
  private readonly acceptedCoin: string;

  constructor(
    @Inject(BRICKKEN_CLIENT) private readonly bkn: Brickken,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
    @Inject(BRICKKEN_SIGNER_ADDRESS)
    private readonly signerAddress: `0x${string}`,
  ) {
    this.chainId = config.get('BRICKKEN_CHAIN_ID', { infer: true });
    this.tokenizerEmail = config.get('BRICKKEN_TOKENIZER_EMAIL', {
      infer: true,
    });
    this.investorEmail = config.get('BRICKKEN_INVESTOR_EMAIL', { infer: true });
    this.acceptedCoin = config.get('BRICKKEN_ACCEPTED_COIN', { infer: true });
  }

  /**
   * Options for every write. `signerAddress` is mandatory in the SDK's
   * client-signed mode (api-key credentials) — omitting it throws a local
   * ValidationError before the call is even sent.
   */
  private writeOptions(): { execute: true; signerAddress: `0x${string}` } {
    return { execute: true, signerAddress: this.signerAddress };
  }

  async tokenizeInvoice(
    input: TokenizeInvoiceInput,
  ): Promise<{ txHash: string | null }> {
    const { txHash } = await this.call(
      OnChainAction.newTokenization,
      input.invoiceId,
      () =>
        this.bkn.tokenization.create(
          {
            chainId: this.chainId,
            tokenizerEmail: this.tokenizerEmail,
            name: input.name,
            tokenSymbol: input.tokenSymbol,
            tokenType: 'BILL_FACTORING',
            supplyCap: input.supplyCap,
          },
          this.writeOptions(),
        ),
    );
    return { txHash };
  }

  /**
   * Whitelists the platform wallet, in its investor role, against one token
   * symbol. The tokenizer must do this once per new token before any `newInvest`
   * against it can succeed on-chain.
   */
  async whitelistPlatformWallet(input: {
    invoiceId: string;
    tokenSymbol: string;
  }): Promise<{ txHash: string | null }> {
    const { txHash } = await this.call(
      OnChainAction.whitelist,
      input.invoiceId,
      () =>
        this.bkn.tokenization.whitelist(
          {
            chainId: this.chainId,
            tokenSymbol: input.tokenSymbol,
            // Confirmed live, not guessed: omitting whitelistStatus produced a
            // decoded RoleRevoked(bytes32,address,address) event on-chain
            // instead of a grant. Adding it and repeating the call as a
            // first-ever attempt against a fresh token symbol produced
            // get-whitelist-status -> isWhitelisted: true, independently
            // verified against the chain (not just Brickken's API) both times.
            userToWhitelist: [
              {
                investorEmail: this.investorEmail,
                investorAddress: this.signerAddress,
                whitelistStatus: true,
              },
            ],
          },
          this.writeOptions(),
        ),
    );
    return { txHash };
  }

  async launchOffering(
    input: LaunchOfferingInput,
  ): Promise<{ stoId: string; txHash: string | null }> {
    const { result, txHash } = await this.call(
      OnChainAction.newSto,
      input.invoiceId,
      () =>
        this.bkn.sto.create(
          {
            chainId: this.chainId,
            tokenizerEmail: this.tokenizerEmail,
            tokenSymbol: input.tokenSymbol,
            tokenAmount: input.tokenAmount,
            offeringName: input.offeringName,
            startDate: toIsoDate(input.startDate),
            endDate: toIsoDate(input.endDate),
            acceptedCoin: this.acceptedCoin,
            minRaiseUSD: input.raiseAmount,
            maxRaiseUSD: input.raiseAmount,
            minInvestment: '1',
            maxInvestment: input.raiseAmount,
          },
          this.writeOptions(),
        ),
    );

    const stoId = findStoId(result);
    if (!stoId) {
      throw new BrickkenIntegrationError(
        'unknown',
        'newSto returned no STO id — check the Brickken response shape',
      );
    }
    return { stoId, txHash };
  }

  /**
   * The platform wallet's single on-chain investment into an invoice's STO. One
   * call per retail funding event; Brickken only ever sees the platform wallet.
   */
  async invest(input: InvestInput): Promise<{ txHash: string | null }> {
    const { txHash } = await this.call(
      OnChainAction.newInvest,
      input.invoiceId,
      () =>
        this.bkn.sto.invest(
          {
            chainId: this.chainId,
            tokenSymbol: input.tokenSymbol,
            investorEmail: this.investorEmail,
            investorAddress: this.signerAddress,
            investmentAmount: input.amount,
          },
          this.writeOptions(),
        ),
    );
    return { txHash };
  }

  /**
   * Closes a finished STO, claims its tokens to the platform wallet, then
   * distributes dividends — strictly in that order. Each step is its own
   * OnChainEvent; a failure throws before the next step is attempted.
   */
  async finalizeOffering(input: FinalizeOfferingInput): Promise<{
    closeTxHash: string | null;
    claimTxHash: string | null;
    dividendTxHash: string | null;
  }> {
    const close = await this.call(
      OnChainAction.closeOffer,
      input.invoiceId,
      () =>
        this.bkn.sto.close(
          {
            chainId: this.chainId,
            tokenSymbol: input.tokenSymbol,
            tokenizerEmail: this.tokenizerEmail,
          },
          this.writeOptions(),
        ),
    );
    const claim = await this.call(
      OnChainAction.claimTokens,
      input.invoiceId,
      () =>
        this.bkn.sto.claim(
          {
            chainId: this.chainId,
            tokenSymbol: input.tokenSymbol,
            investorEmail: this.investorEmail,
            investorAddress: this.signerAddress,
          },
          this.writeOptions(),
        ),
    );
    const dividend = await this.call(
      OnChainAction.dividendDistribution,
      input.invoiceId,
      () =>
        this.bkn.tokenization.distributeDividend(
          {
            chainId: this.chainId,
            tokenSymbol: input.tokenSymbol,
            amount: input.dividendAmount,
          },
          this.writeOptions(),
        ),
    );
    return {
      closeTxHash: close.txHash,
      claimTxHash: claim.txHash,
      dividendTxHash: dividend.txHash,
    };
  }

  private async call(
    action: OnChainAction,
    invoiceId: string,
    fn: () => Promise<WriteResult>,
  ): Promise<{ result: WriteResult; txHash: string | null }> {
    const event = await this.prisma.onChainEvent.create({
      data: {
        action,
        status: OnChainStatus.pending,
        invoiceId,
        chainId: Number(this.chainId),
      },
    });

    try {
      const result = await fn();
      const txHash = result.sent?.transactionHashes?.[0] ?? null;
      await this.prisma.onChainEvent.update({
        where: { id: event.id },
        data: {
          status: OnChainStatus.confirmed,
          txHash,
          rawPayload: {
            txId: result.txId,
            executionMode: result.executionMode,
            // Only index 0 is the tx hash. Brickken's sandbox response puts the
            // transaction's r and s signature components at indices 1 and 2, not
            // further hashes (confirmed against a live sandbox response).
            transactionHashes: txHash ? [txHash] : [],
          },
        },
      });
      return { result, txHash };
    } catch (err) {
      const mapped = mapBrickkenError(err);
      mapped.action = action;
      await this.prisma.onChainEvent.update({
        where: { id: event.id },
        data: {
          status: OnChainStatus.failed,
          rawPayload: { kind: mapped.kind, message: mapped.message },
        },
      });
      this.logger.error(
        `Brickken ${action} failed for invoice ${invoiceId}: [${mapped.kind}] ${mapped.message}`,
      );
      throw mapped;
    }
  }
}
