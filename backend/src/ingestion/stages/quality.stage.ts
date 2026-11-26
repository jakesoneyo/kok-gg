// 9단계 quality: 스타 출처 교차검증·이상치를 data_quality_issue로 기록한다. 같은 (종류, 저장소, 기간 끝)은 1건만 — 재실행해도 중복 없음.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { addDays } from '../../trending/algo/dates';
import {
  crossValidateStars,
  type QualityIssue,
} from '../../trending/algo/cross-validate';
import { ExternalStarSource } from '../external-star-source';
import type { Stage, StageContext } from '../stage';
import { chunk, isoDay, toDate } from '../util';

const CHUNK = 200;
/** crossValidateStars의 "생성 30주 이내" 판정에 필요한 공식 기록 전체 구간. */
const YOUNG_DAYS = 215;
const RECENT_DAYS = 8; // 7일 합 + 전일 차분

@Injectable()
export class QualityStage implements Stage {
  readonly name = 'QUALITY' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly external: ExternalStarSource,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    const asOf = ctx.asOf;
    // 공식 값은 완결된 날(< asOf)만 저장되므로 교차검증 구간의 끝은 어제 — asOf를 넣으면 공식 값이 늘 비어 비교가 성립하지 않는다
    const lastComplete = addDays(asOf, -1);
    const repos = await this.prisma.repo.findMany({
      where: { status: 'TRACKED' },
      select: { id: true, stars: true, ghCreatedAt: true, firstSeenAt: true },
      orderBy: { id: 'asc' },
    });
    const externalEnabled = this.external.isActive(asOf);

    for (const part of chunk(repos, CHUNK)) {
      const created = new Map(
        part.map((r) => [r.id, isoDay(r.ghCreatedAt ?? r.firstSeenAt)]),
      );
      // 30주 이내 저장소만 공식 기록 전체가 필요 — 나머지는 최근 며칠이면 충분(읽는 행 수 절약)
      const young = part
        .filter((r) => asOf < addDays(created.get(r.id)!, YOUNG_DAYS - 5))
        .map((r) => r.id);
      const old = part.map((r) => r.id).filter((id) => !young.includes(id));
      const days = await this.prisma.repoStarDay.findMany({
        where: {
          OR: [
            {
              repoId: { in: young },
              day: { gte: toDate(addDays(asOf, -YOUNG_DAYS)) },
            },
            {
              repoId: { in: old },
              day: { gte: toDate(addDays(asOf, -RECENT_DAYS)) },
            },
          ],
        },
      });
      const byRepo = new Map<
        number,
        {
          day: string;
          snapshotTotal: number | null;
          officialAdded: number | null;
          externalAdded: number | null;
        }[]
      >();
      for (const d of days) {
        const list = byRepo.get(d.repoId) ?? [];
        list.push({
          day: isoDay(d.day),
          snapshotTotal: d.snapshotTotal,
          officialAdded: d.officialAdded,
          externalAdded: d.externalAdded,
        });
        byRepo.set(d.repoId, list);
      }
      const found: { repoId: number; issue: QualityIssue }[] = [];
      for (const r of part) {
        const issues = crossValidateStars(byRepo.get(r.id) ?? [], {
          asOf: lastComplete,
          stars: r.stars,
          repoCreatedAt: created.get(r.id)!,
          externalEnabled,
        });
        found.push(...issues.map((issue) => ({ repoId: r.id, issue })));
      }
      await this.save(ctx, found);
    }

    // 백필 대상인데 공식 호출이 끝내 실패한 저장소(단계 4가 남긴 실패 기록 + 아직 백필 전)
    const failed = await this.prisma.ingestionFailure.findMany({
      where: {
        runId: ctx.runId,
        stage: 'STAR_HISTORY',
        code: 'STAR_HISTORY_FAILED',
        repoId: { not: null },
      },
      select: { repoId: true, message: true },
      distinct: ['repoId'],
    });
    const pending = await this.prisma.repo.findMany({
      where: {
        id: { in: failed.map((f) => f.repoId!) },
        starBackfilledAt: null,
      },
      select: { id: true },
    });
    await this.save(
      ctx,
      pending.map((r) => ({
        repoId: r.id,
        issue: {
          kind: 'OFFICIAL_HISTORY_FAILED' as const,
          windowStart: asOf,
          windowEnd: asOf,
          diff: 0,
          values: {},
        },
      })),
    );
    await ctx.commit(null);
  }

  private async save(
    ctx: StageContext,
    found: { repoId: number; issue: QualityIssue }[],
  ) {
    for (const { repoId, issue } of found) {
      await this.prisma.dataQualityIssue.upsert({
        where: {
          kind_repoId_windowEnd: {
            kind: issue.kind,
            repoId,
            windowEnd: toDate(issue.windowEnd),
          },
        },
        create: {
          kind: issue.kind,
          repoId,
          windowStart: toDate(issue.windowStart),
          windowEnd: toDate(issue.windowEnd),
          values: issue.values,
          diff: issue.diff,
          detectedRunId: ctx.runId,
        },
        // 이미 RESOLVED/IGNORED 처리된 이슈의 상태는 되돌리지 않는다
        update: {
          values: issue.values,
          diff: issue.diff,
          windowStart: toDate(issue.windowStart),
        },
      });
      ctx.add('issues');
    }
    ctx.add('processed', found.length);
  }
}
