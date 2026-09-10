import {
  Inject,
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Brickken, WriteResult } from 'brickken-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { OnChainAction, OnChainStatus } from '../common/enums';
import type { Env } from '../config/env.validation';
import { BRICKKEN_CLIENT } from './brickken.tokens';
import { BrickkenIntegrationError, mapBrickkenError } from './brickken.errors';

const STO_ID_KEYS = ['stoId', 'offeringId', 'id', 'uuid'] as const;

function toUnixSeconds(date: Date): string {
  return Math.floor(date.getTime() / 1000).toString();
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

export interface CloseAndClaimInput {
  invoiceId: string;
  tokenSymbol: string;
  investorEmail: string;
  investorAddress: string;
}

@Injectable()
export class BrickkenService {
  private readonly logger = new Logger(BrickkenService.name);
  private readonly chainId: string;
  private readonly tokenizerEmail: string;
  private readonly acceptedCoin: string;

  constructor(
    @Inject(BRICKKEN_CLIENT) private readonly bkn: Brickken,
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>,
  ) {
    this.chainId = config.get('BRICKKEN_CHAIN_ID', { infer: true });
    this.tokenizerEmail = config.get('BRICKKEN_TOKENIZER_EMAIL', {
      infer: true,
    });
    this.acceptedCoin = config.get('BRICKKEN_ACCEPTED_COIN', { infer: true });
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
          { execute: true },
        ),
    );
    return { txHash };
  }

  whitelistInvestorWallet(): never {
    throw new NotImplementedException(
      'whitelistInvestorWallet is not wired up — the platform wallet is the sole on-chain investor for now',
    );
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
            startDate: toUnixSeconds(input.startDate),
            endDate: toUnixSeconds(input.endDate),
            acceptedCoin: this.acceptedCoin,
            minRaiseUSD: input.raiseAmount,
            maxRaiseUSD: input.raiseAmount,
            minInvestment: '1',
            maxInvestment: input.raiseAmount,
          },
          { execute: true },
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

  async closeAndClaim(input: CloseAndClaimInput): Promise<void> {
    await this.call(OnChainAction.closeOffer, input.invoiceId, () =>
      this.bkn.sto.close(
        {
          chainId: this.chainId,
          tokenSymbol: input.tokenSymbol,
          tokenizerEmail: this.tokenizerEmail,
        },
        { execute: true },
      ),
    );
    await this.call(OnChainAction.claimTokens, input.invoiceId, () =>
      this.bkn.sto.claim(
        {
          chainId: this.chainId,
          tokenSymbol: input.tokenSymbol,
          investorEmail: input.investorEmail,
          investorAddress: input.investorAddress as `0x${string}`,
        },
        { execute: true },
      ),
    );
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
            transactionHashes: result.sent?.transactionHashes ?? [],
          },
        },
      });
      return { result, txHash };
    } catch (err) {
      const mapped = mapBrickkenError(err);
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
