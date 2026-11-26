// IT-10(정렬×필터 keyset 전 페이지 순회) · IT-11(공개 응답 캐시/Authorization 무관) · IT-16(상세 쿼리 수) + 카탈로그 기타 엔드포인트.
import request from 'supertest';
import { Client } from 'pg';
import {
  createTestApp,
  createUser,
  login,
  resetDb,
  type TestApp,
} from './support/app';
import { createItem, createRepo } from './support/factories';

type Card = { id: number };
type Page = { items: Card[]; nextCursor: string | null; asOf: string | null };

describe('catalog', () => {
  let t: TestApp;
  const get = (url: string, token?: string) => {
    const r = request(t.http()).get(url);
    return token ? r.set('Authorization', `Bearer ${token}`) : r;
  };

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(() => resetDb(t.prisma));

  /** 동률이 많은 항목 36개: 정렬 키 충돌(id 동률 해소)과 null 등급을 모두 포함. */
  async function seedMany() {
    const kinds = ['PLUGIN', 'SKILL', 'HOOK'] as const;
    const levels = ['SAFE', 'CAUTION', 'DANGER', null] as const;
    const repos = [
      await createRepo(t.prisma, { stars: 10 }),
      await createRepo(t.prisma, { stars: 10 }),
      await createRepo(t.prisma, { stars: 500 }),
    ];
    for (let i = 0; i < 36; i++) {
      await createItem(t.prisma, repos[i % 3].id, {
        kind: kinds[i % 3],
        currentLevel: levels[i % 4],
        trendScore7d: (i % 5) * 100.5, // 5값 → 동률 다수
        repoStars: (i % 4) * 10,
        repoPushedAt: new Date(Date.UTC(2026, 10, 1 + (i % 3))),
        firstSeenAt: new Date(Date.UTC(2026, 9, 1 + (i % 6))),
      });
    }
  }

  describe('IT-10 GET /api/items', () => {
    // 카드의 repo.stars는 repo 테이블 값이라 정렬 키(item.repoStars)와 다르다 → 단조성은 DB의 정렬 키 컬럼으로 검증한다.
    const DB_KEY = {
      trending: 'trendScore7d',
      stars: 'repoStars',
      updated: 'repoPushedAt',
      new: 'firstSeenAt',
    } as const;

    it('정렬 4 × kind 4 × level 4 전 페이지 순회: 단조·중복 0·누락 0', async () => {
      await seedMany();
      const all = await t.prisma.item.findMany();
      const byId = new Map(all.map((i) => [i.id, i]));

      for (const sort of ['trending', 'stars', 'updated', 'new'] as const) {
        for (const kind of [undefined, 'PLUGIN', 'SKILL', 'HOOK']) {
          for (const level of [undefined, 'SAFE', 'CAUTION', 'DANGER']) {
            const qs = new URLSearchParams({ sort, limit: '7' });
            if (kind) qs.set('kind', kind);
            if (level) qs.set('level', level);

            const seen: number[] = [];
            let cursor: string | null = null;
            let pages = 0;
            do {
              if (cursor) qs.set('cursor', cursor);
              const res = await get(`/api/items?${qs}`).expect(200);
              const page = res.body as Page;
              seen.push(...page.items.map((c) => c.id));
              cursor = page.nextCursor;
              pages += 1;
            } while (cursor && pages < 20);

            const label = `${sort}/${kind}/${level}`;
            const expected = all.filter(
              (i) =>
                (!kind || i.kind === kind) &&
                (!level || i.currentLevel === level),
            );
            expect({ label, n: seen.length }).toEqual({
              label,
              n: expected.length,
            });
            expect(new Set(seen).size).toBe(seen.length);

            const k = DB_KEY[sort];
            for (let i = 1; i < seen.length; i++) {
              const a = byId.get(seen[i - 1])!;
              const b = byId.get(seen[i])!;
              const av = +a[k];
              const bv = +b[k];
              expect(av > bv || (av === bv && a.id > b.id)).toBe(true);
            }
          }
        }
      }
    });

    it('다른 정렬의 커서·깨진 커서는 400 INVALID_CURSOR, 미지 파라미터는 400', async () => {
      await seedMany();
      const first = (await get('/api/items?sort=stars&limit=2').expect(200))
        .body as Page;
      expect(first.nextCursor).toBeTruthy();

      const wrong = await get(
        `/api/items?sort=trending&cursor=${first.nextCursor}`,
      ).expect(400);
      expect((wrong.body as { code: string }).code).toBe('INVALID_CURSOR');
      await get('/api/items?cursor=@@@').expect(400);

      const unknown = await get('/api/items?foo=1').expect(400);
      expect((unknown.body as { code: string }).code).toBe('VALIDATION_FAILED');
      await get('/api/items?limit=51').expect(400);
      await get('/api/items?level=BAD').expect(400);
    });

    it('ItemCard에 스파크라인·순위 변동 필드가 실린다', async () => {
      const repo = await createRepo(t.prisma, {
        sparkline7d: [1, null, 3, 4, 5, 6, 7],
      });
      await createItem(t.prisma, repo.id, {
        trendRank7d: 2,
        prevTrendRank7d: 5,
      });
      await createItem(t.prisma, repo.id, {
        trendRank7d: 4,
        prevTrendRank7d: null,
      });
      await createItem(t.prisma, repo.id, { trendRank7d: null });
      const { items } = (await get('/api/items?sort=new').expect(200)).body as {
        items: {
          trendRank7d: number | null;
          rankDelta: number | null;
          isNew: boolean;
          repo: { fullName: string; sparkline7d: (number | null)[] };
        }[];
      };
      const by = (r: number | null) => items.find((i) => i.trendRank7d === r)!;
      expect(by(2)).toMatchObject({ rankDelta: 3, isNew: false });
      expect(by(4)).toMatchObject({ rankDelta: null, isNew: true });
      expect(by(null)).toMatchObject({ rankDelta: null, isNew: false });
      expect(items[0].repo.sparkline7d).toEqual([1, null, 3, 4, 5, 6, 7]);
      expect(items[0].repo.fullName).toContain('/');
    });
  });

  describe('IT-11 캐시 프로필', () => {
    it('Authorization 유무와 무관하게 본문이 같고 프로필 헤더가 붙는다', async () => {
      const repo = await createRepo(t.prisma);
      const item = await createItem(t.prisma, repo.id);
      await createUser(t.prisma);
      const token = await login(t, 'user@example.com');

      const paths: [string, string][] = [
        ['/api/items', 'max-age=60, s-maxage=600'],
        ['/api/trending', 's-maxage=1800'],
        [`/api/items/${item.id}`, 's-maxage=1800'],
        [`/api/items/${item.id}/stars`, 's-maxage=3600'],
        [`/api/repos/${repo.owner}/${repo.name}`, 's-maxage=1800'],
        ['/api/stats/overview', 's-maxage=86400'],
      ];
      for (const [p, expectedHeader] of paths) {
        const anon = await get(p).expect(200);
        const authed = await get(p, token).expect(200);
        expect(authed.body).toEqual(anon.body);
        expect(anon.headers['cache-control']).toContain(expectedHeader);
        expect(anon.headers['cache-control']).toMatch(/^public/);
        expect(anon.headers.etag).toBeTruthy();
      }
    });

    it('If-None-Match가 맞으면 304', async () => {
      const first = await get('/api/stats/overview').expect(200);
      await get('/api/stats/overview')
        .set('If-None-Match', first.headers.etag)
        .expect(304);
    });

    it('me · 북마크 · 오류 · health 응답은 no-store', async () => {
      await createUser(t.prisma);
      const token = await login(t, 'user@example.com');
      const me = await get('/api/auth/me', token).expect(200);
      expect(me.headers['cache-control']).toBe('private, no-store');
      const ids = await get('/api/me/bookmarks/ids', token).expect(200);
      expect(ids.headers['cache-control']).toBe('private, no-store');
      const bad = await get('/api/items?foo=1').expect(400);
      expect(bad.headers['cache-control']).toBe('private, no-store');
      const missing = await get('/api/items/999999').expect(404);
      expect(missing.headers['cache-control']).toBe('private, no-store');
      const health = await get('/health').expect(200);
      expect(health.headers['cache-control']).toBe('private, no-store');
    });
  });

  describe('IT-16 항목 상세', () => {
    it('Prisma 쿼리 ≤ 4 (+ 요약 raw 1)이고 본문이 조립된다', async () => {
      const repo = await createRepo(t.prisma, { headSha: 'a'.repeat(40) });
      const admin = await createUser(t.prisma, {
        email: 'a@x.com',
        role: 'ADMIN',
      });
      const item = await createItem(t.prisma, repo.id, {
        currentLevel: 'CAUTION',
      });
      const scan = await t.prisma.securityScan.create({
        data: {
          itemId: item.id,
          headSha: 'a'.repeat(40),
          ruleSetVersion: '1.0.0',
          status: 'ANALYZED',
          rawLevel: 'DANGER',
          level: 'CAUTION',
          findingCount: 2,
        },
      });
      await t.prisma.item.update({
        where: { id: item.id },
        data: { currentScanId: scan.id },
      });
      const fp = 'f'.repeat(64);
      await t.prisma.securityFinding.createMany({
        data: [
          {
            scanId: scan.id,
            ruleId: 'R04_NETWORK_SEND',
            severity: 'CAUTION',
            filePath: 'a.sh',
            line: 1,
            excerpt: 'curl x',
            fingerprint: 'e'.repeat(64),
          },
          {
            scanId: scan.id,
            ruleId: 'R02_DESTRUCTIVE_RM',
            severity: 'DANGER',
            filePath: 'b.sh',
            line: 3,
            excerpt: 'delete build dir',
            fingerprint: fp,
            suppressed: true,
          },
        ],
      });
      await t.prisma.securityOverride.create({
        data: {
          itemId: item.id,
          fingerprint: fp,
          ruleId: 'R02_DESTRUCTIVE_RM',
          reason: '고정값으로 설정됨',
          activeKey: `${item.id}:${fp}`,
          createdById: admin.id,
        },
      });
      const day = new Date('2026-11-24');
      await t.prisma.trendScore.createMany({
        data: [
          {
            window: 'D7',
            asOf: day,
            repoId: repo.id,
            score: 10,
            gain: 5,
            acceleration: 1,
            spikePenalty: 1,
            rank: 1,
            paramsVersion: 1,
          },
          {
            window: 'D30',
            asOf: day,
            repoId: repo.id,
            score: 4,
            gain: 9,
            acceleration: 1,
            spikePenalty: 1,
            rank: 9,
            paramsVersion: 1,
          },
        ],
      });
      const mp = await t.prisma.marketplace.create({
        data: { repoId: repo.id, path: '', name: 'my-market' },
      });
      await t.prisma.marketplaceEntry.create({
        data: {
          marketplaceId: mp.id,
          entryName: 'x',
          itemId: item.id,
          rawSource: {},
        },
      });
      const ai = new Client({ connectionString: process.env.AI_DATABASE_URL });
      await ai.connect();
      await ai.query(
        `INSERT INTO ai.item_summary (item_id, source_sha256, prompt_version, model, status, summary_ko, install_commands)
         VALUES ($1, 'x', 1, 'claude-haiku-5-5', 'OK', '요약입니다', '["/plugin install a@b"]')`,
        [item.id],
      );
      await ai.end();

      const queries: string[] = [];
      t.prisma.$on('query', (e) => {
        if (!/^(BEGIN|COMMIT)/.test(e.query)) queries.push(e.query);
      });
      const res = await get(`/api/items/${item.id}`).expect(200);
      const prismaQueries = queries.filter(
        (q) => !q.includes('ai.v_item_summary_public'),
      );
      expect(prismaQueries.length).toBeLessThanOrEqual(4);
      expect(queries.length - prismaQueries.length).toBe(1);

      const body = res.body as {
        security: {
          level: string;
          rawLevel: string;
          findings: {
            suppressed: boolean;
            override: { reason: string } | null;
          }[];
        };
        summary: {
          summaryKo: string;
          installCommands: { command: string; warnings: string[] }[];
        };
        trend: { D1: unknown; D7: { rank: number }; D30: { rank: number } };
        marketplaces: { name: string }[];
      };
      expect(body.security).toMatchObject({
        level: 'CAUTION',
        rawLevel: 'DANGER',
      });
      expect(
        body.security.findings.find((f) => f.suppressed)!.override,
      ).toMatchObject({ reason: '고정값으로 설정됨' });
      expect(body.summary.summaryKo).toBe('요약입니다');
      expect(body.summary.installCommands).toEqual([
        { command: '/plugin install a@b', warnings: [] },
      ]);
      expect(body.trend).toMatchObject({
        D1: null,
        D7: { rank: 1 },
        D30: { rank: 9 },
      });
      expect(body.marketplaces[0].name).toBe('my-market');
    });

    it('분석 불가 검사는 level null · findings 빈 배열, 검사 전은 security null, 없는 id는 404', async () => {
      const repo = await createRepo(t.prisma);
      const noScan = await createItem(t.prisma, repo.id);
      const unsupported = await createItem(t.prisma, repo.id);
      const scan = await t.prisma.securityScan.create({
        data: {
          itemId: unsupported.id,
          headSha: 'b'.repeat(40),
          ruleSetVersion: '1.0.0',
          status: 'UNSUPPORTED',
        },
      });
      await t.prisma.item.update({
        where: { id: unsupported.id },
        data: { currentScanId: scan.id },
      });

      const a = (await get(`/api/items/${noScan.id}`).expect(200)).body as {
        security: unknown;
        summary: unknown;
      };
      expect(a.security).toBeNull();
      expect(a.summary).toBeNull();
      const b = (await get(`/api/items/${unsupported.id}`).expect(200))
        .body as {
        security: { status: string; level: unknown; findings: unknown[] };
      };
      expect(b.security).toMatchObject({
        status: 'UNSUPPORTED',
        level: null,
        findings: [],
      });
      await get('/api/items/999999').expect(404);
      await get('/api/items/abc').expect(400);
    });
  });

  describe('트렌딩 · 저장소 · 스타 · 통계', () => {
    it('트렌딩: 순위 커서 페이지네이션 + 쿼리 3회 + kind 필터', async () => {
      const day = new Date('2026-11-24');
      for (let i = 0; i < 3; i++) {
        const r = await createRepo(t.prisma, {
          sparkline7d: [0, 0, 0, 0, 0, 0, i],
        });
        await createItem(t.prisma, r.id, {
          kind: i === 2 ? 'SKILL' : 'HOOK',
          currentLevel: i === 0 ? 'DANGER' : 'SAFE',
        });
        await createItem(t.prisma, r.id, {
          kind: 'HOOK',
          currentLevel: 'CAUTION',
        });
        await t.prisma.trendScore.create({
          data: {
            window: 'D7',
            asOf: day,
            repoId: r.id,
            score: 100 - i,
            gain: 10,
            acceleration: 1,
            spikePenalty: 1,
            rank: i + 1,
            prevRank: i === 1 ? null : i + 2,
            paramsVersion: 1,
          },
        });
      }
      type T = {
        items: {
          rank: number;
          isNew: boolean;
          worstLevel: string;
          kinds: Record<string, number>;
        }[];
        nextCursor: string | null;
        asOf: string;
      };
      const queries: string[] = [];
      t.prisma.$on('query', (e) => queries.push(e.query));
      const p1 = (await get('/api/trending?limit=2').expect(200)).body as T;
      expect(queries.filter((q) => !/^(BEGIN|COMMIT)/.test(q)).length).toBe(3);
      expect(p1.asOf).toBe('2026-11-24');
      expect(p1.items.map((i) => i.rank)).toEqual([1, 2]);
      expect(p1.items[0]).toMatchObject({
        worstLevel: 'DANGER',
        kinds: { HOOK: 2, SKILL: 0, PLUGIN: 0 },
      });
      expect(p1.items[1].isNew).toBe(true);
      const p2 = (
        await get(`/api/trending?limit=2&cursor=${p1.nextCursor}`).expect(200)
      ).body as T;
      expect(p2.items.map((i) => i.rank)).toEqual([3]);
      expect(p2.nextCursor).toBeNull();
      const skill = (await get('/api/trending?kind=SKILL').expect(200))
        .body as T;
      expect(skill.items.map((i) => i.rank)).toEqual([3]);
      await get('/api/trending?window=D9').expect(400);
    });

    it('스타 시계열: 스냅샷 차분 / 공식 / 모름(null) 구분, 0으로 메우지 않는다', async () => {
      const repo = await createRepo(t.prisma);
      const item = await createItem(t.prisma, repo.id);
      const d = (n: number) =>
        new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
      await t.prisma.repoStarDay.createMany({
        data: [
          { repoId: repo.id, day: new Date(d(3)), snapshotTotal: 100 },
          { repoId: repo.id, day: new Date(d(2)), snapshotTotal: 107 },
          { repoId: repo.id, day: new Date(d(1)), officialAdded: 4 }, // 스냅샷 없는 날 → 공식 값
        ],
      });
      const res = (await get(`/api/items/${item.id}/stars?days=30`).expect(200))
        .body as {
        series: {
          day: string;
          gain: number | null;
          source: string | null;
        }[];
      };
      expect(res.series).toHaveLength(30);
      const at = (n: number) => res.series.find((s) => s.day === d(n))!;
      // 전일 스냅샷이 없으니 모름 — 누적 100을 하루치 증가로 보면 안 된다.
      expect(at(3)).toMatchObject({ gain: null, source: null });
      expect(at(2)).toMatchObject({ gain: 7, source: 'SNAPSHOT' });
      expect(at(1)).toMatchObject({ gain: 4, source: 'OFFICIAL' });
      expect(at(0)).toMatchObject({ gain: null });
      await get(`/api/items/${item.id}/stars?days=45`).expect(400);
    });

    it('저장소 상세: 대소문자 무관 조회, 없는 저장소 404, 이름 형식 위반 400', async () => {
      const repo = await createRepo(t.prisma, {
        owner: 'SomeOne',
        name: 'Claude-Hooks',
        fullNameLower: 'someone/claude-hooks',
      });
      await createItem(t.prisma, repo.id);
      const res = (await get('/api/repos/SOMEONE/claude-hooks').expect(200))
        .body as {
        repo: { fullName: string; url: string };
        items: unknown[];
        trend: { D7: unknown };
      };
      expect(res.repo).toMatchObject({
        fullName: 'SomeOne/Claude-Hooks',
        url: 'https://github.com/SomeOne/Claude-Hooks',
      });
      expect(res.items).toHaveLength(1);
      expect(res.trend.D7).toBeNull();
      await get('/api/repos/nobody/none').expect(404);
      await get('/api/repos/a b/c').expect(400);
    });

    it('통계: 종류별 수 · 추적 저장소 수', async () => {
      const repo = await createRepo(t.prisma);
      await createItem(t.prisma, repo.id, { kind: 'HOOK' });
      await createItem(t.prisma, repo.id, { kind: 'SKILL' });
      await createItem(t.prisma, repo.id, { kind: 'SKILL', status: 'REMOVED' });
      const res = (await get('/api/stats/overview').expect(200)).body as {
        counts: Record<string, number>;
        trackedRepos: number;
        lastRun: unknown;
      };
      expect(res).toMatchObject({
        counts: { PLUGIN: 0, SKILL: 1, HOOK: 1 },
        trackedRepos: 1,
        lastRun: null,
      });
    });
  });
});
