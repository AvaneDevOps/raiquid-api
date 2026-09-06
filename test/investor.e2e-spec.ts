import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { EmailService } from '../src/email/email.service';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import type { AuthUser } from '../src/auth/auth-user.type';
import {
  InvoiceStatus,
  WalletTransactionType,
  WhitelistStatus,
  UserRole,
} from '../src/common/enums';

jest.setTimeout(30_000);

const RUN = randomUUID();

describe('Investor + fund flow (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;

  let currentUser: AuthUser;
  let businessUser: AuthUser;
  let businessId: string;
  let buyerId: string;

  // whitelisted, funded wallet
  let investorUser: AuthUser;
  let investorId: string;
  // whitelisted, empty wallet
  let poorInvestorUser: AuthUser;
  // not whitelisted
  let pendingInvestorUser: AuthUser;
  let pendingInvestorId: string;

  const authFor = (dbUserId: string, role: UserRole): AuthUser => ({
    clerkUserId: `clerk_${role}_${dbUserId}`,
    sessionId: 's',
    dbUserId,
    role,
    email: `${dbUserId}@test.example`,
  });

  async function makeInvestor(
    tag: string,
    whitelistStatus: WhitelistStatus,
    depositAmount = 0,
  ) {
    const u = await prisma.user.create({
      data: {
        clerkUserId: `clerk_inv_${tag}_${RUN}`,
        email: `inv-${tag}-${RUN}@test.example`,
        role: UserRole.investor,
      },
    });
    const inv = await prisma.investor.create({
      data: { userId: u.id, displayName: `Investor ${tag}`, whitelistStatus },
    });
    if (depositAmount > 0) {
      await prisma.walletTransaction.create({
        data: {
          type: WalletTransactionType.deposit,
          amount: depositAmount,
          investorId: inv.id,
        },
      });
    }
    return { user: authFor(u.id, UserRole.investor), investorId: inv.id };
  }

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
        sendWhitelistDecision: jest.fn(),
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
    const biz = await prisma.business.create({
      data: {
        userId: bUser.id,
        legalName: 'Supplier Co',
        contactEmail: bUser.email,
      },
    });
    businessId = biz.id;
    businessUser = authFor(bUser.id, UserRole.business);

    const buyer = await prisma.buyer.create({
      data: {
        legalName: 'Debtor Co',
        contactEmail: `debtor-${RUN}@test.example`,
      },
    });
    buyerId = buyer.id;

    ({ user: investorUser, investorId } = await makeInvestor(
      'main',
      WhitelistStatus.whitelisted,
      1_000_000,
    ));
    ({ user: poorInvestorUser } = await makeInvestor(
      'poor',
      WhitelistStatus.whitelisted,
      0,
    ));
    ({ user: pendingInvestorUser, investorId: pendingInvestorId } =
      await makeInvestor('pending', WhitelistStatus.identity_submitted, 0));
  });

  afterAll(async () => {
    await app.close();
  });

  function seedInvoice(data: {
    invoiceNumber: string;
    status: InvoiceStatus;
    amount: number;
    fundedAmount?: number;
  }) {
    return prisma.invoice.create({
      data: {
        invoiceNumber: data.invoiceNumber,
        businessId,
        buyerId,
        amount: data.amount,
        fundedAmount: data.fundedAmount ?? 0,
        dueDate: new Date('2027-06-01'),
        status: data.status,
        platformFeePct: 3,
        reserveContributionPct: 1,
      },
    });
  }

  /** business creates → buyer accepts via magic link → returns the tokenized invoice id. */
  async function createTokenizedInvoice(invoiceNumber: string, amount: number) {
    currentUser = businessUser;
    const res = await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber,
        amount,
        dueDate: '2027-06-01',
        buyerLegalName: 'Debtor Co',
        buyerContactEmail: `debtor-${RUN}@test.example`,
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

  describe('marketplace browsing (open to any investor)', () => {
    it('lists tokenized/funding invoices without a whitelist', async () => {
      currentUser = pendingInvestorUser; // not whitelisted
      await seedInvoice({
        invoiceNumber: `INV-MKT-${RUN}`,
        status: InvoiceStatus.tokenized,
        amount: 50_000,
      });
      const res = await request(httpServer)
        .get('/investor/marketplace')
        .expect(200);
      const body = res.body as {
        total: number;
        data: Array<{ status: string }>;
      };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(
        body.data.every((i) => ['tokenized', 'funding'].includes(i.status)),
      ).toBe(true);
    });
  });

  describe('fundInvoice — full flow', () => {
    it('business creates → buyer accepts → investor funds in full → business paid net', async () => {
      const invoiceId = await createTokenizedInvoice(
        `INV-FULL-${RUN}`,
        100_000,
      );

      currentUser = investorUser;
      const res = await request(httpServer)
        .post(`/investor/marketplace/${invoiceId}/fund`)
        .send({ amount: 100_000 })
        .expect(201);
      expect((res.body as { status: string }).status).toBe(
        InvoiceStatus.funded,
      );

      const invoice = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      expect(invoice.status).toBe(InvoiceStatus.funded);
      expect(Number(invoice.fundedAmount)).toBe(100_000);

      const holding = await prisma.holding.findUniqueOrThrow({
        where: {
          investorId_invoiceId: { investorId, invoiceId },
        },
      });
      expect(Number(holding.amount)).toBe(100_000);

      // net payout = 100000 - 3% - 1% = 96000
      const payout = await prisma.walletTransaction.findFirstOrThrow({
        where: {
          invoiceId,
          businessId,
          type: WalletTransactionType.deposit,
        },
      });
      expect(Number(payout.amount)).toBe(96_000);
    });
  });

  describe('fundInvoice — partial', () => {
    it('keeps the invoice in `funding` and tracks fundedAmount', async () => {
      const invoice = await seedInvoice({
        invoiceNumber: `INV-PARTIAL-${RUN}`,
        status: InvoiceStatus.tokenized,
        amount: 100_000,
      });

      currentUser = investorUser;
      await request(httpServer)
        .post(`/investor/marketplace/${invoice.id}/fund`)
        .send({ amount: 40_000 })
        .expect(201);

      const after = await prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.id },
      });
      expect(after.status).toBe(InvoiceStatus.funding);
      expect(Number(after.fundedAmount)).toBe(40_000);

      // no business payout yet
      const payout = await prisma.walletTransaction.findFirst({
        where: { invoiceId: invoice.id, type: WalletTransactionType.deposit },
      });
      expect(payout).toBeNull();
    });
  });

  describe('fundInvoice — rejections', () => {
    it('403 when the investor is not whitelisted', async () => {
      const inv = await seedInvoice({
        invoiceNumber: `INV-RJ-WL-${RUN}`,
        status: InvoiceStatus.tokenized,
        amount: 100_000,
      });
      currentUser = pendingInvestorUser;
      await request(httpServer)
        .post(`/investor/marketplace/${inv.id}/fund`)
        .send({ amount: 5_000 })
        .expect(403);
    });

    it('400 when the amount is below ₦5,000', async () => {
      const inv = await seedInvoice({
        invoiceNumber: `INV-RJ-MIN-${RUN}`,
        status: InvoiceStatus.tokenized,
        amount: 100_000,
      });
      currentUser = investorUser;
      await request(httpServer)
        .post(`/investor/marketplace/${inv.id}/fund`)
        .send({ amount: 4_999 })
        .expect(400);
    });

    it("400 when the amount exceeds the invoice's remaining balance", async () => {
      const inv = await seedInvoice({
        invoiceNumber: `INV-RJ-REM-${RUN}`,
        status: InvoiceStatus.tokenized,
        amount: 100_000,
        fundedAmount: 90_000,
      });
      currentUser = investorUser;
      await request(httpServer)
        .post(`/investor/marketplace/${inv.id}/fund`)
        .send({ amount: 20_000 })
        .expect(400);
    });

    it('400 when the wallet balance is insufficient', async () => {
      const inv = await seedInvoice({
        invoiceNumber: `INV-RJ-BAL-${RUN}`,
        status: InvoiceStatus.tokenized,
        amount: 100_000,
      });
      currentUser = poorInvestorUser; // whitelisted but balance 0
      await request(httpServer)
        .post(`/investor/marketplace/${inv.id}/fund`)
        .send({ amount: 5_000 })
        .expect(400);
    });

    it('409 when the invoice is not open for investment', async () => {
      const inv = await seedInvoice({
        invoiceNumber: `INV-RJ-STATE-${RUN}`,
        status: InvoiceStatus.submitted,
        amount: 100_000,
      });
      currentUser = investorUser;
      await request(httpServer)
        .post(`/investor/marketplace/${inv.id}/fund`)
        .send({ amount: 5_000 })
        .expect(409);
    });
  });

  describe('whitelisting', () => {
    it('submit moves the status to in_review', async () => {
      currentUser = pendingInvestorUser;
      await request(httpServer)
        .post('/investor/whitelisting')
        .send({ countryOfResidence: 'NG', legalName: 'Ada Pending' })
        .expect(201);

      const res = await request(httpServer)
        .get('/investor/whitelisting')
        .expect(200);
      expect((res.body as { whitelistStatus: string }).whitelistStatus).toBe(
        WhitelistStatus.in_review,
      );

      const row = await prisma.investor.findUniqueOrThrow({
        where: { id: pendingInvestorId },
      });
      expect(row.whitelistStatus).toBe(WhitelistStatus.in_review);
      expect(row.countryOfResidence).toBe('NG');
    });
  });

  describe('portfolio + wallet', () => {
    it('portfolio lists the holding from the full-flow funding', async () => {
      currentUser = investorUser;
      const res = await request(httpServer)
        .get('/investor/portfolio')
        .expect(200);
      const body = res.body as {
        total: number;
        data: Array<{ amount: string; invoice: { invoiceNumber: string } }>;
      };
      expect(body.total).toBeGreaterThanOrEqual(2);
      expect(
        body.data.some((h) => h.invoice.invoiceNumber === `INV-FULL-${RUN}`),
      ).toBe(true);
    });

    it('wallet balance reflects the deposits minus the investments', async () => {
      currentUser = investorUser;
      const res = await request(httpServer).get('/investor/wallet').expect(200);
      // 1,000,000 deposit - 100,000 (full) - 40,000 (partial) = 860,000
      expect((res.body as { balance: number }).balance).toBe(860_000);
    });
  });
});
