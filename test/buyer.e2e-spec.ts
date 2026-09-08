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
import { InvoiceStatus, UserRole } from '../src/common/enums';

jest.setTimeout(30_000);

describe('Buyer + Confirm (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;

  const sendConfirmationMock = jest.fn().mockResolvedValue(undefined);
  const sendReviewOutcomeMock = jest.fn().mockResolvedValue(undefined);

  let currentUser: AuthUser;
  let businessUser: AuthUser;
  let buyerUser: AuthUser;
  let businessId: string;
  let buyerId: string;

  const RUN = randomUUID();
  const BUYER_EMAIL = `buyer-${RUN}@test.example`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<Request>().user = currentUser;
          return true;
        },
      })
      .overrideProvider(EmailService)
      .useValue({
        sendBuyerConfirmationLink: sendConfirmationMock,
        sendBuyerReviewOutcome: sendReviewOutcomeMock,
        sendWhitelistDecision: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);

    const bUser = await prisma.user.create({
      data: {
        clerkUserId: `clerk_e2e_biz_${RUN}`,
        email: `biz-owner-${RUN}@acme.test`,
        role: UserRole.business,
      },
    });
    const biz = await prisma.business.create({
      data: {
        userId: bUser.id,
        legalName: 'Acme Supplier Co',
        contactEmail: bUser.email,
      },
    });
    businessId = biz.id;
    businessUser = {
      clerkUserId: bUser.clerkUserId,
      sessionId: 's',
      dbUserId: bUser.id,
      role: UserRole.business,
      email: bUser.email,
    };

    const buUser = await prisma.user.create({
      data: {
        clerkUserId: `clerk_e2e_buyer_${RUN}`,
        email: `buyer-acc-${RUN}@acme.test`,
        role: UserRole.buyer,
      },
    });
    const buyerRow = await prisma.buyer.create({
      data: {
        userId: buUser.id,
        legalName: 'Acme Buyer Ltd',
        contactEmail: BUYER_EMAIL,
      },
    });
    buyerId = buyerRow.id;
    buyerUser = {
      clerkUserId: buUser.clerkUserId,
      sessionId: 's',
      dbUserId: buUser.id,
      role: UserRole.buyer,
      email: buUser.email,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  async function createInvoice(invoiceNumber: string, amount = 50000) {
    currentUser = businessUser;
    const res = await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber,
        amount,
        dueDate: '2026-12-01',
        buyerLegalName: 'Acme Buyer Ltd',
        buyerContactEmail: BUYER_EMAIL,
      })
      .expect(201);
    const id = (res.body as { id: string }).id;
    const row = await prisma.invoice.findUniqueOrThrow({
      where: { id },
      select: { confirmToken: true },
    });
    return { id, confirmToken: row.confirmToken as string };
  }

  function seedInvoice(data: {
    invoiceNumber: string;
    status: InvoiceStatus;
    amount: number;
    dueDate: string;
    buyerId?: string;
  }) {
    return prisma.invoice.create({
      data: {
        invoiceNumber: data.invoiceNumber,
        businessId,
        buyerId: data.buyerId ?? buyerId,
        amount: data.amount,
        dueDate: new Date(data.dueDate),
        status: data.status,
      },
    });
  }

  describe('magic-link confirm flow', () => {
    it('accept: loads the confirmation, then tokenizes and notifies the business', async () => {
      const { id, confirmToken } = await createInvoice('INV-CONFIRM-ACCEPT');

      const load = await request(httpServer)
        .get(`/confirm/${confirmToken}`)
        .expect(200);
      const loadBody = load.body as {
        id: string;
        buyer: { contactEmail: string };
        business: { legalName: string };
      };
      expect(loadBody.id).toBe(id);
      expect(loadBody.buyer.contactEmail).toBe(BUYER_EMAIL);
      expect(loadBody.business.legalName).toBe('Acme Supplier Co');

      await request(httpServer)
        .post(`/confirm/${confirmToken}/review`)
        .send({ accept: true })
        .expect(201);

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe(InvoiceStatus.tokenized);
      expect(row.confirmedAt).not.toBeNull();

      expect(sendReviewOutcomeMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          invoiceNumber: 'INV-CONFIRM-ACCEPT',
          accepted: true,
        }),
      );
    });

    it('accept is not replayable — the second review is 409', async () => {
      const { confirmToken } = await createInvoice('INV-CONFIRM-REPLAY');
      await request(httpServer)
        .post(`/confirm/${confirmToken}/review`)
        .send({ accept: true })
        .expect(201);
      await request(httpServer)
        .post(`/confirm/${confirmToken}/review`)
        .send({ accept: true })
        .expect(409);
    });

    it('decline: leaves status unchanged and notifies the business with the note', async () => {
      const { id, confirmToken } = await createInvoice('INV-CONFIRM-DECLINE');
      sendReviewOutcomeMock.mockClear();

      await request(httpServer)
        .post(`/confirm/${confirmToken}/review`)
        .send({ accept: false, note: 'Amount is wrong, expected 40000' })
        .expect(201);

      const row = await prisma.invoice.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe(InvoiceStatus.submitted);
      expect(row.confirmedAt).toBeNull();

      expect(sendReviewOutcomeMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          accepted: false,
          note: 'Amount is wrong, expected 40000',
        }),
      );
    });

    it('an unknown token is 404 on both routes', async () => {
      await request(httpServer).get('/confirm/not-a-real-token').expect(404);
      await request(httpServer)
        .post('/confirm/not-a-real-token/review')
        .send({ accept: true })
        .expect(404);
    });
  });

  describe('authenticated buyer endpoints', () => {
    it("lists this buyer's invoices, paginated", async () => {
      currentUser = buyerUser;
      const res = await request(httpServer)
        .get('/buyer/invoices?pageSize=2')
        .expect(200);
      const body = res.body as {
        total: number;
        pageSize: number;
        data: Array<{ id: string }>;
      };
      expect(body.pageSize).toBe(2);
      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(body.data.length).toBe(2);
    });

    it('gets and updates settings', async () => {
      currentUser = buyerUser;
      await request(httpServer).get('/buyer/settings').expect(200);

      const res = await request(httpServer)
        .patch('/buyer/settings')
        .send({ legalName: 'Acme Buyer Ltd (renamed)' })
        .expect(200);
      expect((res.body as { legalName: string }).legalName).toBe(
        'Acme Buyer Ltd (renamed)',
      );

      const row = await prisma.buyer.findUniqueOrThrow({
        where: { id: buyerId },
      });
      expect(row.legalName).toBe('Acme Buyer Ltd (renamed)');
    });

    it('payment schedule returns only funded/overdue, soonest due first', async () => {
      currentUser = buyerUser;
      await seedInvoice({
        invoiceNumber: 'INV-SCHED-LATE',
        status: InvoiceStatus.overdue,
        amount: 10000,
        dueDate: '2027-02-01',
      });
      await seedInvoice({
        invoiceNumber: 'INV-SCHED-SOON',
        status: InvoiceStatus.funded,
        amount: 20000,
        dueDate: '2027-01-01',
      });

      const res = await request(httpServer)
        .get('/buyer/payment-schedule')
        .expect(200);
      const rows = res.body as Array<{ invoiceNumber: string; status: string }>;
      expect(rows.map((r) => r.invoiceNumber)).toEqual([
        'INV-SCHED-SOON',
        'INV-SCHED-LATE',
      ]);
      expect(rows.every((r) => ['funded', 'overdue'].includes(r.status))).toBe(
        true,
      );
    });
  });

  describe('payInvoice', () => {
    let fundedId: string;
    const FUNDED_AMOUNT = 33000;

    beforeAll(async () => {
      const inv = await seedInvoice({
        invoiceNumber: 'INV-PAY-OK',
        status: InvoiceStatus.funded,
        amount: FUNDED_AMOUNT,
        dueDate: '2027-03-01',
      });
      fundedId = inv.id;
    });

    it('rejects an amount that does not exactly match the invoice', async () => {
      currentUser = buyerUser;
      await request(httpServer)
        .post(`/buyer/invoices/${fundedId}/pay`)
        .send({ amount: FUNDED_AMOUNT - 1 })
        .expect(400);
    });

    it("rejects paying an invoice that is not this buyer's", async () => {
      currentUser = buyerUser;
      const otherBuyer = await prisma.buyer.create({
        data: {
          legalName: 'Someone Else',
          contactEmail: `other-${RUN}@test.example`,
        },
      });
      const otherInv = await seedInvoice({
        invoiceNumber: 'INV-PAY-NOTMINE',
        status: InvoiceStatus.funded,
        amount: 100,
        dueDate: '2027-03-01',
        buyerId: otherBuyer.id,
      });
      await request(httpServer)
        .post(`/buyer/invoices/${otherInv.id}/pay`)
        .send({ amount: 100 })
        .expect(404);
    });

    it('marks a funded invoice repaid on an exact payment', async () => {
      currentUser = buyerUser;
      await request(httpServer)
        .post(`/buyer/invoices/${fundedId}/pay`)
        .send({ amount: FUNDED_AMOUNT })
        .expect(201);

      const row = await prisma.invoice.findUniqueOrThrow({
        where: { id: fundedId },
      });
      expect(row.status).toBe(InvoiceStatus.repaid);
    });
  });
});
