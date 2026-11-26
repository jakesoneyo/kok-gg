// ItemCard(목록·검색·북마크 공용 행) — Prisma select에서 타입을 파생해 손으로 재정의하지 않는다(SSOT).
import { Prisma } from '@prisma/client';
import { z } from 'zod';

export const ITEM_CARD_SELECT = {
  id: true,
  kind: true,
  name: true,
  description: true,
  components: true,
  hasExternalMcp: true,
  currentLevel: true,
  trendScore7d: true,
  trendRank7d: true,
  prevTrendRank7d: true,
  repoStars: true,
  repoPushedAt: true,
  firstSeenAt: true,
  repo: {
    select: {
      id: true,
      owner: true,
      name: true,
      stars: true,
      pushedAt: true,
      sparkline7d: true,
    },
  },
} satisfies Prisma.ItemSelect;

export type ItemCardRow = Prisma.ItemGetPayload<{
  select: typeof ITEM_CARD_SELECT;
}>;

const sparklineSchema = z
  .array(z.number().int().nullable())
  .length(7)
  .catch(Array<number | null>(7).fill(null)); // 배치가 쓴 JSON이 깨졌어도 목록 전체가 죽지 않게

/** 목록·북마크·검색이 공유하는 저장소 요약. 카드 모양이 한 곳에서만 정의되게 둔다. */
export function toRepoBrief(repo: ItemCardRow['repo']) {
  return {
    id: repo.id,
    fullName: `${repo.owner}/${repo.name}`,
    stars: repo.stars,
    pushedAt: repo.pushedAt,
    sparkline7d: sparklineSchema.parse(repo.sparkline7d),
  };
}

/**
 * DB 행을 API ItemCard로 변환한다. 목록·검색·북마크가 모두 이 함수를 써서 응답 모양이 갈라지지 않는다.
 *
 * @param row ITEM_CARD_SELECT로 조회한 행
 */
export function toItemCard(row: ItemCardRow) {
  const { trendRank7d: rank, prevTrendRank7d: prev } = row;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    description: row.description,
    repo: toRepoBrief(row.repo),
    trendRank7d: rank,
    // 전일 순위 − 오늘 순위: 양수 ▲. NEW·미자격은 null.
    rankDelta: rank !== null && prev !== null ? prev - rank : null,
    isNew: rank !== null && prev === null,
    currentLevel: row.currentLevel,
    hasExternalMcp: row.hasExternalMcp,
    trendScore7d: row.trendScore7d,
    firstSeenAt: row.firstSeenAt,
    components: row.components,
  };
}

export type ItemCard = ReturnType<typeof toItemCard>;
