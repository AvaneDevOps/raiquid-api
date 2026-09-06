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
import { ProvenanceTier, UserRole } from '../src/common/enums';
import { PROVENANCE_FEE_SCHEDULE } from '../src/business/provenance-fee-schedule';

interface InvoiceResponse {
  id: string;
  invoiceNumber: string;
  status: string;
  platformFeePct: string;
  reserveContributionPct: string;
  buyer: {
    contactEmail: string;
    legalName: string;
    provenanceTier: ProvenanceTier;
  };
}
interface InvoiceListResponse {
  total: number;
  data: Array<{ id: string }>;
}
interface BusinessSettingsResponse {
  legalName: string;
}

// Cold-starting Prisma's query compiler plus a real DB round trip can exceed
// Jest's 5s default hook timeout under load.
jest.setTimeout(30_000);

// Unique per run — repeated runs against a non-recreated DB (and parallel
// suites) must not collide on User.clerkUserId / User.email or reuse a buyer.
const RUN = randomUUID();
const BUYER_EMAIL = `buyer-${RUN}@acme-buyer.test`;

describe('BusinessController (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let authUser: AuthUser;
  const sendConfirmationMock = jest.fn().mockResolvedValue(undefined);
  let createdInvoiceId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // ClerkAuthGuard is registered globally via APP_GUARD (as a
      // useExisting alias, specifically so it's independently overridable
      // here) — overrideProvider replaces the singleton every APP_GUARD
      // invocation resolves to, without a real Clerk session.
      .overrideProvider(ClerkAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<Request>().user = authUser;
          return true;
        },
      })
      .overrideProvider(EmailService)
      .useValue({
        sendBuyerConfirmationLink: sendConfirmationMock,
        sendWhitelistDecision: jest.fn(),
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    httpServer = app.getHttpServer() as Server;

    prisma = app.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        clerkUserId: `clerk_e2e_business_${RUN}`,
        email: `owner-${RUN}@acme.test`,
        role: UserRole.business,
      },
    });
    await prisma.business.create({
      data: {
        userId: user.id,
        legalName: 'Acme Test Co',
        contactEmail: user.email,
      },
    });

    authUser = {
      clerkUserId: user.clerkUserId,
      sessionId: 'sess_e2e_test',
      dbUserId: user.id,
      role: UserRole.business,
      email: user.email,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an invoice and emails the buyer a confirm link', async () => {
    const res = await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber: 'INV-E2E-001',
        amount: 150000,
        dueDate: '2026-12-01',
        buyerLegalName: 'Acme Buyer Ltd',
        buyerContactEmail: BUYER_EMAIL,
      })
      .expect(201);
    const body = res.body as InvoiceResponse;

    expect(body.invoiceNumber).toBe('INV-E2E-001');
    expect(body.status).toBe('submitted');
    expect(body.buyer.contactEmail).toBe(BUYER_EMAIL);

    // Fresh buyer, so the schema default tier; fees come from the schedule
    // for that tier, never from the request body.
    expect(body.buyer.provenanceTier).toBe(ProvenanceTier.quarried);
    const expectedFees = PROVENANCE_FEE_SCHEDULE[body.buyer.provenanceTier];
    expect(Number(body.platformFeePct)).toBe(expectedFees.platformFeePct);
    expect(Number(body.reserveContributionPct)).toBe(
      expectedFees.reserveContributionPct,
    );

    expect(sendConfirmationMock).toHaveBeenCalledTimes(1);
    const [to, confirmUrl] = sendConfirmationMock.mock.calls[0] as string[];
    expect(to).toBe(BUYER_EMAIL);
    expect(confirmUrl).toContain('/confirm/');

    createdInvoiceId = body.id;
  });

  it('rejects a request that tries to set fees in the body', async () => {
    await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber: 'INV-E2E-FEE',
        amount: 1000,
        dueDate: '2026-12-01',
        buyerLegalName: 'Fee Setter Ltd',
        buyerContactEmail: `fee-setter-${RUN}@test.example`,
        platformFeePct: 0,
        reserveContributionPct: 0,
      })
      .expect(400);
  });

  it('reads the invoice back by id', async () => {
    const res = await request(httpServer)
      .get(`/business/invoices/${createdInvoiceId}`)
      .expect(200);
    const body = res.body as InvoiceResponse;

    expect(body.id).toBe(createdInvoiceId);
    expect(body.invoiceNumber).toBe('INV-E2E-001');
    expect(body.buyer.legalName).toBe('Acme Buyer Ltd');
  });

  it('lists invoices and includes the created one', async () => {
    const res = await request(httpServer).get('/business/invoices').expect(200);
    const body = res.body as InvoiceListResponse;

    expect(body.total).toBeGreaterThanOrEqual(1);
    expect(body.data.some((inv) => inv.id === createdInvoiceId)).toBe(true);
  });

  it('rejects a second invoice with the same invoice number', async () => {
    await request(httpServer)
      .post('/business/invoices')
      .send({
        invoiceNumber: 'INV-E2E-001',
        amount: 1000,
        dueDate: '2026-12-01',
        buyerLegalName: 'Someone Else',
        buyerContactEmail: `someone-else-${RUN}@test.example`,
      })
      .expect(409);
  });

  it('updates settings and persists the change', async () => {
    const res = await request(httpServer)
      .patch('/business/settings')
      .send({ legalName: 'Acme Test Co (Updated)' })
      .expect(200);
    const body = res.body as BusinessSettingsResponse;

    expect(body.legalName).toBe('Acme Test Co (Updated)');

    const persisted = await prisma.business.findUnique({
      where: { userId: authUser.dbUserId },
    });
    expect(persisted?.legalName).toBe('Acme Test Co (Updated)');
  });
});
