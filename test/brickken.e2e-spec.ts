import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthError } from 'brickken-sdk';
import { validateEnv } from '../src/config/env.validation';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BrickkenService } from '../src/brickken/brickken.service';
import {
  BRICKKEN_CLIENT,
  BRICKKEN_SIGNER_ADDRESS,
} from '../src/brickken/brickken.tokens';
import { BrickkenIntegrationError } from '../src/brickken/brickken.errors';
import { OnChainAction, OnChainStatus, UserRole } from '../src/common/enums';

jest.setTimeout(30_000);

describe('BrickkenService against a real DB with a fake SDK client (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let brickken: BrickkenService;

  const tokenizationCreate = jest.fn();
  const tokenizationWhitelist = jest.fn();
  const tokenizationDistributeDividend = jest.fn();
  const stoCreate = jest.fn();
  const stoInvest = jest.fn();
  const stoClose = jest.fn();
  const stoClaim = jest.fn();

  const SIGNER = '0x000000000000000000000000000000000000d00d';
  const RUN = randomUUID();
  let invoiceId: string;

  // OnChainEvent.txHash is globally unique; the throwaway DB is not wiped between
  // `npm run test:e2e` runs, so every hash this spec inserts is namespaced by RUN.
  const hx = (suffix: string) => `0x${RUN.replace(/-/g, '')}${suffix}`;

  const writeResult = (hash: string, info?: Record<string, unknown>) => ({
    txId: 'tx',
    executionMode: 'client-signed',
    transactions: [],
    raw: {},
    ...(info ? { info } : {}),
    sent: { transactionHashes: [hash] },
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
      ],
      providers: [
        BrickkenService,
        { provide: BRICKKEN_SIGNER_ADDRESS, useValue: SIGNER },
        {
          provide: BRICKKEN_CLIENT,
          useValue: {
            tokenization: {
              create: tokenizationCreate,
              whitelist: tokenizationWhitelist,
              distributeDividend: tokenizationDistributeDividend,
            },
            sto: {
              create: stoCreate,
              invest: stoInvest,
              close: stoClose,
              claim: stoClaim,
            },
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
    brickken = moduleRef.get(BrickkenService);

    const user = await prisma.user.create({
      data: {
        clerkUserId: `clerk_bkn_${RUN}`,
        email: `bkn-biz-${RUN}@test.example`,
        role: UserRole.business,
      },
    });
    const business = await prisma.business.create({
      data: { userId: user.id, legalName: 'Bkn Supplier' },
    });
    const buyer = await prisma.buyer.create({
      data: {
        legalName: 'Bkn Debtor',
        contactEmail: `bkn-buyer-${RUN}@test.example`,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `BKN-${RUN}`,
        businessId: business.id,
        buyerId: buyer.id,
        amount: 100_000,
        dueDate: new Date('2027-06-01'),
      },
    });
    invoiceId = invoice.id;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    tokenizationCreate.mockReset();
    tokenizationWhitelist.mockReset();
    tokenizationDistributeDividend.mockReset();
    stoCreate.mockReset();
    stoInvest.mockReset();
    stoClose.mockReset();
    stoClaim.mockReset();
  });

  it('confirms the event and persists only the real tx hash from [hash, r, s]', async () => {
    tokenizationCreate.mockResolvedValue({
      txId: 'tx-ok',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      // [txHash, r, s] — Brickken returns the signature components at 1 and 2.
      sent: { transactionHashes: [hx('c0ffee'), hx('rSig'), hx('sSig')] },
    });

    const result = await brickken.tokenizeInvoice({
      invoiceId,
      tokenSymbol: 'RTEST',
      name: 'Invoice BKN',
      supplyCap: '100000',
    });
    expect(result.txHash).toBe(hx('c0ffee'));

    const events = await prisma.onChainEvent.findMany({
      where: { invoiceId, action: OnChainAction.newTokenization },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: OnChainStatus.confirmed,
      txHash: hx('c0ffee'),
      chainId: 11155111,
    });
    expect(events[0].rawPayload).toMatchObject({
      transactionHashes: [hx('c0ffee')],
    });
  });

  it('marks the OnChainEvent failed and throws a mapped error on an SDK failure', async () => {
    tokenizationCreate.mockRejectedValue(
      new AuthError('signer not whitelisted'),
    );

    await expect(
      brickken.tokenizeInvoice({
        invoiceId,
        tokenSymbol: 'RFAIL',
        name: 'x',
        supplyCap: '1',
      }),
    ).rejects.toMatchObject({
      name: 'BrickkenIntegrationError',
      kind: 'auth',
    });

    const failed = await prisma.onChainEvent.findFirst({
      where: {
        invoiceId,
        action: OnChainAction.newTokenization,
        status: OnChainStatus.failed,
      },
    });
    expect(failed).not.toBeNull();
    expect(failed?.rawPayload).toMatchObject({ kind: 'auth' });
  });

  it('launchOffering: confirms a newSto event and returns the STO id', async () => {
    stoCreate.mockResolvedValue({
      txId: 'tx-sto',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      info: { stoId: 'sto-real-uuid' },
      sent: { transactionHashes: [hx('5701')] },
    });

    const out = await brickken.launchOffering({
      invoiceId,
      tokenSymbol: 'RTEST',
      offeringName: 'Invoice BKN financing',
      tokenAmount: '100000',
      raiseAmount: '100000',
      startDate: new Date('2027-01-01T00:00:00Z'),
      endDate: new Date('2027-01-04T00:00:00Z'),
    });
    expect(out.stoId).toBe('sto-real-uuid');

    const event = await prisma.onChainEvent.findFirst({
      where: {
        invoiceId,
        action: OnChainAction.newSto,
        status: OnChainStatus.confirmed,
      },
    });
    expect(event?.txHash).toBe(hx('5701'));
  });

  it('launchOffering: a response with no STO id is a BrickkenIntegrationError', async () => {
    stoCreate.mockResolvedValue({
      txId: 'tx',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      info: {},
      sent: { transactionHashes: [hx('abc')] },
    });

    await expect(
      brickken.launchOffering({
        invoiceId,
        tokenSymbol: 'RTEST',
        offeringName: 'x',
        tokenAmount: '1',
        raiseAmount: '1',
        startDate: new Date('2027-01-01T00:00:00Z'),
        endDate: new Date('2027-01-04T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(BrickkenIntegrationError);
  });

  it('whitelistPlatformWallet: confirms a whitelist event for the token symbol', async () => {
    tokenizationWhitelist.mockResolvedValue(writeResult(hx('w1')));

    const out = await brickken.whitelistPlatformWallet({
      invoiceId,
      tokenSymbol: 'RTEST',
    });
    expect(out.txHash).toBe(hx('w1'));
    expect(tokenizationWhitelist).toHaveBeenCalledWith(
      {
        chainId: '11155111',
        tokenSymbol: 'RTEST',
        userToWhitelist: [
          {
            investorEmail: process.env.BRICKKEN_INVESTOR_EMAIL,
            investorAddress: SIGNER,
            whitelistStatus: true,
          },
        ],
      },
      { execute: true, signerAddress: SIGNER },
    );

    const event = await prisma.onChainEvent.findFirst({
      where: {
        invoiceId,
        action: OnChainAction.whitelist,
        status: OnChainStatus.confirmed,
      },
    });
    expect(event?.txHash).toBe(hx('w1'));
  });

  it('invest: confirms a newInvest event and passes the platform signer address', async () => {
    stoInvest.mockResolvedValue(writeResult(hx('1a7')));

    const out = await brickken.invest({
      invoiceId,
      tokenSymbol: 'RTEST',
      amount: '5000',
    });
    expect(out.txHash).toBe(hx('1a7'));
    expect(stoInvest).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenSymbol: 'RTEST',
        investorAddress: SIGNER,
        investorEmail: process.env.BRICKKEN_INVESTOR_EMAIL,
        investmentAmount: '5000',
      }),
      { execute: true, signerAddress: SIGNER },
    );

    const event = await prisma.onChainEvent.findFirst({
      where: {
        invoiceId,
        action: OnChainAction.newInvest,
        status: OnChainStatus.confirmed,
      },
    });
    expect(event?.txHash).toBe(hx('1a7'));
  });

  it('invest: an SDK failure marks the event failed and throws a mapped error', async () => {
    stoInvest.mockRejectedValue(new AuthError('investor not whitelisted'));

    await expect(
      brickken.invest({ invoiceId, tokenSymbol: 'RTEST', amount: '1' }),
    ).rejects.toMatchObject({ kind: 'auth', action: 'newInvest' });

    const failed = await prisma.onChainEvent.findFirst({
      where: {
        invoiceId,
        action: OnChainAction.newInvest,
        status: OnChainStatus.failed,
      },
    });
    expect(failed?.rawPayload).toMatchObject({ kind: 'auth' });
  });

  it('finalizeOffering: writes closeOffer, claimTokens, dividendDistribution in order', async () => {
    stoClose.mockResolvedValue(writeResult(hx('c105e')));
    stoClaim.mockResolvedValue(writeResult(hx('c1a1a')));
    tokenizationDistributeDividend.mockResolvedValue(writeResult(hx('d171d')));

    const before = new Date();
    const out = await brickken.finalizeOffering({
      invoiceId,
      tokenSymbol: 'RTEST',
      dividendAmount: '60000',
    });
    expect(out).toEqual({
      closeTxHash: hx('c105e'),
      claimTxHash: hx('c1a1a'),
      dividendTxHash: hx('d171d'),
    });

    const events = await prisma.onChainEvent.findMany({
      where: {
        invoiceId,
        createdAt: { gte: before },
        action: {
          in: [
            OnChainAction.closeOffer,
            OnChainAction.claimTokens,
            OnChainAction.dividendDistribution,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual([
      OnChainAction.closeOffer,
      OnChainAction.claimTokens,
      OnChainAction.dividendDistribution,
    ]);
    expect(events.every((e) => e.status === OnChainStatus.confirmed)).toBe(
      true,
    );
  });

  it('finalizeOffering: stops at a failed step and does not attempt the next', async () => {
    stoClose.mockResolvedValue(writeResult(hx('c105e2')));
    stoClaim.mockRejectedValue(new AuthError('claim rejected'));

    const before = new Date();
    await expect(
      brickken.finalizeOffering({
        invoiceId,
        tokenSymbol: 'RTEST',
        dividendAmount: '1',
      }),
    ).rejects.toMatchObject({ kind: 'auth', action: 'claimTokens' });

    expect(tokenizationDistributeDividend).not.toHaveBeenCalled();
    const events = await prisma.onChainEvent.findMany({
      where: { invoiceId, createdAt: { gte: before } },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => `${e.action}:${e.status}`)).toEqual([
      `${OnChainAction.closeOffer}:${OnChainStatus.confirmed}`,
      `${OnChainAction.claimTokens}:${OnChainStatus.failed}`,
    ]);
  });
});
