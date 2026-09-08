import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { Webhook } from 'svix';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import type { Env } from '../src/config/env.validation';

jest.setTimeout(30_000);

describe('WebhooksController (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let sign: (payload: string) => {
    id: string;
    timestamp: string;
    signature: string;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    httpServer = app.getHttpServer() as Server;

    prisma = app.get(PrismaService);
    const secret = app
      .get<ConfigService<Env, true>>(ConfigService)
      .get('CLERK_WEBHOOK_SECRET', { infer: true });
    const webhook = new Webhook(secret);

    sign = (payload: string) => {
      const id = `msg_${randomUUID()}`;
      const timestamp = new Date();
      return {
        id,
        timestamp: String(Math.floor(timestamp.getTime() / 1000)),
        signature: webhook.sign(id, timestamp, payload),
      };
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('provisions a User + Business row on a signed user.created event, and a redelivery of the same payload does not duplicate it', async () => {
    const clerkUserId = `user_e2e_${randomUUID()}`;
    const email = `webhook-e2e-${randomUUID()}@acme.test`;
    const payload = JSON.stringify({
      type: 'user.created',
      data: {
        id: clerkUserId,
        email_addresses: [{ id: 'idn_1', email_address: email }],
        primary_email_address_id: 'idn_1',
        first_name: 'Webhook',
        last_name: 'Tester',
        public_metadata: { role: 'business' },
        unsafe_metadata: {},
      },
    });
    const { id, timestamp, signature } = sign(payload);

    await request(httpServer)
      .post('/webhooks/clerk')
      .set('svix-id', id)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user).toMatchObject({ email, role: 'business' });

    const business = await prisma.business.findUnique({
      where: { userId: user!.id },
    });
    expect(business).toMatchObject({ contactEmail: email });

    await request(httpServer)
      .post('/webhooks/clerk')
      .set('svix-id', id)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    const usersWithClerkId = await prisma.user.count({
      where: { clerkUserId },
    });
    expect(usersWithClerkId).toBe(1);
  });

  it('skips provisioning when the role is missing', async () => {
    const clerkUserId = `user_e2e_norole_${randomUUID()}`;
    const payload = JSON.stringify({
      type: 'user.created',
      data: {
        id: clerkUserId,
        email_addresses: [
          { id: 'idn_1', email_address: `no-role-${randomUUID()}@acme.test` },
        ],
        primary_email_address_id: 'idn_1',
        first_name: null,
        last_name: null,
        public_metadata: {},
        unsafe_metadata: {},
      },
    });
    const { id, timestamp, signature } = sign(payload);

    await request(httpServer)
      .post('/webhooks/clerk')
      .set('svix-id', id)
      .set('svix-timestamp', timestamp)
      .set('svix-signature', signature)
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(200);

    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    expect(user).toBeNull();
  });

  it('rejects a payload with a bad signature', async () => {
    const payload = JSON.stringify({
      type: 'user.created',
      data: { id: 'user_bad_sig', email_addresses: [] },
    });

    await request(httpServer)
      .post('/webhooks/clerk')
      .set('svix-id', 'msg_bad')
      .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
      .set('svix-signature', 'v1,not-a-real-signature')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(401);
  });
});
