// 데모 픽스처가 모든 공개 화면을 채우고, admin/admin 정상 로그인(bcrypt)으로 관리자 화면까지 열리는지 확인한다.
import { Client } from 'pg';
import request from 'supertest';
import { seedDemoFixtures } from '../scripts/seed-demo-fixtures';
import { createTestApp, resetDb, type TestApp } from './support/app';

describe('seed-demo-fixtures', () => {
  let t: TestApp;
  let ai: Client;

  beforeAll(async () => {
    t = await createTestApp();
    ai = new Client({ connectionString: process.env.AI_DATABASE_URL });
    await ai.connect();
  });
  afterAll(async () => {
    await ai.end();
    await t.app.close();
  });

  it('저장소 10·항목 20·스타 60일을 넣고, 두 번째 실행은 건너뛴다', async () => {
    await resetDb(t.prisma);
    expect(await seedDemoFixtures({ prisma: t.prisma, ai })).toBe(true);
    expect(await seedDemoFixtures({ prisma: t.prisma, ai })).toBe(false);

    expect(await t.prisma.repo.count()).toBe(10);
    expect(await t.prisma.item.count()).toBe(20);
    expect(await t.prisma.repoStarDay.count()).toBe(600);
    const levels = await t.prisma.item.groupBy({
      by: ['currentLevel'],
      _count: true,
    });
    expect(levels.map((l) => l.currentLevel).sort()).toEqual(
      [null, 'CAUTION', 'DANGER', 'SAFE'].sort(),
    );
  });

  it('공개 화면이 비지 않는다: 목록·트렌딩·상세(요약 포함)·시계열', async () => {
    const http = t.http();
    const items = (await request(http).get('/api/items?limit=50').expect(200))
      .body as { items: { id: number }[] };
    expect(items.items).toHaveLength(20);
    const trending = (await request(http).get('/api/trending').expect(200))
      .body as { items: unknown[] };
    expect(trending.items).toHaveLength(8);
    const detail = (
      await request(http).get(`/api/items/${items.items[0].id}`).expect(200)
    ).body as { summary: { status: string } | null };
    expect(detail.summary?.status).toBe('OK');
    const stars = (
      await request(http)
        .get(`/api/items/${items.items[0].id}/stars`)
        .expect(200)
    ).body as { series: unknown[] };
    expect(stars.series).toHaveLength(90);
  });

  it('admin/admin으로 정상 로그인하고 관리자 화면·북마크 변경 탭이 채워진다', async () => {
    const login = await request(t.http())
      .post('/api/auth/login')
      .send({ email: 'admin', password: 'admin' })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;
    const auth = { Authorization: `Bearer ${token}` };
    const runs = (
      await request(t.http())
        .get('/api/admin/ingestion/runs')
        .set(auth)
        .expect(200)
    ).body as { items: unknown[] };
    expect(runs.items).toHaveLength(1);
    const issues = (
      await request(t.http())
        .get('/api/admin/data-quality/issues')
        .set(auth)
        .expect(200)
    ).body as { items: unknown[] };
    expect(issues.items).toHaveLength(1);
    const changes = (
      await request(t.http())
        .get('/api/me/bookmarks/security-changes')
        .set(auth)
        .expect(200)
    ).body as { items: unknown[] };
    expect(changes.items.length).toBeGreaterThan(0);
  });
});
