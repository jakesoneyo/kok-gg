// IT-15(검색 레이트리밋) · IT-17(FastAPI 미응답) + 검색 프록시 매핑 + 북마크(PUT 멱등·변경 탭·ack).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import {
  createTestApp,
  createUser,
  login,
  resetDb,
  type TestApp,
} from './support/app';
import { createItem, createRepo } from './support/factories';

describe('search · bookmarks', () => {
  let t: TestApp;
  let fake: Server;
  /** 가짜 FastAPI: 요청마다 handler가 응답을 정한다. */
  let handler: (path: string, token: string | undefined) => [number, object];
  let seen: { path: string; body: unknown; token?: string }[];

  beforeAll(async () => {
    fake = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const token = req.headers['x-internal-token'] as string | undefined;
        seen.push({ path: req.url!, body: JSON.parse(raw || '{}'), token });
        const [status, body] = handler(req.url!, token);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    process.env.AI_BASE_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    process.env.INTERNAL_API_TOKEN = 'internal-secret';
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
    await new Promise((r) => fake.close(r));
  });
  beforeEach(async () => {
    seen = [];
    handler = () => [200, {}];
    await resetDb(t.prisma);
  });

  describe('검색 프록시', () => {
    it('itemId를 ItemCard로 채우고(AI 순서 유지) 사라진 항목은 뺀다, 내부 토큰을 싣는다', async () => {
      const repo = await createRepo(t.prisma);
      const a = await createItem(t.prisma, repo.id, { name: 'alpha' });
      const b = await createItem(t.prisma, repo.id, { name: 'beta' });
      handler = () => [
        200,
        {
          query: 'lint hook',
          degraded: false,
          indexVersion: 7,
          items: [
            {
              itemId: b.id,
              score: 0.9,
              ranks: { bm25: 2, vector: 1 },
              snippetKo: '문장',
            },
            {
              itemId: 99999,
              score: 0.5,
              ranks: { bm25: 1, vector: null },
              snippetKo: null,
            },
            {
              itemId: a.id,
              score: 0.4,
              ranks: { bm25: 3, vector: 2 },
              snippetKo: null,
            },
          ],
        },
      ];
      const res = await request(t.http())
        .get('/api/search?q=%20lint%20hook%20&kind=HOOK')
        .expect(200);
      const body = res.body as {
        items: { item: { name: string }; snippetKo: string | null }[];
        indexVersion: number;
      };
      expect(body.items.map((i) => i.item.name)).toEqual(['beta', 'alpha']);
      expect(body.indexVersion).toBe(7);
      expect(res.headers['cache-control']).toContain('s-maxage=300');
      expect(seen[0]).toMatchObject({
        path: '/internal/search',
        token: 'internal-secret',
        body: { q: 'lint hook', kind: 'HOOK', limit: 10 }, // trim 적용
      });
    });

    it('degraded 응답은 s-maxage=60으로 낮춘다', async () => {
      handler = () => [
        200,
        { query: 'x', degraded: true, indexVersion: 1, items: [] },
      ];
      const res = await request(t.http()).get('/api/search?q=x').expect(200);
      expect(res.headers['cache-control']).toContain('s-maxage=60');
    });

    it('입력 검증: 빈 질의·긴 질의·미지 파라미터·limit>10은 400이고 AI를 부르지 않는다', async () => {
      for (const qs of [
        'q=%20%20',
        `q=${'a'.repeat(201)}`,
        'q=x&foo=1',
        'q=x&limit=11',
        '',
      ]) {
        await request(t.http()).get(`/api/search?${qs}`).expect(400);
      }
      expect(seen).toHaveLength(0);
    });

    it('FastAPI 4xx/5xx(내부 토큰 불일치 포함)는 503 SEARCH_UNAVAILABLE', async () => {
      handler = () => [401, {}];
      const res = await request(t.http()).get('/api/search?q=x').expect(503);
      expect((res.body as { code: string }).code).toBe('SEARCH_UNAVAILABLE');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('answer 프록시 + 계약과 다른 응답은 SEARCH_UNAVAILABLE', async () => {
      handler = () => [
        200,
        { answerKo: '답', citedItemIds: [1], degraded: false, reason: null },
      ];
      const ok = await request(t.http())
        .get('/api/search/answer?q=x')
        .expect(200);
      expect(ok.body).toMatchObject({ answerKo: '답' });
      handler = () => [200, { nope: true }];
      await request(t.http()).get('/api/search/answer?q=x').expect(503);
    });

    it('/health의 ai는 마지막 호출 결과를 반영하고 FastAPI를 깨우지 않는다', async () => {
      handler = () => [
        200,
        { query: 'x', degraded: false, indexVersion: 1, items: [] },
      ];
      await request(t.http()).get('/api/search?q=x').expect(200);
      seen = [];
      const h = await request(t.http()).get('/health').expect(200);
      expect(h.body).toMatchObject({ db: 'ok', ai: 'ok' });
      expect(seen).toHaveLength(0);

      handler = () => [500, {}];
      await request(t.http()).get('/api/search?q=y').expect(503);
      const h2 = await request(t.http()).get('/health').expect(200);
      expect((h2.body as { ai: string }).ai).toBe('down');
    });
  });

  describe('IT-17 FastAPI 미응답', () => {
    it('연결 실패는 503 SEARCH_WARMING + Retry-After + no-store', async () => {
      const saved = process.env.AI_BASE_URL;
      process.env.AI_BASE_URL = 'http://127.0.0.1:1'; // 닫힌 포트
      try {
        const res = await request(t.http()).get('/api/search?q=x').expect(503);
        expect((res.body as { code: string }).code).toBe('SEARCH_WARMING');
        expect(res.headers['retry-after']).toBe('30');
        expect(res.headers['cache-control']).toBe('private, no-store');
        const h = await request(t.http()).get('/health');
        expect((h.body as { ai: string }).ai).toBe('down');
      } finally {
        process.env.AI_BASE_URL = saved;
      }
    });
  });

  describe('IT-15 레이트리밋', () => {
    it('같은 IP 검색 21회 → 21번째 429 RATE_LIMITED + Retry-After', async () => {
      const fresh = await createTestApp(); // 한도 카운터가 깨끗한 앱
      try {
        handler = () => [
          200,
          { query: 'x', degraded: false, indexVersion: 1, items: [] },
        ];
        for (let i = 0; i < 20; i++) {
          await request(fresh.http()).get(`/api/search?q=q${i}`).expect(200);
        }
        const res = await request(fresh.http())
          .get('/api/search?q=q21')
          .expect(429);
        expect((res.body as { code: string }).code).toBe('RATE_LIMITED');
        expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        expect(res.headers['cache-control']).toBe('private, no-store');
        // 검색 한도는 다른 엔드포인트를 막지 않는다.
        await request(fresh.http()).get('/api/stats/overview').expect(200);
      } finally {
        await fresh.app.close();
      }
    });

    it('전역 기본 한도 120/분: 121번째 429', async () => {
      process.env.THROTTLE_DEFAULT_LIMIT = '120';
      const fresh = await createTestApp();
      try {
        for (let i = 0; i < 120; i++) {
          await request(fresh.http()).get('/api/stats/overview').expect(200);
        }
        await request(fresh.http()).get('/api/stats/overview').expect(429);
      } finally {
        process.env.THROTTLE_DEFAULT_LIMIT = '100000';
        await fresh.app.close();
      }
    });

    it('끝 슬래시·대소문자로 이름 있는 한도를 우회할 수 없다 (B3)', async () => {
      const fresh = await createTestApp();
      try {
        handler = () => [
          200,
          { query: 'x', degraded: false, indexVersion: 1, items: [] },
        ];
        const forms = [
          '/api/search',
          '/api/search/',
          '/API/Search',
          '/API/SEARCH/',
        ];
        for (let i = 0; i < 20; i++) {
          await request(fresh.http())
            .get(`${forms[i % forms.length]}?q=q${i}`)
            .expect(200);
        }
        await request(fresh.http()).get('/api/search/?q=over').expect(429);
        await request(fresh.http()).get('/API/SEARCH?q=over').expect(429);

        for (let i = 0; i < 10; i++) {
          await request(fresh.http())
            .post(i % 2 ? '/api/auth/login/' : '/API/Auth/Login')
            .send({ email: 'nobody@example.com', password: 'x' })
            .expect(401);
        }
        await request(fresh.http())
          .post('/api/auth/login/')
          .send({ email: 'nobody@example.com', password: 'x' })
          .expect(429);
      } finally {
        await fresh.app.close();
      }
    });

    it('answer 5/분, 로그인 10/분은 각자 따로 센다', async () => {
      const fresh = await createTestApp();
      try {
        handler = () => [
          200,
          {
            answerKo: null,
            citedItemIds: [],
            degraded: false,
            reason: 'NO_RESULTS',
          },
        ];
        for (let i = 0; i < 5; i++) {
          await request(fresh.http()).get('/api/search/answer?q=x').expect(200);
        }
        await request(fresh.http()).get('/api/search/answer?q=x').expect(429);
        for (let i = 0; i < 10; i++) {
          await request(fresh.http())
            .post('/api/auth/login')
            .send({ email: 'nobody@example.com', password: 'x' })
            .expect(401);
        }
        await request(fresh.http())
          .post('/api/auth/login')
          .send({ email: 'nobody@example.com', password: 'x' })
          .expect(429);
      } finally {
        await fresh.app.close();
      }
    });
  });

  describe('북마크', () => {
    let token: string;
    const auth = () => ({ Authorization: `Bearer ${token}` });
    beforeEach(async () => {
      await createUser(t.prisma);
      token = await login(t, 'user@example.com');
    });

    it('PUT 멱등(201 → 200), seenLevel = 저장 시점 등급, DELETE는 없어도 204', async () => {
      const repo = await createRepo(t.prisma);
      const item = await createItem(t.prisma, repo.id, {
        currentLevel: 'CAUTION',
      });
      const put = () =>
        request(t.http()).put(`/api/me/bookmarks/${item.id}`).set(auth());
      const first = await put().expect(201);
      expect(first.body).toMatchObject({
        itemId: item.id,
        seenLevel: 'CAUTION',
      });
      await put().expect(200);
      expect(await t.prisma.bookmark.count()).toBe(1);

      const ids = await request(t.http())
        .get('/api/me/bookmarks/ids')
        .set(auth());
      expect(ids.body).toEqual({ itemIds: [item.id] });

      await request(t.http())
        .delete(`/api/me/bookmarks/${item.id}`)
        .set(auth())
        .expect(204);
      await request(t.http())
        .delete(`/api/me/bookmarks/${item.id}`)
        .set(auth())
        .expect(204);
      await request(t.http())
        .put('/api/me/bookmarks/99999')
        .set(auth())
        .expect(404);
      await request(t.http())
        .put('/api/me/bookmarks/abc')
        .set(auth())
        .expect(400);
      await request(t.http()).put(`/api/me/bookmarks/${item.id}`).expect(401);
    });

    it('목록: 최근 저장순 + 커서, 다른 사용자 북마크는 보이지 않는다', async () => {
      const repo = await createRepo(t.prisma);
      const other = await createUser(t.prisma, { email: 'other@example.com' });
      const me = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'user@example.com' },
      });
      const items: Awaited<ReturnType<typeof createItem>>[] = [];
      for (let i = 0; i < 3; i++)
        items.push(await createItem(t.prisma, repo.id));
      for (const [i, it] of items.entries()) {
        await t.prisma.bookmark.create({
          data: {
            userId: me.id,
            itemId: it.id,
            createdAt: new Date(Date.UTC(2026, 10, 1 + i)),
          },
        });
      }
      await t.prisma.bookmark.create({
        data: { userId: other.id, itemId: items[0].id },
      });

      type L = { items: { item: { id: number } }[]; nextCursor: string | null };
      const p1 = (
        await request(t.http())
          .get('/api/me/bookmarks?limit=2')
          .set(auth())
          .expect(200)
      ).body as L;
      expect(p1.items.map((b) => b.item.id)).toEqual([
        items[2].id,
        items[1].id,
      ]);
      const p2 = (
        await request(t.http())
          .get(`/api/me/bookmarks?limit=2&cursor=${p1.nextCursor}`)
          .set(auth())
          .expect(200)
      ).body as L;
      expect(p2.items.map((b) => b.item.id)).toEqual([items[0].id]);
      expect(p2.nextCursor).toBeNull();
    });

    it('변경 탭: IS DISTINCT FROM(null↔등급 포함) → ack 후 사라진다', async () => {
      const repo = await createRepo(t.prisma);
      const me = await t.prisma.user.findUniqueOrThrow({
        where: { email: 'user@example.com' },
      });
      const changed = await createItem(t.prisma, repo.id, {
        currentLevel: 'DANGER',
        levelChangedAt: new Date(),
      });
      const unchanged = await createItem(t.prisma, repo.id, {
        currentLevel: 'SAFE',
      });
      const fromNull = await createItem(t.prisma, repo.id, {
        currentLevel: 'CAUTION',
      }); // 저장 시 미분석(null)
      const bothNull = await createItem(t.prisma, repo.id, {
        currentLevel: null,
      });
      const scan = await t.prisma.securityScan.create({
        data: {
          itemId: changed.id,
          headSha: 'c'.repeat(40),
          ruleSetVersion: '1.0.0',
          status: 'ANALYZED',
          rawLevel: 'DANGER',
          level: 'DANGER',
        },
      });
      await t.prisma.item.update({
        where: { id: changed.id },
        data: { currentScanId: scan.id },
      });
      await t.prisma.securityFinding.createMany({
        data: [
          {
            scanId: scan.id,
            ruleId: 'R01_REMOTE_PIPE_EXEC',
            severity: 'DANGER',
            filePath: 'a.sh',
            line: 1,
            excerpt: 'x',
            fingerprint: '1'.repeat(64),
          },
          {
            scanId: scan.id,
            ruleId: 'R01_REMOTE_PIPE_EXEC',
            severity: 'DANGER',
            filePath: 'b.sh',
            line: 2,
            excerpt: 'x',
            fingerprint: '2'.repeat(64),
          },
          {
            scanId: scan.id,
            ruleId: 'R03_X',
            severity: 'CAUTION',
            filePath: 'c.sh',
            line: 2,
            excerpt: 'x',
            fingerprint: '3'.repeat(64),
            suppressed: true,
          },
        ],
      });
      await t.prisma.bookmark.createMany({
        data: [
          { userId: me.id, itemId: changed.id, seenLevel: 'SAFE' },
          { userId: me.id, itemId: unchanged.id, seenLevel: 'SAFE' },
          { userId: me.id, itemId: fromNull.id, seenLevel: null },
          { userId: me.id, itemId: bothNull.id, seenLevel: null },
        ],
      });

      type C = {
        items: {
          item: { id: number };
          seenLevel: string | null;
          currentLevel: string | null;
          newFindings: { ruleId: string }[];
        }[];
      };
      const res = (
        await request(t.http())
          .get('/api/me/bookmarks/security-changes')
          .set(auth())
          .expect(200)
      ).body as C;
      expect(res.items.map((i) => i.item.id).sort()).toEqual(
        [changed.id, fromNull.id].sort(),
      );
      const c = res.items.find((i) => i.item.id === changed.id)!;
      expect(c).toMatchObject({ seenLevel: 'SAFE', currentLevel: 'DANGER' });
      expect(c.newFindings.map((f) => f.ruleId)).toEqual([
        'R01_REMOTE_PIPE_EXEC',
      ]); // 억제·중복 제외

      // 일부만 ack
      await request(t.http())
        .post('/api/me/bookmarks/security-changes/ack')
        .set(auth())
        .send({ itemIds: [changed.id] })
        .expect(204);
      const after = (
        await request(t.http())
          .get('/api/me/bookmarks/security-changes')
          .set(auth())
      ).body as C;
      expect(after.items.map((i) => i.item.id)).toEqual([fromNull.id]);
      // 전부 ack (본문 없음)
      await request(t.http())
        .post('/api/me/bookmarks/security-changes/ack')
        .set(auth())
        .expect(204);
      const none = (
        await request(t.http())
          .get('/api/me/bookmarks/security-changes')
          .set(auth())
      ).body as C;
      expect(none.items).toEqual([]);
      // 다른 사용자의 북마크는 건드리지 않는다
      await request(t.http())
        .post('/api/me/bookmarks/security-changes/ack')
        .set(auth())
        .send({ itemIds: [-1] })
        .expect(400);
    });

    it('데모 계정: ack·삭제는 no-op(공유 계정의 시드 상태 보존) (REVIEW Y6)', async () => {
      const repo = await createRepo(t.prisma);
      const item = await createItem(t.prisma, repo.id, {
        currentLevel: 'DANGER',
      });
      const demo = await createUser(t.prisma, {
        email: 'admin',
        role: 'ADMIN',
      });
      await t.prisma.bookmark.create({
        data: { userId: demo.id, itemId: item.id, seenLevel: 'SAFE' },
      });
      const demoAuth = { Authorization: `Bearer ${await login(t, 'admin')}` };

      await request(t.http())
        .post('/api/me/bookmarks/security-changes/ack')
        .set(demoAuth)
        .expect(204);
      await request(t.http())
        .delete(`/api/me/bookmarks/${item.id}`)
        .set(demoAuth)
        .expect(204);

      const changes = await request(t.http())
        .get('/api/me/bookmarks/security-changes')
        .set(demoAuth);
      expect((changes.body as { items: unknown[] }).items).toHaveLength(1);
      expect(
        await t.prisma.bookmark.count({ where: { userId: demo.id } }),
      ).toBe(1);
    });
  });
});
