// seed-admin: 데모 admin 생성 멱등성, 북마크 초기화가 데모 계정만 건드리는지, 반복 실행해도 상태가 같은지 확인한다.
import * as bcrypt from 'bcrypt';
import { ensureDemoAdmin, resetDemoBookmarks } from '../scripts/seed-admin';
import {
  createTestApp,
  createUser,
  resetDb,
  type TestApp,
} from './support/app';
import { createItem, createRepo } from './support/factories';

describe('seed-admin', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(() => resetDb(t.prisma));

  it('admin이 없으면 만들고(bcrypt·ADMIN), 있으면 건드리지 않는다', async () => {
    expect(await ensureDemoAdmin(t.prisma)).toBe(true);
    const first = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'admin' },
    });
    expect(first.role).toBe('ADMIN');
    expect(first.passwordHash).not.toBe('admin');
    expect(await bcrypt.compare('admin', first.passwordHash)).toBe(true);

    expect(await ensureDemoAdmin(t.prisma)).toBe(false);
    const second = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'admin' },
    });
    expect(second.passwordHash).toBe(first.passwordHash);
    expect(await t.prisma.user.count()).toBe(1);
  });

  it('북마크를 3개로 복원하고 등급 변경 항목이 정확히 1개이며, 반복해도 같다', async () => {
    await ensureDemoAdmin(t.prisma);
    const repo = await createRepo(t.prisma);
    for (let i = 0; i < 5; i++) {
      await createItem(t.prisma, repo.id, {
        currentLevel: 'SAFE',
        trendRank7d: i + 1,
      });
    }
    const admin = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'admin' },
    });
    // 데모 사용자가 쌓은 북마크 + 일반 사용자 북마크
    const other = await createUser(t.prisma);
    const all = await t.prisma.item.findMany({ orderBy: { id: 'asc' } });
    await t.prisma.bookmark.createMany({
      data: all.map((i) => ({ userId: admin.id, itemId: i.id })),
    });
    await t.prisma.bookmark.create({
      data: { userId: other.id, itemId: all[4].id },
    });

    const shape = async () =>
      (
        await t.prisma.bookmark.findMany({
          where: { userId: admin.id },
          orderBy: { itemId: 'asc' },
        })
      ).map((b) => [b.itemId, b.seenLevel]);
    await resetDemoBookmarks(t.prisma);
    const once = await shape();
    expect(once).toHaveLength(3);
    expect(once.filter(([, seen]) => seen !== 'SAFE')).toHaveLength(1);
    await resetDemoBookmarks(t.prisma);
    expect(await shape()).toEqual(once);
    // 다른 사용자 데이터는 그대로
    expect(await t.prisma.bookmark.count({ where: { userId: other.id } })).toBe(
      1,
    );
  });

  it('데모 계정이 없거나 항목이 없어도 실패하지 않는다', async () => {
    await expect(resetDemoBookmarks(t.prisma)).resolves.toBeUndefined();
    await ensureDemoAdmin(t.prisma);
    await expect(resetDemoBookmarks(t.prisma)).resolves.toBeUndefined();
  });
});
