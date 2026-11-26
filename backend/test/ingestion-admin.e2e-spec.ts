// 관리자 수집 요청의 활성 실행 판정(REVIEW Y5): 배치가 강제 종료돼 RUNNING으로 남은 오래된 run이 영구 409를 만들지 않는다.
import request from 'supertest';
import {
  createTestApp,
  createUser,
  login,
  resetDb,
  type TestApp,
} from './support/app';

describe('수집 요청 — 오래된 RUNNING run', () => {
  let t: TestApp;
  let token: string;
  const post = () =>
    request(t.http())
      .post('/api/admin/ingestion/runs')
      .set({ Authorization: `Bearer ${token}` })
      .send({});
  const run = (hoursAgo: number) =>
    t.prisma.ingestionRun.create({
      data: {
        trigger: 'CRON',
        asOf: new Date('2026-11-20'),
        status: 'RUNNING',
        startedAt: new Date(Date.now() - hoursAgo * 3_600_000),
      },
    });

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDb(t.prisma);
    await createUser(t.prisma, { email: 'ops@example.com', role: 'ADMIN' });
    token = await login(t, 'ops@example.com');
  });

  it('시작 3시간 넘은 RUNNING은 활성으로 보지 않아 새 요청이 202', async () => {
    await run(5);
    await post().expect(202);
  });

  it('방금 시작한 RUNNING은 여전히 409', async () => {
    await run(0);
    await post().expect(409);
  });
});
