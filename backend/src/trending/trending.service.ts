// 트렌딩 계산·저장(ARCHITECTURE 5.3). 순수 함수(dailyGains·computeTrendScore·rankTrendScores)를 DB에 연결하는 얇은 층.
// 점수·순위·전일 순위·item/repo 비정규화가 한 트랜잭션이라 목록 응답이 중간 상태를 보지 않는다.
import { Injectable } from '@nestjs/common';
import { TrendWindow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { addDays } from './algo/dates';
import { dailyGains, sparkline7d, type StarDayRow } from './algo/gains';
import {
  computeTrendScore,
  PARAMS_VERSION,
  rankTrendScores,
  TREND_PARAMS,
} from './algo/trend';

const WINDOWS = Object.keys(TREND_PARAMS.window) as TrendWindow[];
const HISTORY_DAYS = 60; // 30일 기간 + 직전 30일
const RETENTION_DAYS = 90;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Scored {
  repoId: number;
  score: number;
  gain: number;
  acceleration: number;
  spikePenalty: number;
}

@Injectable()
export class TrendingService {
  constructor(private readonly prisma: PrismaService) {}

  /** asOf 하루치 트렌딩을 (재)계산한다. 같은 asOf를 다시 돌려도 결과가 같다(그날 행을 지우고 다시 씀). 반환: 기간별 자격 저장소 수. */
  async compute(asOf: string): Promise<Record<TrendWindow, number>> {
    const from = addDays(asOf, -(HISTORY_DAYS - 1));
    const repos = await this.prisma.repo.findMany({
      where: { status: 'TRACKED' },
      select: { id: true, stars: true, ghCreatedAt: true, firstSeenAt: true },
    });
    const rowsByRepo = new Map<number, StarDayRow[]>();
    const days = await this.prisma.repoStarDay.findMany({
      where: { day: { gte: new Date(addDays(from, -1)) } },
    });
    for (const d of days) {
      const list = rowsByRepo.get(d.repoId) ?? [];
      list.push({
        day: isoDay(d.day),
        snapshotTotal: d.snapshotTotal,
        officialAdded: d.officialAdded,
      });
      rowsByRepo.set(d.repoId, list);
    }

    const byWindow = Object.fromEntries(
      WINDOWS.map((w) => [w, [] as Scored[]]),
    ) as Record<TrendWindow, Scored[]>;
    const sparklines: { id: number; s: (number | null)[] }[] = [];

    for (const repo of repos) {
      const rows = rowsByRepo.get(repo.id) ?? [];
      const series = dailyGains(rows, from, asOf);
      sparklines.push({ id: repo.id, s: sparkline7d(rows, asOf) });
      // 생성일을 모르면 발견일로 대신 — 나이가 어리게 보여 가속도 가산이 꺼지는 보수적 방향
      const createdAt = isoDay(repo.ghCreatedAt ?? repo.firstSeenAt);
      for (const window of WINDOWS) {
        const r = computeTrendScore(series, {
          window,
          asOf,
          totalStars: repo.stars,
          repoCreatedAt: createdAt,
        });
        if (r)
          byWindow[window].push({
            repoId: repo.id,
            score: r.score,
            gain: r.gain,
            acceleration: r.acceleration,
            spikePenalty: r.penalty,
          });
      }
    }
    const ranked = Object.fromEntries(
      WINDOWS.map((w) => [w, rankTrendScores(byWindow[w])]),
    ) as Record<TrendWindow, (Scored & { rank: number })[]>;

    const asOfDate = new Date(asOf);
    await this.prisma.$transaction(
      async (tx) => {
        for (const window of WINDOWS) {
          // 전일 순위 = 이 날짜 이전에 가장 최근에 계산된 같은 기간 순위(실행이 하루 빠져도 NEW로 오인하지 않음)
          const prev = await tx.trendScore.findFirst({
            where: { window, asOf: { lt: asOfDate } },
            orderBy: { asOf: 'desc' },
            select: { asOf: true },
          });
          const prevRank = new Map(
            prev
              ? (
                  await tx.trendScore.findMany({
                    where: { window, asOf: prev.asOf },
                    select: { repoId: true, rank: true },
                  })
                ).map((r) => [r.repoId, r.rank])
              : [],
          );
          await tx.trendScore.deleteMany({ where: { window, asOf: asOfDate } });
          await tx.trendScore.createMany({
            data: ranked[window].map((e) => ({
              window,
              asOf: asOfDate,
              repoId: e.repoId,
              score: e.score,
              gain: e.gain,
              acceleration: e.acceleration,
              spikePenalty: e.spikePenalty,
              rank: e.rank,
              prevRank: prevRank.get(e.repoId) ?? null,
              paramsVersion: PARAMS_VERSION,
            })),
          });
        }
        // 비정규화: 전체 초기화 후 자격 저장소만 채운다(자격을 잃은 저장소가 옛 점수를 들고 있지 않게)
        await tx.$executeRaw`UPDATE item SET trend_score_7d = 0, trend_rank_7d = NULL, prev_trend_rank_7d = NULL
                              WHERE trend_score_7d <> 0 OR trend_rank_7d IS NOT NULL OR prev_trend_rank_7d IS NOT NULL`;
        await tx.$executeRaw`
          UPDATE item SET trend_score_7d = t.score, trend_rank_7d = t.rank, prev_trend_rank_7d = t.prev_rank
            FROM trend_score t
           WHERE t.repo_id = item.repo_id AND t."window" = 'D7' AND t.as_of = ${asOfDate}`;
        // 스파크라인: 저장소마다 UPDATE하지 않고 한 문장으로
        await tx.$executeRaw`
          UPDATE repo SET sparkline_7d = v.s
            FROM jsonb_to_recordset(${JSON.stringify(sparklines)}::jsonb) AS v(id int, s jsonb)
           WHERE repo.id = v.id`;
        await tx.trendScore.deleteMany({
          where: { asOf: { lt: new Date(addDays(asOf, -RETENTION_DAYS)) } },
        });
      },
      { timeout: 120_000 },
    );
    return Object.fromEntries(
      WINDOWS.map((w) => [w, ranked[w].length]),
    ) as Record<TrendWindow, number>;
  }
}
