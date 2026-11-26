import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AiStatusService } from '../search/ai-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

// 헬스체크는 DB가 죽어도 200 + db:'down'으로 상태를 말한다(API.md 3.4) — 앱 기동 자체는 유지.
describe('GET /health', () => {
  let app: INestApplication;
  const queryRaw = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
        AiStatusService,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  it('DB가 살아 있으면 db: ok', async () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer() as App)
      .get('/health')
      .expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', ai: 'unknown' });
  });

  it('ai는 프록시가 기록한 마지막 상태를 그대로 보고한다', async () => {
    queryRaw.mockResolvedValue([]);
    app.get(AiStatusService).set('down');
    const res = await request(app.getHttpServer() as App).get('/health');
    expect((res.body as { ai: string }).ai).toBe('down');
    app.get(AiStatusService).set('ok');
  });

  it('DB가 죽으면 200이지만 db: down', async () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));
    const res = await request(app.getHttpServer() as App)
      .get('/health')
      .expect(200);
    expect((res.body as { db: string }).db).toBe('down');
  });
});
