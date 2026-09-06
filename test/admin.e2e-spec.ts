import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import type { AuthUser } from '../src/auth/auth-user.type';
import {
  InvoiceStatus,
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
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    // Admin metrics are platform-wide aggregates, so this suite needs a known
    // empty slate to assert exact numbers. Runs after any other suite's
    // afterAll, and before it seeds its own data — safe within one test:e2e
    // run, and clears leftovers from a previous run against the same DB.
    await prisma.$transaction([
      prisma.onChainEvent.deleteMany(),
      prisma.holding.deleteMany(),
      prisma.walletTransaction.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.invoice.deleteMany(),
      prisma.buyer.deleteMany(),
      prisma.investor.deleteMany(),
      prisma.business.deleteMany(),
      prisma.user.deleteMany(),
    ]);

    // Admin needs no profile row — matches how the webhook handles admins.
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

    // --- Buyers: 2 quarried, 1 carried, 1 anchored ---
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

    // --- Invoices across statuses ---
    const mkInvoice = (o: {
      n: string;
      status: InvoiceStatus;
      amount: number;
      fundedAmount: number;
      reserveContributionPct: number;
      dueDate: string;
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
      reserveContributionPct: 2, // different on purpose — proves per-invoice calc
      dueDate: '2027-06-01',
    });
    await mkInvoice({
      n: 'REPAID-OK',
      status: InvoiceStatus.repaid,
      amount: 50_000,
      fundedAmount: 50_000,
      reserveContributionPct: 1,
      dueDate: '2027-01-10', // future vs updatedAt≈now → on time
    });
    await mkInvoice({
      n: 'REPAID-LATE',
      status: InvoiceStatus.repaid,
      amount: 50_000,
      fundedAmount: 50_000,
      reserveContributionPct: 1,
      dueDate: '2020-01-10', // long past vs updatedAt≈now → late
    });

    // --- Investors: 2 whitelisted, 1 pending ---
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

    // --- OnChainEvents (seeded directly; the API never writes this table) ---
    const mkEvent = (action: OnChainAction, status: OnChainStatus) =>
      prisma.onChainEvent.create({ data: { action, status } });
    await mkEvent(OnChainAction.mint, OnChainStatus.confirmed);
    await mkEvent(OnChainAction.mint, OnChainStatus.pending);
    await mkEvent(OnChainAction.transfer, OnChainStatus.confirmed);
    await mkEvent(OnChainAction.burn, OnChainStatus.failed);
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
    ])('403 for a non-admin role on %s', async (path) => {
      currentUser = businessUser;
      await request(httpServer).get(path).expect(403);
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

      // Σ fundedAmount = 0 + 0 + 30000 + 100000 + 50000 + 50000
      expect(body.totalValueFinanced).toBe(230_000);
      // tokenized + funding + funded
      expect(body.activeInvoices).toBe(3);
      // 1 on-time of 2 repaid
      expect(body.onTimeRepaymentRate).toBe(0.5);
      // 2 whitelisted
      expect(body.activeInvestors).toBe(2);
      expect(body.definitions.onTimeRepaymentRate).toMatch(/APPROXIMATION/);
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

      // funded 100000*2% + repaid-ok 50000*1% + repaid-late 50000*1%
      expect(body.reserveBalance).toBe(3_000);
      expect(body.totalValueFinanced).toBe(230_000);
      expect(body.coverageRatio).toBeCloseTo(3_000 / 230_000, 10);
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
      // reputation fields are unpopulated defaults for every buyer
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
        .get('/admin/ledger?action=mint')
        .expect(200);
      expect((mints.body as { total: number }).total).toBe(2);

      const confirmed = await request(httpServer)
        .get('/admin/ledger?status=confirmed')
        .expect(200);
      expect((confirmed.body as { total: number }).total).toBe(2);

      const mintConfirmed = await request(httpServer)
        .get('/admin/ledger?action=mint&status=confirmed')
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
});
