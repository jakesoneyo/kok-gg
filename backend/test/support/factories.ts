// 테스트용 저장소·항목 생성기. 정렬 키(비정규화 컬럼)를 호출자가 직접 지정할 수 있다.
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../src/prisma/prisma.service';

let seq = 0;

export async function createRepo(
  prisma: PrismaService,
  over: Partial<Prisma.RepoUncheckedCreateInput> = {},
) {
  seq += 1;
  return prisma.repo.create({
    data: {
      githubId: BigInt(1000 + seq),
      nodeId: `node-${seq}-${Math.random()}`,
      owner: `owner${seq}`,
      name: `repo${seq}`,
      fullNameLower: `owner${seq}/repo${seq}`,
      discoveredVia: 'MANUAL',
      status: 'TRACKED',
      stars: 100,
      pushedAt: new Date('2026-11-20T00:00:00Z'),
      ...over,
    },
  });
}

export async function createItem(
  prisma: PrismaService,
  repoId: number,
  over: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  seq += 1;
  return prisma.item.create({
    data: {
      repoId,
      kind: 'HOOK',
      path: `p${seq}`,
      name: `item-${seq}`,
      sourceType: 'IN_REPO',
      ...over,
    },
  });
}
