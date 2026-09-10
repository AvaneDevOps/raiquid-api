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
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import type { AuthUser } from '../src/auth/auth-user.type';
import {
  InvoiceStatus,
  NotificationTone,
  UserRole,
  WalletTransactionType,
  WhitelistStatus,
} from '../src/common/enums';

jest.setTimeout(30_000);

const RUN = randomUUID();

describe('Notifications wired to domain events (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;

  let currentUser: AuthUser;

  let businessUser: AuthUser;
  let businessUserId: string;
  let businessId: string;
  let buyerUser: AuthUser;
  let buyerId: string;
  const BUYER_EMAIL = `buyer-notif-${RUN}@test.example`;

  let investorUser: AuthUser;
  let investorUserId: string;

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
        sendWhitelistDecision: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(BrickkenService)
      .useValue({
        tokenizeInvoice: jest.fn().mockResolvedValue({ txHash: null }),
        launchOffering: jest
          .fn()
          .mockResolvedValue({ stoId: 'sto-test', txHash: null }),
        whitelistInvestorWallet: jest.fn(),
        invest: jest.fn().mockResolvedValue({ txHash: null }),
        finalizeOffering: jest.fn().mockResolvedValue({
          closeTxHash: null,
          claimTxHash: null,
          dividendTxHash: null,
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const bUser = await prisma.user.create({
      data: {
        clerkUserId: `clerk_biz_${RUN}`,
        email: `biz-${RUN}@test.example`,
        role: UserRole.business,
      },
    });
    businessUserId = bUser.id;
    businessUser = authFor(bUser.id, UserRole.business);
    const biz = await prisma.business.create({
      data: { userId: bUser.id, legalName: 'Notif Supplier Co' },
    });
    businessId = biz.id;

    const buUser = await prisma.user.create({
      data: {
        clerkUserId: `clerk_buyer_${RUN}`,
        email: `buyer-acc-${RUN}@test.example`,
        role: UserRole.buyer,
      },
    });
    buyerUser = authFor(buUser.id, UserRole.buyer);
    const buyer = await prisma.buyer.create({
      data: {
        userId: buUser.id,
        legalName: 'Notif Debtor Co',
        contactEmail: BUYER_EMAIL,
      },
    });
    buyerId = buyer.id;

    const iUser = await prisma.user.create({
      data: {
        clerkUserId: `clerk_inv_${RUN}`,
        email: `inv-${RUN}@test.example`,
        role: UserRole.investor,
      },
    });
    investorUserId = iUser.id;
    investorUser = authFor(iUser.id, UserRole.investor);
    const investor = await prisma.investor.create({
      data: {
        userId: iUser.id,
        displayName: 'Notif Investor',
        whitelistStatus: WhitelistStatus.whitelisted,
      },
    });
    await prisma.walletTransaction.create({
      data: {
        type: WalletTransactionType.deposit,
        amount: 1_000_000,
        investorId: investor.id,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTokenizedInvoice(invoiceNumber: string, amount: number) {
    currentUser = businessUser;
    const res = await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber,
        amount,
        dueDate: '2027-06-01',
        buyerLegalName: 'Notif Debtor Co',
        buyerContactEmail: BUYER_EMAIL,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    const { confirmToken } = await prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: { confirmToken: true },
    });
    await request(httpServer)
      .post(`/confirm/${confirmToken}/review`)
      .send({ accept: true })
      .expect(201);
    return id;
  }

  function notificationsFor(userId: string) {
    return prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  it('buyer accepts an invoice → the business owner gets a positive notification', async () => {
    const invoiceId = await createTokenizedInvoice(
      `NOTIF-ACCEPT-${RUN}`,
      60_000,
    );

    const rows = await notificationsFor(businessUserId);
    const hit = rows.find((n) => n.href === `/business/invoices/${invoiceId}`);
    expect(hit).toBeDefined();
    expect(hit?.tone).toBe(NotificationTone.positive);
    expect(hit?.title).toBe(`Invoice NOTIF-ACCEPT-${RUN} accepted`);
    expect(hit?.readAt).toBeNull();
  });

  it('buyer disputes an invoice → the business owner gets a warning notification carrying the note', async () => {
    currentUser = businessUser;
    const res = await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber: `NOTIF-DISPUTE-${RUN}`,
        amount: 25_000,
        dueDate: '2027-06-01',
        buyerLegalName: 'Notif Debtor Co',
        buyerContactEmail: BUYER_EMAIL,
      })
      .expect(201);
    const invoiceId = (res.body as { id: string }).id;
    const { confirmToken } = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      select: { confirmToken: true },
    });

    await request(httpServer)
      .post(`/confirm/${confirmToken}/review`)
      .send({ accept: false, note: 'Wrong amount' })
      .expect(201);

    const rows = await notificationsFor(businessUserId);
    const hit = rows.find(
      (n) => n.title === `Invoice NOTIF-DISPUTE-${RUN} disputed`,
    );
    expect(hit).toBeDefined();
    expect(hit?.tone).toBe(NotificationTone.warning);
    expect(hit?.body).toContain('Wrong amount');
  });

  it('investor fully funds an invoice → the business owner gets a "fully funded" notification', async () => {
    const invoiceId = await createTokenizedInvoice(
      `NOTIF-FUND-${RUN}`,
      100_000,
    );

    currentUser = investorUser;
    await request(httpServer)
      .post(`/investor/marketplace/${invoiceId}/fund`)
      .send({ amount: 100_000 })
      .expect(201);

    const rows = await notificationsFor(businessUserId);
    const hit = rows.find(
      (n) => n.title === `Invoice NOTIF-FUND-${RUN} fully funded`,
    );
    expect(hit).toBeDefined();
    expect(hit?.tone).toBe(NotificationTone.positive);
    expect(hit?.body).toContain('96000');
  });

  it('a partial funding does NOT notify the business', async () => {
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `NOTIF-PARTIAL-${RUN}`,
        businessId,
        buyerId,
        amount: 100_000,
        dueDate: new Date('2027-06-01'),
        status: InvoiceStatus.tokenized,
        platformFeePct: 3,
        reserveContributionPct: 1,
      },
    });

    currentUser = investorUser;
    await request(httpServer)
      .post(`/investor/marketplace/${invoice.id}/fund`)
      .send({ amount: 40_000 })
      .expect(201);

    const rows = await notificationsFor(businessUserId);
    expect(
      rows.some((n) => n.href === `/business/invoices/${invoice.id}`),
    ).toBe(false);
  });

  it('buyer repays a funded invoice → each investor holder gets a repayment notification', async () => {
    const invoiceId = await createTokenizedInvoice(
      `NOTIF-REPAY-${RUN}`,
      80_000,
    );

    currentUser = investorUser;
    await request(httpServer)
      .post(`/investor/marketplace/${invoiceId}/fund`)
      .send({ amount: 80_000 })
      .expect(201);

    currentUser = buyerUser;
    await request(httpServer)
      .post(`/buyer/invoices/${invoiceId}/pay`)
      .send({ amount: 80_000, paymentReference: 'REF-NOTIF' })
      .expect(201);

    const holding = await prisma.holding.findFirstOrThrow({
      where: { invoiceId },
    });
    const rows = await notificationsFor(investorUserId);
    const hit = rows.find(
      (n) => n.href === `/investor/portfolio/${holding.id}`,
    );
    expect(hit).toBeDefined();
    expect(hit?.tone).toBe(NotificationTone.positive);
    expect(hit?.title).toBe(`Invoice NOTIF-REPAY-${RUN} repaid`);
  });

  describe('GET /notifications', () => {
    it("returns the current user's tray newest-first with an unread count", async () => {
      currentUser = businessUser;
      const res = await request(httpServer).get('/notifications').expect(200);
      const body = res.body as {
        data: Array<{ id: string; createdAt: string; readAt: string | null }>;
        total: number;
        unreadCount: number;
        page: number;
        pageSize: number;
      };

      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(body.unreadCount).toBe(body.total);
      expect(body.data.every((n) => n.readAt === null)).toBe(true);
      const times = body.data.map((n) => new Date(n.createdAt).getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('paginates', async () => {
      currentUser = businessUser;
      const res = await request(httpServer)
        .get('/notifications?pageSize=2')
        .expect(200);
      const body = res.body as { data: unknown[]; pageSize: number };
      expect(body.pageSize).toBe(2);
      expect(body.data.length).toBe(2);
    });

    it('unreadOnly=true excludes read notifications', async () => {
      const one = await prisma.notification.findFirstOrThrow({
        where: { userId: businessUserId },
      });
      await prisma.notification.update({
        where: { id: one.id },
        data: { readAt: new Date() },
      });

      currentUser = businessUser;
      const res = await request(httpServer)
        .get('/notifications?unreadOnly=true')
        .expect(200);
      const body = res.body as {
        data: Array<{ id: string }>;
        total: number;
        unreadCount: number;
      };
      expect(body.data.some((n) => n.id === one.id)).toBe(false);
      expect(body.unreadCount).toBe(body.total);
    });

    it("only ever returns the caller's own notifications", async () => {
      currentUser = investorUser;
      const res = await request(httpServer).get('/notifications').expect(200);
      const body = res.body as { data: Array<{ id: string }> };
      const investorIds = new Set(body.data.map((n) => n.id));
      const businessRows = await notificationsFor(businessUserId);
      expect(businessRows.every((n) => !investorIds.has(n.id))).toBe(true);
    });
  });

  describe('PATCH /notifications/:id/read', () => {
    it('marks a notification read; a second call is an idempotent no-op', async () => {
      currentUser = businessUser;
      const before = await request(httpServer)
        .get('/notifications?unreadOnly=true')
        .expect(200);
      const target = (before.body as { data: Array<{ id: string }> }).data[0];
      expect(target).toBeDefined();

      const first = await request(httpServer)
        .patch(`/notifications/${target.id}/read`)
        .expect(200);
      const firstReadAt = (first.body as { readAt: string | null }).readAt;
      expect(firstReadAt).not.toBeNull();

      const row = await prisma.notification.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row.readAt).not.toBeNull();

      const second = await request(httpServer)
        .patch(`/notifications/${target.id}/read`)
        .expect(200);
      expect((second.body as { readAt: string | null }).readAt).toBe(
        firstReadAt,
      );

      const after = await request(httpServer)
        .get('/notifications?unreadOnly=true')
        .expect(200);
      expect(
        (after.body as { data: Array<{ id: string }> }).data.some(
          (n) => n.id === target.id,
        ),
      ).toBe(false);
    });

    it("404 when the notification isn't the caller's, and it stays unread", async () => {
      const investorNote = await prisma.notification.findFirstOrThrow({
        where: { userId: investorUserId, readAt: null },
      });

      currentUser = businessUser;
      await request(httpServer)
        .patch(`/notifications/${investorNote.id}/read`)
        .expect(404);

      const row = await prisma.notification.findUniqueOrThrow({
        where: { id: investorNote.id },
      });
      expect(row.readAt).toBeNull();
    });

    it('404 for an unknown id', async () => {
      currentUser = businessUser;
      await request(httpServer)
        .patch('/notifications/does-not-exist/read')
        .expect(404);
    });
  });
});
