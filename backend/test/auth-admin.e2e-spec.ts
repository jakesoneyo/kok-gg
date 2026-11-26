// IT-13(데모 관리자 읽기 전용) · IT-14(admin 로그인 예외 범위) + 관리자 조회·처리 엔드포인트.
import { Client } from 'pg';
import request from 'supertest';
import {
  createTestApp,
  createUser,
  login,
  resetDb,
  type TestApp,
} from './support/app';
import { createRepo } from './support/factories';

describe('auth · admin', () => {
  let t: TestApp;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const post = (url: string, body: object, token?: string) => {
    const r = request(t.http()).post(url).send(body);
    return token ? r.set(auth(token)) : r;
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDb(t.prisma);
    process.env.DEMO_ADMIN_READONLY = 'false';
  });
  afterEach(() => {
    process.env.DEMO_ADMIN_READONLY = 'false';
  });

  describe('IT-14 데모 로그인', () => {
    it('admin 로그인 200 / 형식 위반 400 / admin으로 가입 400 / 틀린 비번 401', async () => {
      await createUser(t.prisma, {
        email: 'admin',
        password: 'admin',
        role: 'ADMIN',
      });
      const ok = await post('/api/auth/login', {
        email: 'admin',
        password: 'admin',
      }).expect(200);
      expect((ok.body as { user: { role: string } }).user.role).toBe('ADMIN');

      await post('/api/auth/login', {
        email: 'not-an-email',
        password: 'admin',
      }).expect(400);
      await post('/api/auth/register', {
        email: 'admin',
        password: 'admin1234',
        name: 'x',
      }).expect(400);
      const wrong = await post('/api/auth/login', {
        email: 'admin',
        password: 'nope',
      }).expect(401);
      expect((wrong.body as { code: string }).code).toBe(
        'AUTH_INVALID_CREDENTIALS',
      );
    });

    it('/auth/me는 isDemo를 알려준다', async () => {
      await createUser(t.prisma, {
        email: 'admin',
        password: 'admin',
        role: 'ADMIN',
      });
      const token = await login(t, 'admin');
      const me = await request(t.http()).get('/api/auth/me').set(auth(token));
      expect(me.body).toMatchObject({ email: 'admin', isDemo: true });
    });
  });

  describe('refresh 회전 (REVIEW Y3)', () => {
    it('같은 refresh 토큰 동시 2요청: 정확히 1건만 회전, 나머지는 재사용으로 거절 + 계열 폐기', async () => {
      await createUser(t.prisma, {
        email: 'u@example.com',
        password: 'password1',
      });
      const { refreshToken } = (
        await post('/api/auth/login', {
          email: 'u@example.com',
          password: 'password1',
        }).expect(200)
      ).body as { refreshToken: string };

      const results = await Promise.all(
        [1, 2, 3].map(() => post('/api/auth/refresh', { refreshToken })),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 401, 401]);
      expect(
        results
          .filter((r) => r.status === 401)
          .map((r) => (r.body as { code: string }).code),
      ).toEqual(['AUTH_REFRESH_REUSE', 'AUTH_REFRESH_REUSE']);

      // 재사용 탐지로 계열이 모두 폐기돼 유효한 토큰이 남지 않는다.
      const alive = await t.prisma.refreshToken.count({
        where: { revokedAt: null },
      });
      expect(alive).toBe(0);
    });
  });

  describe('IT-13 DEMO_ADMIN_READONLY', () => {
    it('데모 관리자: 변경 403 DEMO_READ_ONLY / 조회 200, 일반 ADMIN: 변경 허용', async () => {
      await createUser(t.prisma, {
        email: 'admin',
        password: 'admin',
        role: 'ADMIN',
      });
      await createUser(t.prisma, {
        email: 'ops@example.com',
        password: 'password1',
        role: 'ADMIN',
      });
      const demo = await login(t, 'admin');
      const ops = await login(t, 'ops@example.com');
      process.env.DEMO_ADMIN_READONLY = 'true';

      const blocked = await post('/api/admin/ingestion/runs', {}, demo).expect(
        403,
      );
      expect((blocked.body as { code: string }).code).toBe('DEMO_READ_ONLY');
      await request(t.http())
        .get('/api/admin/ingestion/runs')
        .set(auth(demo))
        .expect(200);
      const created = await post('/api/admin/ingestion/runs', {}, ops).expect(
        202,
      );
      expect(created.body).toMatchObject({ dispatched: false });

      // 플래그가 꺼져 있으면 데모 계정도 통과(로컬 개발).
      process.env.DEMO_ADMIN_READONLY = 'false';
      await request(t.http())
        .patch('/api/admin/data-quality/issues/1')
        .set(auth(demo))
        .send({ status: 'RESOLVED', note: 'x' })
        .expect(404); // 가드는 통과, 대상 없음
    });

    it('일반 사용자·비로그인은 관리자 API 403/401', async () => {
      await createUser(t.prisma);
      const user = await login(t, 'user@example.com');
      const res = await request(t.http())
        .get('/api/admin/ingestion/runs')
        .set(auth(user))
        .expect(403);
      expect((res.body as { code: string }).code).toBe('FORBIDDEN');
      await request(t.http()).get('/api/admin/ingestion/runs').expect(401);
    });

    it('토큰의 role이 ADMIN이어도 DB에서 강등됐으면 403', async () => {
      const u = await createUser(t.prisma, {
        email: 'x@example.com',
        role: 'ADMIN',
      });
      const token = await login(t, 'x@example.com');
      await t.prisma.user.update({
        where: { id: u.id },
        data: { role: 'USER' },
      });
      await request(t.http())
        .get('/api/admin/ingestion/runs')
        .set(auth(token))
        .expect(403);
    });
  });

  describe('수집 실행', () => {
    let token: string;
    beforeEach(async () => {
      await createUser(t.prisma, { email: 'ops@example.com', role: 'ADMIN' });
      token = await login(t, 'ops@example.com');
    });

    it('활성 실행이 있으면 409 RUN_ALREADY_ACTIVE, 단계 중복·미지 단계는 400', async () => {
      await post(
        '/api/admin/ingestion/runs',
        { stages: ['DISCOVER', 'QUALIFY'] },
        token,
      ).expect(202);
      const dup = await post('/api/admin/ingestion/runs', {}, token).expect(
        409,
      );
      expect((dup.body as { code: string }).code).toBe('RUN_ALREADY_ACTIVE');

      await t.prisma.ingestionRun.updateMany({ data: { status: 'SUCCEEDED' } });
      await post(
        '/api/admin/ingestion/runs',
        { stages: ['DISCOVER', 'DISCOVER'] },
        token,
      ).expect(400);
      await post(
        '/api/admin/ingestion/runs',
        { stages: ['NOPE'] },
        token,
      ).expect(400);
    });

    it('목록 커서 페이지네이션과 상세(단계·실패 + 저장소 이름)', async () => {
      const repo = await createRepo(t.prisma);
      const ids: number[] = [];
      for (let i = 0; i < 3; i++) {
        const run = await t.prisma.ingestionRun.create({
          data: {
            trigger: 'MANUAL',
            asOf: new Date('2026-11-24'),
            status: 'SUCCEEDED',
          },
        });
        ids.push(run.id);
      }
      const run = ids[2];
      await t.prisma.ingestionStage.create({
        data: {
          runId: run,
          stage: 'DISCOVER',
          status: 'DONE',
          stats: { processed: 3 },
        },
      });
      await t.prisma.ingestionFailure.create({
        data: {
          runId: run,
          stage: 'DISCOVER',
          repoId: repo.id,
          code: 'GH_404',
          message: 'not found',
        },
      });

      const p1 = (
        await request(t.http())
          .get('/api/admin/ingestion/runs?limit=2')
          .set(auth(token))
          .expect(200)
      ).body as {
        items: { id: number; failureCount: number }[];
        nextCursor: string;
      };
      expect(p1.items.map((r) => r.id)).toEqual([ids[2], ids[1]]);
      expect(p1.items[0].failureCount).toBe(1);
      const p2 = (
        await request(t.http())
          .get(`/api/admin/ingestion/runs?limit=2&cursor=${p1.nextCursor}`)
          .set(auth(token))
          .expect(200)
      ).body as { items: { id: number }[]; nextCursor: string | null };
      expect(p2.items.map((r) => r.id)).toEqual([ids[0]]);
      expect(p2.nextCursor).toBeNull();

      const detail = (
        await request(t.http())
          .get(`/api/admin/ingestion/runs/${run}`)
          .set(auth(token))
          .expect(200)
      ).body as {
        stages: { stage: string }[];
        failures: { repoFullName: string; code: string }[];
      };
      expect(detail.stages[0].stage).toBe('DISCOVER');
      expect(detail.failures[0]).toMatchObject({
        repoFullName: `${repo.owner}/${repo.name}`,
        code: 'GH_404',
      });
      await request(t.http())
        .get('/api/admin/ingestion/runs/999')
        .set(auth(token))
        .expect(404);
    });
  });

  describe('데이터 품질', () => {
    let token: string;
    beforeEach(async () => {
      await createUser(t.prisma, { email: 'ops@example.com', role: 'ADMIN' });
      token = await login(t, 'ops@example.com');
    });

    it('이슈 목록 필터 · 처리(RESOLVED) · 요약의 openByKind', async () => {
      const repo = await createRepo(t.prisma);
      const mk = (kind: 'STAR_ANOMALY' | 'STAR_SOURCE_MISMATCH') =>
        t.prisma.dataQualityIssue.create({
          data: {
            kind,
            repoId: repo.id,
            windowStart: new Date('2026-11-17'),
            windowEnd: new Date('2026-11-24'),
            values: { snapshot: 10 },
            diff: 4,
          },
        });
      const a = await mk('STAR_ANOMALY');
      await mk('STAR_SOURCE_MISMATCH');

      const list = (
        await request(t.http())
          .get('/api/admin/data-quality/issues?kind=STAR_ANOMALY')
          .set(auth(token))
          .expect(200)
      ).body as { items: { id: number; repo: { fullName: string } }[] };
      expect(list.items.map((i) => i.id)).toEqual([a.id]);
      expect(list.items[0].repo.fullName).toBe(`${repo.owner}/${repo.name}`);

      await request(t.http())
        .patch(`/api/admin/data-quality/issues/${a.id}`)
        .set(auth(token))
        .send({ status: 'RESOLVED', note: '언스타 시차' })
        .expect(200);
      await request(t.http())
        .patch(`/api/admin/data-quality/issues/${a.id}`)
        .set(auth(token))
        .send({ status: 'OPEN', note: 'x' })
        .expect(400);

      const open = (
        await request(t.http())
          .get('/api/admin/data-quality/issues')
          .set(auth(token))
      ).body as { items: unknown[] };
      expect(open.items).toHaveLength(1);

      const summary = (
        await request(t.http())
          .get('/api/admin/data-quality/summary')
          .set(auth(token))
          .expect(200)
      ).body as {
        openByKind: Record<string, number>;
        lastRun: unknown;
        aiUsageToday: unknown[];
        externalSource: { name: string };
      };
      expect(summary.openByKind).toMatchObject({
        STAR_ANOMALY: 0,
        STAR_SOURCE_MISMATCH: 1,
        OFFICIAL_HISTORY_FAILED: 0,
      });
      expect(summary.lastRun).toBeNull();
      expect(summary.externalSource.name).toBe('none');
    });

    it('요약: 마지막 실행의 GitHub 사용량 합산 + 오늘 AI 예산(뷰)', async () => {
      const run = await t.prisma.ingestionRun.create({
        data: {
          trigger: 'CRON',
          asOf: new Date('2026-11-24'),
          status: 'PARTIAL',
        },
      });
      await t.prisma.ingestionStage.createMany({
        data: [
          {
            runId: run.id,
            stage: 'DISCOVER',
            stats: { ghSearchUsed: 5, ghCodeSearchUsed: 2 },
          },
          { runId: run.id, stage: 'QUALIFY', stats: { ghCoreUsed: 40 } },
        ],
      });
      const ai = new Client({ connectionString: process.env.AI_DATABASE_URL });
      await ai.connect();
      await ai.query(
        `INSERT INTO ai.budget_day (day, pool, cap_micros, spent_micros)
         VALUES ((now() AT TIME ZONE 'utc')::date, 'SEARCH', 1000000, 250000)`,
      );
      await ai.end();

      const summary = (
        await request(t.http())
          .get('/api/admin/data-quality/summary')
          .set(auth(token))
          .expect(200)
      ).body as {
        lastRun: Record<string, unknown>;
        aiUsageToday: Record<string, unknown>[];
      };
      expect(summary.lastRun).toEqual({
        id: run.id,
        status: 'PARTIAL',
        ghCoreUsed: 40,
        ghSearchUsed: 5,
        ghCodeSearchUsed: 2,
      });
      expect(summary.aiUsageToday).toEqual([
        { pool: 'SEARCH', capUsd: 1, spentUsd: 0.25, reservedUsd: 0, calls: 0 },
      ]);
    });
  });
});
