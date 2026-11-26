// 운영 데모 계정(admin/admin) 시드 + 데모 상태 복원. 가짜 저장소 픽스처(seed-demo-fixtures.ts)와 분리된 운영용 스크립트.
// 비밀번호 검증은 우회하지 않는다 — 로그인은 항상 bcrypt 비교를 거친다. 이 스크립트는 계정 한 개와 그 북마크만 건드린다.
//
// 실행: DATABASE_URL(kok_app) npx ts-node scripts/seed-admin.ts [--reset]
//   (기본)   admin이 없으면 만들고, 있으면 건너뜀
//   --reset  위 + 데모 북마크를 쇼케이스 상태로 복원(데모 방문자가 쌓은 북마크 정리)
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type RiskLevel } from '@prisma/client';
import * as bcrypt from 'bcrypt';

export const DEMO_EMAIL = 'admin';
const SHOWCASE_BOOKMARKS = 3;

/** @returns 새로 만들었으면 true, 이미 있어 건너뛰었으면 false. 기존 계정의 비밀번호·권한은 바꾸지 않는다. */
export async function ensureDemoAdmin(prisma: PrismaClient): Promise<boolean> {
  if (await prisma.user.findUnique({ where: { email: DEMO_EMAIL } })) {
    return false;
  }
  await prisma.user.create({
    data: {
      email: DEMO_EMAIL,
      name: '데모 관리자',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash('admin', 10),
    },
  });
  return true;
}

/**
 * 데모 admin의 북마크를 쇼케이스 상태(항목 3개, 그중 1개는 저장 후 등급이 바뀐 상태)로 되돌린다.
 * 왜: 데모 계정은 북마크 추가가 허용돼(삭제만 no-op) 방문자마다 누적되므로, 면접관이 항상 같은 화면을 보게 주기적으로 복원한다.
 * 항목은 트렌드 순위 → id 순으로 결정적으로 고르며, 등급 변경 항목은 중간 것(1번)이다.
 * 다른 사용자 데이터는 건드리지 않고, 데모 계정이 없거나 고를 항목이 없으면 아무것도 하지 않는다.
 */
export async function resetDemoBookmarks(prisma: PrismaClient): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!admin) return;
  const picks = await prisma.item.findMany({
    where: { status: 'ACTIVE', currentLevel: { not: null } },
    orderBy: [{ trendRank7d: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    take: SHOWCASE_BOOKMARKS,
  });
  await prisma.$transaction([
    prisma.bookmark.deleteMany({ where: { userId: admin.id } }),
    prisma.bookmark.createMany({
      data: picks.map((it, i) => ({
        userId: admin.id,
        itemId: it.id,
        // 현재 등급과 다른 값을 seenLevel로 두면 "보안 등급 변경" 탭에 항목이 남는다
        seenLevel: i === 1 ? differentLevel(it.currentLevel) : it.currentLevel,
      })),
    }),
  ]);
}

function differentLevel(level: RiskLevel | null): RiskLevel {
  return level === 'SAFE' ? 'CAUTION' : 'SAFE';
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL as string),
  });
  try {
    console.log(
      (await ensureDemoAdmin(prisma))
        ? '데모 admin을 만들었습니다.'
        : '데모 admin이 이미 있어 건너뜁니다.',
    );
    if (process.argv.includes('--reset')) {
      await resetDemoBookmarks(prisma);
      console.log('데모 북마크를 쇼케이스 상태로 복원했습니다.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
