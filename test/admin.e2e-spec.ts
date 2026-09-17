import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';
import { BrickkenService } from '../src/brickken/brickken.service';
import { BrickkenIntegrationError } from '../src/brickken/brickken.errors';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import type { AuthUser } from '../src/auth/auth-user.type';
import {
  InvoiceStatus,
  NotificationTone,
  OnChainAction,
  OnChainStatus,
  ProvenanceTier,
  UserRole,
  WhitelistStatus,
} from '../src/common/enums';

jest.setTimeout(30_000);

const RUN = randomUUID();

describe('Admin (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;

  const sendWhitelistDecisionMock = jest.fn().mockResolvedValue(undefined);

  const launchOfferingMock = jest
    .fn()
    .mockResolvedValue({ stoId: 'sto-test', txHash: null });

  const investMock = jest.fn().mockResolvedValue({ txHash: null });

  const finalizeOfferingMock = jest.fn(
    async ({ invoiceId }: { invoiceId: string }) => {
      for (const action of [
        OnChainAction.closeOffer,
        OnChainAction.claimTokens,
        OnChainAction.dividendDistribution,
      ]) {
        await prisma.onChainEvent.create({
          data: { action, status: OnChainStatus.confirmed, invoiceId },
        });
      }
      return {
        closeTxHash: '0xclose',
        claimTxHash: '0xclaim',
        dividendTxHash: '0xdiv',
      };
    },
  );

  let currentUser: AuthUser;
  let adminUser: AuthUser;
  let businessUser: AuthUser;

  const authFor = (dbUserId: string, role: UserRole): AuthUser => ({
    clerkUserId: `clerk_${role}_${dbUserId}`,
    sessionId: 's',
    dbUserId,
    role,
    email: `${dbUserId}@test.example`,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClerkAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<Request>().user = currentUser;
          return true;
        },
      })
      .overrideProvider(EmailService)
      .useValue({
        sendBuyerConfirmationLink: jest.fn().mockResolvedValue(undefined),
        sendBuyerReviewOutcome: jest.fn().mockResolvedValue(undefined),
        sendWhitelistDecision: sendWhitelistDecisionMock,
      })
      .overrideProvider(BrickkenService)
      .useValue({
        tokenizeInvoice: jest.fn().mockResolvedValue({ txHash: null }),
        launchOffering: launchOfferingMock,
        whitelistPlatformWallet: jest.fn().mockResolvedValue({ txHash: null }),
        invest: investMock,
        finalizeOffering: finalizeOfferingMock,
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    await prisma.$transaction([
      prisma.onChainEvent.deleteMany(),
      prisma.kycDocument.deleteMany(),
      prisma.holding.deleteMany(),
      prisma.walletTransaction.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.buyer.deleteMany(),
      prisma.investor.deleteMany(),
      prisma.business.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    const admin = await prisma.user.create({
      data: {
        clerkUserId: `clerk_admin_${RUN}`,
        email: `admin-${RUN}@test.example`,
        role: UserRole.admin,
      },
    });
    adminUser = authFor(admin.id, UserRole.admin);

    const bizOwner = await prisma.user.create({
      data: {
        clerkUserId: `clerk_biz_${RUN}`,
        email: `biz-${RUN}@test.example`,
        role: UserRole.business,
      },
    });
    businessUser = authFor(bizOwner.id, UserRole.business);
    const biz = await prisma.business.create({
      data: {
        userId: bizOwner.id,
        legalName: 'Supplier Co',
        contactEmail: bizOwner.email,
      },
    });

    const mkBuyer = (tag: string, tier: ProvenanceTier) =>
      prisma.buyer.create({
        data: {
          legalName: `Buyer ${tag}`,
          contactEmail: `buyer-${tag}-${RUN}@test.example`,
          provenanceTier: tier,
        },
      });
    const bq1 = await mkBuyer('q1', ProvenanceTier.quarried);
    await mkBuyer('q2', ProvenanceTier.quarried);
    await mkBuyer('c', ProvenanceTier.carried);
    await mkBuyer('a', ProvenanceTier.anchored);

    const mkInvoice = (o: {
      n: string;
      status: InvoiceStatus;
      amount: number;
      fundedAmount: number;
      reserveContributionPct: number;
      dueDate: string;
      repaidAt?: string;
    }) =>
      prisma.invoice.create({
        data: {
          invoiceNumber: `${o.n}-${RUN}`,
          businessId: biz.id,
          buyerId: bq1.id,
          amount: o.amount,
          fundedAmount: o.fundedAmount,
          status: o.status,
          platformFeePct: 3,
          reserveContributionPct: o.reserveContributionPct,
          dueDate: new Date(o.dueDate),
          repaidAt: o.repaidAt ? new Date(o.repaidAt) : null,
        },
      });
    await mkInvoice({
      n: 'SUB',
      status: InvoiceStatus.submitted,
      amount: 100_000,
      fundedAmount: 0,
      reserveContributionPct: 1,
      dueDate: '2027-06-01',
    });
    await mkInvoice({
      n: 'TOK',
      status: InvoiceStatus.tokenized,
      amount: 100_000,
      fundedAmount: 0,
      reserveContributionPct: 1,
      dueDate: '2027-06-01',
    });
    await mkInvoice({
      n: 'FUNDING',
      status: InvoiceStatus.funding,
      amount: 100_000,
      fundedAmount: 30_000,
      reserveContributionPct: 1,
      dueDate: '2027-06-01',
    });
    await mkInvoice({
      n: 'FUNDED',
      status: InvoiceStatus.funded,
      amount: 100_000,
      fundedAmount: 100_000,
      reserveContributionPct: 2,
      dueDate: '2027-06-01',
    });
    await mkInvoice({
      n: 'REPAID-OK',
      status: InvoiceStatus.repaid,
      amount: 50_000,
      fundedAmount: 50_000,
      reserveContributionPct: 1,
      dueDate: '2027-01-10',
      repaidAt: '2026-09-01',
    });
    await mkInvoice({
      n: 'REPAID-LATE',
      status: InvoiceStatus.repaid,
      amount: 50_000,
      fundedAmount: 50_000,
      reserveContributionPct: 1,
      dueDate: '2020-01-10',
      repaidAt: '2026-09-08',
    });
    await mkInvoice({
      n: 'REPAID-PRECISE',
      status: InvoiceStatus.repaid,
      amount: 20_000,
      fundedAmount: 20_000,
      reserveContributionPct: 1,
      dueDate: '2026-09-05',
      repaidAt: '2026-09-03',
    });

    const mkInvestor = async (tag: string, status: WhitelistStatus) => {
      const u = await prisma.user.create({
        data: {
          clerkUserId: `clerk_inv_${tag}_${RUN}`,
          email: `inv-${tag}-${RUN}@test.example`,
          role: UserRole.investor,
        },
      });
      await prisma.investor.create({
        data: { userId: u.id, whitelistStatus: status },
      });
    };
    await mkInvestor('wl1', WhitelistStatus.whitelisted);
    await mkInvestor('wl2', WhitelistStatus.whitelisted);
    await mkInvestor('pending', WhitelistStatus.identity_submitted);

    const mkEvent = (action: OnChainAction, status: OnChainStatus) =>
      prisma.onChainEvent.create({ data: { action, status } });
    await mkEvent(OnChainAction.mintToken, OnChainStatus.confirmed);
    await mkEvent(OnChainAction.mintToken, OnChainStatus.pending);
    await mkEvent(OnChainAction.newSto, OnChainStatus.confirmed);
    await mkEvent(OnChainAction.dividendDistribution, OnChainStatus.failed);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('role enforcement', () => {
    it.each([
      '/admin/overview',
      '/admin/reserve',
      '/admin/provenance',
      '/admin/ledger',
      '/admin/whitelisting',
    ])('403 for a non-admin role on %s', async (path) => {
      currentUser = businessUser;
      await request(httpServer).get(path).expect(403);
    });

    it('403 for a non-admin role on POST /admin/whitelisting/:id/decision', async () => {
      currentUser = businessUser;
      await request(httpServer)
        .post('/admin/whitelisting/whatever/decision')
        .send({ approve: true })
        .expect(403);
    });
  });

  describe('getOverview', () => {
    it('computes the four KPIs from the seeded data', async () => {
      currentUser = adminUser;
      const res = await request(httpServer).get('/admin/overview').expect(200);
      const body = res.body as {
        totalValueFinanced: number;
        activeInvoices: number;
        onTimeRepaymentRate: number | null;
        activeInvestors: number;
        definitions: Record<string, string>;
      };

      expect(body.totalValueFinanced).toBe(250_000);
      expect(body.activeInvoices).toBe(3);
      expect(body.activeInvestors).toBe(2);

      const onTimeRepaid = ['REPAID-OK', 'REPAID-PRECISE'];
      const lateRepaid = ['REPAID-LATE'];
      expect(body.onTimeRepaymentRate).toBeCloseTo(
        onTimeRepaid.length / (onTimeRepaid.length + lateRepaid.length),
        10,
      );
      expect(body.definitions.onTimeRepaymentRate).toMatch(/repaidAt/);
    });

    it('uses repaidAt, not the updatedAt proxy: REPAID-PRECISE was paid before its due date but its row was last written afterwards', async () => {
      const precise = await prisma.invoice.findFirstOrThrow({
        where: { invoiceNumber: `REPAID-PRECISE-${RUN}` },
      });
      expect(precise.repaidAt).not.toBeNull();
      expect(precise.repaidAt!.getTime()).toBeLessThan(
        precise.dueDate.getTime(),
      );
      expect(precise.updatedAt.getTime()).toBeGreaterThan(
        precise.dueDate.getTime(),
      );
    });
  });

  describe('getReserve', () => {
    it('sums reserve contributions from funded/repaid invoices', async () => {
      currentUser = adminUser;
      const res = await request(httpServer).get('/admin/reserve').expect(200);
      const body = res.body as {
        reserveBalance: number;
        totalValueFinanced: number;
        coverageRatio: number | null;
        claims: unknown[];
      };

      expect(body.reserveBalance).toBe(3_200);
      expect(body.totalValueFinanced).toBe(250_000);
      expect(body.coverageRatio).toBeCloseTo(3_200 / 250_000, 10);
      expect(body.claims).toEqual([]);
    });
  });

  describe('getProvenance', () => {
    it('lists every buyer and counts by tier', async () => {
      currentUser = adminUser;
      const res = await request(httpServer)
        .get('/admin/provenance')
        .expect(200);
      const body = res.body as {
        buyers: Array<{
          provenanceTier: string;
          acceptanceRate: string;
          onTimePaymentRate: string;
          invoicesFinancedCount: number;
        }>;
        byTier: Record<string, number>;
      };

      expect(body.buyers.length).toBe(4);
      expect(body.byTier).toEqual({ quarried: 2, carried: 1, anchored: 1 });
      for (const b of body.buyers) {
        expect(Number(b.acceptanceRate)).toBe(0);
        expect(Number(b.onTimePaymentRate)).toBe(0);
        expect(b.invoicesFinancedCount).toBe(0);
      }
    });
  });

  describe('getLedger', () => {
    it('reads OnChainEvent with action/status filters and pagination', async () => {
      currentUser = adminUser;

      const all = await request(httpServer).get('/admin/ledger').expect(200);
      expect((all.body as { total: number }).total).toBe(4);

      const mints = await request(httpServer)
        .get('/admin/ledger?action=mintToken')
        .expect(200);
      expect((mints.body as { total: number }).total).toBe(2);

      const confirmed = await request(httpServer)
        .get('/admin/ledger?status=confirmed')
        .expect(200);
      expect((confirmed.body as { total: number }).total).toBe(2);

      const mintConfirmed = await request(httpServer)
        .get('/admin/ledger?action=mintToken&status=confirmed')
        .expect(200);
      expect((mintConfirmed.body as { total: number }).total).toBe(1);

      const page = await request(httpServer)
        .get('/admin/ledger?pageSize=2')
        .expect(200);
      const pageBody = page.body as { total: number; data: unknown[] };
      expect(pageBody.total).toBe(4);
      expect(pageBody.data.length).toBe(2);
    });
  });

  describe('whitelisting review', () => {
    let pendingInvestorId: string;
    let pendingInvestorUserId: string;
    let approvedInvestorId: string;
    let alreadyWhitelistedId: string;
    let neverSubmittedId: string;

    beforeAll(async () => {
      const mk = async (tag: string, status: WhitelistStatus) => {
        const u = await prisma.user.create({
          data: {
            clerkUserId: `clerk_wlrev_${tag}_${RUN}`,
            email: `wlrev-${tag}-${RUN}@test.example`,
            role: UserRole.investor,
          },
        });
        const inv = await prisma.investor.create({
          data: { userId: u.id, whitelistStatus: status },
        });
        await prisma.kycDocument.create({
          data: {
            investorId: inv.id,
            documentType: 'identity',
            objectKey: `kyc/${inv.id}/identity/${RUN}`,
          },
        });
        return { userId: u.id, investorId: inv.id };
      };

      ({ investorId: pendingInvestorId, userId: pendingInvestorUserId } =
        await mk('pending', WhitelistStatus.in_review));
      ({ investorId: approvedInvestorId } = await mk(
        'toapprove',
        WhitelistStatus.in_review,
      ));
      ({ investorId: alreadyWhitelistedId } = await mk(
        'done',
        WhitelistStatus.whitelisted,
      ));
      ({ investorId: neverSubmittedId } = await mk(
        'neversubmitted',
        WhitelistStatus.identity_submitted,
      ));
    });

    it('lists only investors not yet whitelisted, with their KYC docs and email', async () => {
      currentUser = adminUser;
      const res = await request(httpServer)
        .get('/admin/whitelisting?pageSize=100')
        .expect(200);
      const body = res.body as {
        data: Array<{
          id: string;
          whitelistStatus: string;
          user: { email: string };
          kycDocuments: unknown[];
        }>;
        total: number;
      };

      const ids = body.data.map((i) => i.id);
      expect(ids).toContain(pendingInvestorId);
      expect(ids).toContain(approvedInvestorId);
      expect(ids).not.toContain(alreadyWhitelistedId);
      expect(
        body.data.every(
          (i) => i.whitelistStatus !== WhitelistStatus.whitelisted,
        ),
      ).toBe(true);
      const pending = body.data.find((i) => i.id === pendingInvestorId);
      expect(pending?.user.email).toBe(`wlrev-pending-${RUN}@test.example`);
      expect(pending?.kycDocuments.length).toBe(1);
    });

    it('approve → status whitelisted + a positive notification + decision email', async () => {
      currentUser = adminUser;
      sendWhitelistDecisionMock.mockClear();

      await request(httpServer)
        .post(`/admin/whitelisting/${approvedInvestorId}/decision`)
        .send({ approve: true, note: 'Docs check out' })
        .expect(201);

      const row = await prisma.investor.findUniqueOrThrow({
        where: { id: approvedInvestorId },
      });
      expect(row.whitelistStatus).toBe(WhitelistStatus.whitelisted);

      const notes = await prisma.notification.findMany({
        where: { userId: row.userId },
      });
      expect(notes.length).toBe(1);
      expect(notes[0].tone).toBe(NotificationTone.positive);
      expect(notes[0].href).toBe('/investor/marketplace');
      expect(notes[0].body).toContain('Docs check out');

      expect(sendWhitelistDecisionMock).toHaveBeenCalledWith(
        `wlrev-toapprove-${RUN}@test.example`,
        true,
      );
    });

    it('reject → status back to identity_submitted + a warning notification', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/whitelisting/${pendingInvestorId}/decision`)
        .send({ approve: false })
        .expect(201);

      const row = await prisma.investor.findUniqueOrThrow({
        where: { id: pendingInvestorId },
      });
      expect(row.whitelistStatus).toBe(WhitelistStatus.identity_submitted);

      const notes = await prisma.notification.findMany({
        where: { userId: pendingInvestorUserId },
      });
      expect(notes.length).toBe(1);
      expect(notes[0].tone).toBe(NotificationTone.warning);
      expect(notes[0].href).toBe('/investor/whitelisting');
    });

    it('404 for an unknown investor', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post('/admin/whitelisting/does-not-exist/decision')
        .send({ approve: true })
        .expect(404);
    });

    it('409 when approving an already-whitelisted investor', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/whitelisting/${alreadyWhitelistedId}/decision`)
        .send({ approve: true })
        .expect(409);
    });

    it('409 for any decision on an investor still at identity_submitted (must submit for review first)', async () => {
      currentUser = adminUser;

      await request(httpServer)
        .post(`/admin/whitelisting/${neverSubmittedId}/decision`)
        .send({ approve: true })
        .expect(409);
      await request(httpServer)
        .post(`/admin/whitelisting/${neverSubmittedId}/decision`)
        .send({ approve: false })
        .expect(409);

      const row = await prisma.investor.findUniqueOrThrow({
        where: { id: neverSubmittedId },
      });
      expect(row.whitelistStatus).toBe(WhitelistStatus.identity_submitted);

      const notes = await prisma.notification.findMany({
        where: { userId: row.userId },
      });
      expect(notes).toHaveLength(0);
    });

    it('400 when approve is missing from the body', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/whitelisting/${alreadyWhitelistedId}/decision`)
        .send({ note: 'no approve field' })
        .expect(400);
    });
  });

  describe('finalize-onchain', () => {
    let finBusinessId: string;
    let finBuyerId: string;

    beforeAll(async () => {
      const u = await prisma.user.create({
        data: {
          clerkUserId: `clerk_fin_biz_${RUN}`,
          email: `fin-biz-${RUN}@test.example`,
          role: UserRole.business,
        },
      });
      const biz = await prisma.business.create({
        data: { userId: u.id, legalName: 'Finalize Co' },
      });
      const buyer = await prisma.buyer.create({
        data: {
          legalName: 'Finalize Debtor',
          contactEmail: `fin-buyer-${RUN}@test.example`,
        },
      });
      finBusinessId = biz.id;
      finBuyerId = buyer.id;
    });

    beforeEach(() => {
      finalizeOfferingMock.mockClear();
    });

    let symbolSeq = 0;
    const seedLaunched = (o: {
      n: string;
      endsAt: Date | null;
      stoId?: string | null;
      finalizedAt?: Date | null;
      fundedAmount?: number;
    }) => {
      symbolSeq += 1;
      return prisma.invoice.create({
        data: {
          invoiceNumber: `${o.n}-${RUN}`,
          businessId: finBusinessId,
          buyerId: finBuyerId,
          amount: 100_000,
          fundedAmount: o.fundedAmount ?? 100_000,
          status: InvoiceStatus.funded,
          dueDate: new Date('2027-06-01'),
          brickkenTokenSymbol: `F${String(symbolSeq).padStart(3, '0')}`,
          brickkenStoId: o.stoId === undefined ? 'sto-uuid' : o.stoId,
          brickkenStoEndsAt: o.endsAt,
          brickkenFinalizedAt: o.finalizedAt ?? null,
        },
      });
    };

    it('403 for a non-admin role', async () => {
      currentUser = businessUser;
      await request(httpServer)
        .post('/admin/invoices/whatever/finalize-onchain')
        .expect(403);
    });

    it('404 for an unknown invoice', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post('/admin/invoices/does-not-exist/finalize-onchain')
        .expect(404);
    });

    it('409 when the invoice never launched an offering', async () => {
      const inv = await seedLaunched({
        n: 'FIN-NOSTO',
        endsAt: new Date(Date.now() - 1000),
        stoId: null,
      });
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/finalize-onchain`)
        .expect(409);
      expect(finalizeOfferingMock).not.toHaveBeenCalled();
    });

    it('409 when the STO window has not closed yet', async () => {
      const inv = await seedLaunched({
        n: 'FIN-EARLY',
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/finalize-onchain`)
        .expect(409);
      expect(finalizeOfferingMock).not.toHaveBeenCalled();
    });

    it('closes, claims and distributes — then rejects a second finalize as 409', async () => {
      const inv = await seedLaunched({
        n: 'FIN-OK',
        endsAt: new Date(Date.now() - 1000),
        fundedAmount: 90_000,
      });
      currentUser = adminUser;

      const res = await request(httpServer)
        .post(`/admin/invoices/${inv.id}/finalize-onchain`)
        .expect(201);
      const body = res.body as {
        invoice: { brickkenFinalizedAt: string | null };
        transactions: Record<string, string>;
      };
      expect(body.invoice.brickkenFinalizedAt).not.toBeNull();
      expect(body.transactions.dividendTxHash).toBe('0xdiv');

      expect(finalizeOfferingMock).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: inv.id,
          tokenSymbol: inv.brickkenTokenSymbol,
          dividendAmount: '90000',
        }),
      );

      const events = await prisma.onChainEvent.findMany({
        where: { invoiceId: inv.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(events.map((e) => e.action)).toEqual([
        OnChainAction.closeOffer,
        OnChainAction.claimTokens,
        OnChainAction.dividendDistribution,
      ]);

      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/finalize-onchain`)
        .expect(409);
    });

    it('502 when a Brickken step fails, and the invoice is not marked finalized', async () => {
      const inv = await seedLaunched({
        n: 'FIN-BAD',
        endsAt: new Date(Date.now() - 1000),
      });
      finalizeOfferingMock.mockImplementationOnce(() => {
        const err = new BrickkenIntegrationError('auth', 'claim rejected');
        err.action = OnChainAction.claimTokens;
        return Promise.reject(err);
      });
      currentUser = adminUser;

      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/finalize-onchain`)
        .expect(502);

      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: inv.id },
      });
      expect(row.brickkenFinalizedAt).toBeNull();
    });
  });

  describe('retry-sto-launch', () => {
    let retryBusinessId: string;
    let retryBuyerId: string;

    beforeAll(async () => {
      const u = await prisma.user.create({
        data: {
          clerkUserId: `clerk_retry_biz_${RUN}`,
          email: `retry-biz-${RUN}@test.example`,
          role: UserRole.business,
        },
      });
      const biz = await prisma.business.create({
        data: { userId: u.id, legalName: 'Retry Co' },
      });
      const buyer = await prisma.buyer.create({
        data: {
          legalName: 'Retry Debtor',
          contactEmail: `retry-buyer-${RUN}@test.example`,
        },
      });
      retryBusinessId = biz.id;
      retryBuyerId = buyer.id;
    });

    beforeEach(() => {
      launchOfferingMock.mockClear();
    });

    const seedStuck = (n: string, tokenSymbol: string | null) =>
      prisma.invoice.create({
        data: {
          invoiceNumber: `${n}-${RUN}`,
          businessId: retryBusinessId,
          buyerId: retryBuyerId,
          amount: 50_000,
          dueDate: new Date('2027-06-01'),
          status: InvoiceStatus.tokenized,
          brickkenTokenSymbol: tokenSymbol,
          brickkenTokenizationError: '[api] Company not found',
        },
      });

    it('404 for an unknown invoice', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post('/admin/invoices/does-not-exist/retry-sto-launch')
        .expect(404);
    });

    it('409 when tokenization never completed (no token symbol to launch against)', async () => {
      const inv = await seedStuck('RETRY-NOSYM', null);
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/retry-sto-launch`)
        .expect(409);
      expect(launchOfferingMock).not.toHaveBeenCalled();
    });

    it('409 when the STO is already launched — nothing to retry', async () => {
      const inv = await prisma.invoice.create({
        data: {
          invoiceNumber: `RETRY-ALREADY-${RUN}`,
          businessId: retryBusinessId,
          buyerId: retryBuyerId,
          amount: 50_000,
          dueDate: new Date('2027-06-01'),
          status: InvoiceStatus.tokenized,
          brickkenTokenSymbol: `RTOK-${RUN}`,
          brickkenStoId: 'sto-already-there',
        },
      });
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/retry-sto-launch`)
        .expect(409);
      expect(launchOfferingMock).not.toHaveBeenCalled();
    });

    it('launches the STO, persists it, and clears the tokenization error', async () => {
      const symbol = `RETRY-OK-${RUN}`;
      const inv = await seedStuck('RETRY-OK', symbol);
      currentUser = adminUser;

      const res = await request(httpServer)
        .post(`/admin/invoices/${inv.id}/retry-sto-launch`)
        .expect(201);
      const body = res.body as {
        brickkenStoId: string | null;
        brickkenStoEndsAt: string | null;
        brickkenTokenizationError: string | null;
      };
      expect(body.brickkenStoId).toBe('sto-test');
      expect(body.brickkenStoEndsAt).not.toBeNull();
      expect(body.brickkenTokenizationError).toBeNull();

      expect(launchOfferingMock).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: inv.id, tokenSymbol: symbol }),
      );
    });

    it('502 when launchOffering fails again, leaving the invoice still unlaunched', async () => {
      const inv = await seedStuck('RETRY-FAIL', `RETRY-FAIL-${RUN}`);
      launchOfferingMock.mockRejectedValueOnce(
        new BrickkenIntegrationError('auth', 'signer not permitted'),
      );
      currentUser = adminUser;

      await request(httpServer)
        .post(`/admin/invoices/${inv.id}/retry-sto-launch`)
        .expect(502);

      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: inv.id },
      });
      expect(row.brickkenStoId).toBeNull();
      expect(row.brickkenTokenizationError).toContain('signer not permitted');
    });
  });

  describe('retry-invest', () => {
    let riBusinessId: string;
    let riBuyerId: string;
    let riInvestorId: string;

    beforeAll(async () => {
      const bu = await prisma.user.create({
        data: {
          clerkUserId: `clerk_ri_biz_${RUN}`,
          email: `ri-biz-${RUN}@test.example`,
          role: UserRole.business,
        },
      });
      const biz = await prisma.business.create({
        data: { userId: bu.id, legalName: 'Retry Invest Co' },
      });
      const buyer = await prisma.buyer.create({
        data: {
          legalName: 'Retry Invest Debtor',
          contactEmail: `ri-buyer-${RUN}@test.example`,
        },
      });
      const iu = await prisma.user.create({
        data: {
          clerkUserId: `clerk_ri_inv_${RUN}`,
          email: `ri-inv-${RUN}@test.example`,
          role: UserRole.investor,
        },
      });
      const investor = await prisma.investor.create({
        data: {
          userId: iu.id,
          displayName: 'Retry Invest Investor',
          whitelistStatus: WhitelistStatus.whitelisted,
        },
      });
      riBusinessId = biz.id;
      riBuyerId = buyer.id;
      riInvestorId = investor.id;
    });

    beforeEach(() => {
      investMock.mockClear();
    });

    const seedInvoiceWithSto = (n: string, stoId: string | null = 'sto-live') =>
      prisma.invoice.create({
        data: {
          invoiceNumber: `${n}-${RUN}`,
          businessId: riBusinessId,
          buyerId: riBuyerId,
          amount: 40_000,
          fundedAmount: 40_000,
          dueDate: new Date('2027-06-01'),
          status: InvoiceStatus.funded,
          brickkenTokenSymbol: `RI-${n}-${RUN}`,
          brickkenStoId: stoId,
        },
      });

    const seedFailedHolding = (invoiceId: string, amount = 40_000) =>
      prisma.holding.create({
        data: {
          investorId: riInvestorId,
          invoiceId,
          amount,
          tokenUnits: amount,
          brickkenInvestmentError:
            '[api] STO not found for the provided token scope',
        },
      });

    it('404 for an unknown holding', async () => {
      currentUser = adminUser;
      await request(httpServer)
        .post('/admin/holdings/does-not-exist/retry-invest')
        .expect(404);
    });

    it('409 when the holding has no recorded newInvest failure', async () => {
      const inv = await seedInvoiceWithSto('RI-NOERR');
      const holding = await prisma.holding.create({
        data: {
          investorId: riInvestorId,
          invoiceId: inv.id,
          amount: 40_000,
          tokenUnits: 40_000,
        },
      });
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/holdings/${holding.id}/retry-invest`)
        .expect(409);
      expect(investMock).not.toHaveBeenCalled();
    });

    it('409 when the invoice has no launched STO to invest into', async () => {
      const inv = await seedInvoiceWithSto('RI-NOSTO', null);
      const holding = await seedFailedHolding(inv.id);
      currentUser = adminUser;
      await request(httpServer)
        .post(`/admin/holdings/${holding.id}/retry-invest`)
        .expect(409);
      expect(investMock).not.toHaveBeenCalled();
    });

    it('retries newInvest and clears the error on success', async () => {
      const inv = await seedInvoiceWithSto('RI-OK');
      const holding = await seedFailedHolding(inv.id, 12_345);
      currentUser = adminUser;

      const res = await request(httpServer)
        .post(`/admin/holdings/${holding.id}/retry-invest`)
        .expect(201);
      const body = res.body as { brickkenInvestmentError: string | null };
      expect(body.brickkenInvestmentError).toBeNull();

      expect(investMock).toHaveBeenCalledWith(
        expect.objectContaining({
          invoiceId: inv.id,
          tokenSymbol: inv.brickkenTokenSymbol,
          amount: '12345',
        }),
      );
    });

    it('502 when newInvest fails again, leaving the error recorded', async () => {
      const inv = await seedInvoiceWithSto('RI-FAIL');
      const holding = await seedFailedHolding(inv.id);
      investMock.mockRejectedValueOnce(
        new BrickkenIntegrationError(
          'unauthorized_token_symbol',
          'wallet not whitelisted',
        ),
      );
      currentUser = adminUser;

      await request(httpServer)
        .post(`/admin/holdings/${holding.id}/retry-invest`)
        .expect(502);

      const row = await prisma.holding.findUniqueOrThrow({
        where: { id: holding.id },
      });
      expect(row.brickkenInvestmentError).toContain('wallet not whitelisted');
    });
  });
});
