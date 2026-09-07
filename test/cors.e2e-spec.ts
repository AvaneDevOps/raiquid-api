import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { ExecutionContext, INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Request } from 'express';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ClerkAuthGuard } from '../src/auth/clerk-auth.guard';
import { configureCors } from '../src/config/cors.config';
import type { Env } from '../src/config/env.validation';

jest.setTimeout(30_000);

// setup-env.ts sets FRONTEND_URL to this.
const FRONTEND_URL = 'http://localhost:3000';

describe('CORS (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ClerkAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<Request>().user = undefined;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    configureCors(app, app.get<ConfigService<Env, true>>(ConfigService));
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows the browser SPA at FRONTEND_URL, with credentials', async () => {
    const res = await request(httpServer)
      .get('/health')
      .set('Origin', FRONTEND_URL)
      .expect(200);
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_URL);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never answers with a wildcard or a foreign origin', async () => {
    // The `cors` middleware pins Access-Control-Allow-Origin to the single
    // configured value. A page at evil.example receives FRONTEND_URL (not its
    // own origin, never `*`), so the browser's same-origin check blocks it.
    const res = await request(httpServer)
      .get('/health')
      .set('Origin', 'https://evil.example')
      .expect(200);
    const allowed = res.headers['access-control-allow-origin'];
    expect(allowed).not.toBe('*');
    expect(allowed).not.toBe('https://evil.example');
    expect(allowed).toBe(FRONTEND_URL);
  });

  it('preflight for FRONTEND_URL is answered with that origin', async () => {
    const res = await request(httpServer)
      .options('/investor/marketplace')
      .set('Origin', FRONTEND_URL)
      .set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe(FRONTEND_URL);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });
});
