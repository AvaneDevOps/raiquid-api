import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthError } from 'brickken-sdk';
import { validateEnv } from '../src/config/env.validation';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BrickkenService } from '../src/brickken/brickken.service';
import { BRICKKEN_CLIENT } from '../src/brickken/brickken.tokens';
import { BrickkenIntegrationError } from '../src/brickken/brickken.errors';
import { OnChainAction, OnChainStatus, UserRole } from '../src/common/enums';

jest.setTimeout(30_000);

describe('BrickkenService against a real DB with a fake SDK client (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let brickken: BrickkenService;

  const tokenizationCreate = jest.fn();
  const stoCreate = jest.fn();

  const RUN = randomUUID();
  let invoiceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
        PrismaModule,
      ],
      providers: [
        BrickkenService,
        {
          provide: BRICKKEN_CLIENT,
          useValue: {
            tokenization: { create: tokenizationCreate },
            sto: {
              create: stoCreate,
              close: jest.fn(),
              claim: jest.fn(),
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
    stoCreate.mockReset();
  });

  it('writes a pending OnChainEvent, then confirms it with the tx hash', async () => {
    tokenizationCreate.mockResolvedValue({
      txId: 'tx-ok',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      sent: { transactionHashes: ['0xc0ffee'] },
    });

    const result = await brickken.tokenizeInvoice({
      invoiceId,
      tokenSymbol: 'RTEST',
      name: 'Invoice BKN',
      supplyCap: '100000',
    });
    expect(result.txHash).toBe('0xc0ffee');

    const events = await prisma.onChainEvent.findMany({
      where: { invoiceId, action: OnChainAction.newTokenization },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: OnChainStatus.confirmed,
      txHash: '0xc0ffee',
      chainId: 84532,
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
      sent: { transactionHashes: ['0x5701'] },
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
    expect(event?.txHash).toBe('0x5701');
  });

  it('launchOffering: a response with no STO id is a BrickkenIntegrationError', async () => {
    stoCreate.mockResolvedValue({
      txId: 'tx',
      executionMode: 'client-signed',
      transactions: [],
      raw: {},
      info: {},
      sent: { transactionHashes: ['0xabc'] },
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
});
