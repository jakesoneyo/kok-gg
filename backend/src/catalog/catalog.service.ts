// 공개 카탈로그 조회: 목록(keyset)·트렌딩·항목 상세·스타 시계열·저장소 상세·통계.
import { Injectable } from '@nestjs/common';
import { Prisma, TrendWindow } from '@prisma/client';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/cursor/cursor.codec';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { ItemSort, ItemsQuery, TrendingQuery } from './dto/catalog.schema';
import {
  ITEM_CARD_SELECT,
  toItemCard,
  toRepoBrief,
  type ItemCardRow,
} from './item-card';

/** sort → 정렬 키 컬럼. 전부 DESC + id DESC 동률 해소(DATA-MODEL 6.1). */
const SORT_COLUMN = {
  trending: 'trendScore7d',
  stars: 'repoStars',
  updated: 'repoPushedAt',
  new: 'firstSeenAt',
} as const satisfies Record<ItemSort, keyof ItemCardRow>;

const idSchema = z.number().int().positive();
/** 시각 키는 ISO 문자열로 왕복한다 — timestamp(3)과 JS Date 정밀도가 같아 비교가 정확하다(DATA-MODEL 6.3). */
const cursorValue = (sort: ItemSort) =>
  sort === 'trending'
    ? z.number()
    : sort === 'stars'
      ? z.number().int()
      : z.iso.datetime();

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** 가장 최근 계산일(트렌드 배치 기준일). 데이터가 없으면 null. */
  private async latestAsOf(window: TrendWindow = 'D7'): Promise<Date | null> {
    const row = await this.prisma.trendScore.findFirst({
      where: { window },
      orderBy: { asOf: 'desc' },
      select: { asOf: true },
    });
    return row?.asOf ?? null;
  }

  /**
   * 카탈로그 목록. 정렬 키가 item에 비정규화돼 있어 `(status, [kind,] key, id)` 인덱스만으로
   * keyset 페이지를 뽑는다. `take = limit + 1`로 다음 페이지 유무를 COUNT 없이 판단한다.
   */
  async listItems(q: ItemsQuery) {
    const { sort } = q;
    const col = SORT_COLUMN[sort];
    const isDate = sort === 'updated' || sort === 'new';

    const where: Prisma.ItemWhereInput = {
      status: 'ACTIVE',
      kind: q.kind,
      currentLevel: q.level, // 지정 시 null(미분석) 자동 제외
    };
    if (q.cursor) {
      const c = decodeCursor(
        q.cursor,
        z.object({ s: z.literal(sort), v: cursorValue(sort), id: idSchema }),
      );
      const v = isDate ? new Date(c.v) : (c.v as number);
      where.OR = [{ [col]: { lt: v } }, { [col]: v, id: { lt: c.id } }];
    }

    const [asOf, rows] = await Promise.all([
      this.latestAsOf(),
      this.prisma.item.findMany({
        relationLoadStrategy: 'join',
        where,
        orderBy: [{ [col]: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: ITEM_CARD_SELECT,
      }),
    ]);

    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > q.limit && last
        ? encodeCursor({
            s: sort,
            v: isDate ? (last[col] as Date).toISOString() : last[col],
            id: last.id,
          })
        : null;
    return {
      asOf: asOf?.toISOString().slice(0, 10) ?? null,
      sort,
      items: page.map(toItemCard),
      nextCursor,
    };
  }

  /**
   * 저장소 순위표. 쿼리 3회 고정: ① 기준일 ② trend_score + repo ③ 해당 저장소들의 Item(ANY).
   * 루프 안 개별 조회 없이 Map으로 조립한다(N+1 금지).
   */
  async trending(q: TrendingQuery) {
    const asOf = await this.latestAsOf(q.window);
    if (!asOf) {
      return { asOf: null, window: q.window, items: [], nextCursor: null };
    }
    const after = q.cursor
      ? decodeCursor(q.cursor, z.object({ r: z.number().int().positive() })).r
      : 0;

    const rows = await this.prisma.trendScore.findMany({
      relationLoadStrategy: 'join',
      where: {
        window: q.window,
        asOf,
        rank: { gt: after },
        ...(q.kind && {
          repo: { items: { some: { kind: q.kind, status: 'ACTIVE' } } },
        }),
      },
      orderBy: { rank: 'asc' },
      take: q.limit + 1,
      include: {
        repo: {
          select: {
            id: true,
            owner: true,
            name: true,
            description: true,
            stars: true,
            pushedAt: true,
            sparkline7d: true,
          },
        },
      },
    });
    const page = rows.slice(0, q.limit);

    const items = await this.prisma.item.findMany({
      where: { repoId: { in: page.map((r) => r.repoId) }, status: 'ACTIVE' },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        repoId: true,
        kind: true,
        name: true,
        currentLevel: true,
      },
    });
    const byRepo = new Map<number, typeof items>();
    for (const i of items) {
      byRepo.set(i.repoId, [...(byRepo.get(i.repoId) ?? []), i]);
    }

    return {
      asOf: asOf.toISOString().slice(0, 10),
      window: q.window,
      items: page.map((r) => {
        const mine = byRepo.get(r.repoId) ?? [];
        const kinds = { PLUGIN: 0, SKILL: 0, HOOK: 0 };
        for (const i of mine) kinds[i.kind] += 1;
        return {
          rank: r.rank,
          prevRank: r.prevRank,
          isNew: r.prevRank === null,
          repo: {
            ...toRepoBrief(r.repo),
            description: r.repo.description,
          },
          score: r.score,
          gain: r.gain,
          acceleration: r.acceleration,
          spikePenalty: r.spikePenalty,
          kinds,
          worstLevel: worstLevel(mine.map((i) => i.currentLevel)),
          topItems: mine
            .slice(0, 3)
            .map(({ id, kind, name, currentLevel }) => ({
              id,
              kind,
              name,
              currentLevel,
            })),
        };
      }),
      nextCursor:
        rows.length > q.limit && page.length
          ? encodeCursor({ r: page[page.length - 1].rank })
          : null,
    };
  }

  /** 저장소 상세: 저장소 · 소속 Item · 기간별 트렌드 · 마켓플레이스. 쿼리 3회. */
  async repoDetail(owner: string, name: string) {
    const repo = await this.prisma.repo.findUnique({
      relationLoadStrategy: 'join',
      where: { fullNameLower: `${owner}/${name}`.toLowerCase() },
      include: {
        marketplaces: {
          select: { path: true, name: true, pluginCount: true },
          orderBy: { path: 'asc' },
        },
        // 최신 기준일 행만 쓰므로 3개(기간 수)만 가져와 JS에서 기준일로 거른다.
        trendScores: {
          orderBy: [{ asOf: 'desc' }, { window: 'asc' }],
          take: 3,
        },
      },
    });
    if (!repo || repo.status !== 'TRACKED') {
      throw new DomainException(404, 'NOT_FOUND', '저장소를 찾을 수 없습니다.');
    }
    const items = await this.prisma.item.findMany({
      relationLoadStrategy: 'join',
      where: { repoId: repo.id, status: 'ACTIVE' },
      orderBy: [{ trendScore7d: 'desc' }, { id: 'desc' }],
      select: ITEM_CARD_SELECT,
    });
    return {
      repo: {
        id: repo.id,
        fullName: `${repo.owner}/${repo.name}`,
        description: repo.description,
        url: `https://github.com/${repo.owner}/${repo.name}`,
        stars: repo.stars,
        pushedAt: repo.pushedAt,
        defaultBranch: repo.defaultBranch,
        headSha: repo.headSha,
        archived: repo.archived,
        sparkline7d: toRepoBrief(repo).sparkline7d,
      },
      items: items.map(toItemCard),
      trend: toTrendMap(repo.trendScores),
      marketplaces: repo.marketplaces,
    };
  }

  /** 홈 통계: Item 종류별 수 · 추적 저장소 수 · 마지막 수집 실행. */
  async overview() {
    const [asOf, kinds, trackedRepos, lastRun] = await Promise.all([
      this.latestAsOf(),
      this.prisma.item.groupBy({
        by: ['kind'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.repo.count({ where: { status: 'TRACKED' } }),
      this.prisma.ingestionRun.findFirst({
        where: { finishedAt: { not: null } },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true, status: true },
      }),
    ]);
    const counts = { PLUGIN: 0, SKILL: 0, HOOK: 0 };
    for (const k of kinds) counts[k.kind] = k._count._all;
    return {
      asOf: asOf?.toISOString().slice(0, 10) ?? null,
      counts,
      trackedRepos,
      lastRun,
    };
  }
}

const LEVEL_ORDER = ['SAFE', 'CAUTION', 'DANGER'] as const;

/** 저장소 Item 중 최악 등급. 미분석(null)은 제외하고, 전부 미분석이면 null. */
function worstLevel(levels: ((typeof LEVEL_ORDER)[number] | null)[]) {
  let worst = -1;
  for (const l of levels)
    if (l) worst = Math.max(worst, LEVEL_ORDER.indexOf(l));
  return worst < 0 ? null : LEVEL_ORDER[worst];
}

/** 최신 기준일의 기간별 점수·순위. 계산되지 않은 기간은 null. */
export function toTrendMap(
  rows: { window: TrendWindow; asOf: Date; score: number; rank: number }[],
) {
  const out: Record<TrendWindow, { score: number; rank: number } | null> = {
    D1: null,
    D7: null,
    D30: null,
  };
  const latest = rows[0]?.asOf.getTime();
  for (const r of rows) {
    if (r.asOf.getTime() === latest) {
      out[r.window] = { score: r.score, rank: r.rank };
    }
  }
  return out;
}
