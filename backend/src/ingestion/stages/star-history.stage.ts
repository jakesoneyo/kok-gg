// 4단계 star-history: 공식 Star History(최근 30주 일별)로 신규 Tracked 저장소를 백필하고, 나머지는 요일 순환 1/7만 다시 받는다.
// 공식 값은 완결된 날(day < asOf)만 저장 — 당일은 부분값이라 교차검증을 오염시킨다.
import { Injectable } from '@nestjs/common';
import { GithubClient } from '../../github/github.client';
import type { StarWeek } from '../../github/github.types';
import { PrismaService } from '../../prisma/prisma.service';
import { ExternalStarSource } from '../external-star-source';
import type { Stage, StageContext } from '../stage';
import { errorMessage, forEachLimit, isoDay, isPause } from '../util';

const BATCH = 50;
const DAY_MS = 86_400_000;

/** 주 시작(일요일) 기준 7칸 → (날짜, 증가량). week는 Unix 초로 가정 — [미검증], 라이브 캡처 후 확인. */
export function officialDays(
  weeks: readonly StarWeek[],
  asOf: string,
): { day: string; added: number }[] {
  return weeks
    .flatMap((w) =>
      w.days.map((added, i) => ({
        day: isoDay(new Date(w.week * 1000 + i * DAY_MS)),
        added,
      })),
    )
    .filter((d) => d.day < asOf);
}

@Injectable()
export class StarHistoryStage implements Stage {
  readonly name = 'STAR_HISTORY' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubClient,
    private readonly external: ExternalStarSource,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    // id % 7 == (에포크 이후 일수 % 7)인 저장소가 오늘의 순환 샘플 → 7일에 한 번씩 전체가 돈다
    const slot = Math.floor(Date.parse(ctx.asOf) / DAY_MS) % 7;
    let after = Number(ctx.cursor?.lastRepoId ?? 0);

    for (;;) {
      const repos = await this.prisma.$queryRaw<
        { id: number; owner: string; name: string }[]
      >`
        SELECT id, owner, name FROM repo
         WHERE status = 'TRACKED' AND id > ${after}
           AND (star_backfilled_at IS NULL OR id % 7 = ${slot})
         ORDER BY id LIMIT ${BATCH}`;
      if (!repos.length) return;

      const out: {
        repoId: number;
        day: string;
        official: number | null;
        external: number | null;
      }[] = [];
      const done: number[] = [];
      await forEachLimit(repos, 4, async (r) => {
        try {
          const days = officialDays(
            await this.github.starHistory(r.owner, r.name),
            ctx.asOf,
          );
          const ext = new Map(
            (await this.external.fetchDaily(r.owner, r.name, ctx.asOf))?.map(
              (e) => [e.day, e.added],
            ) ?? [],
          );
          const seen = new Set<string>();
          for (const d of days) {
            seen.add(d.day);
            out.push({
              repoId: r.id,
              day: d.day,
              official: d.added,
              external: ext.get(d.day) ?? null,
            });
          }
          for (const [day, added] of ext)
            if (!seen.has(day) && day < ctx.asOf)
              out.push({ repoId: r.id, day, official: null, external: added });
          done.push(r.id);
          ctx.add('processed');
        } catch (e) {
          // 3회 재시도는 클라이언트가 이미 했다. 레이트리밋(PAUSED)은 단계 수준이라 그대로 올린다
          if (isPause(e)) throw e;
          await ctx.failure('STAR_HISTORY_FAILED', errorMessage(e), {
            repoId: r.id,
          });
        }
      });

      after = repos[repos.length - 1].id;
      await ctx.commit({ lastRepoId: after }, async (tx) => {
        if (out.length) {
          // 한 문장 upsert: 출처 컬럼은 서로 덮어쓰지 않는다(COALESCE) — 외부 값만 있는 날이 공식 값을 지우지 않게
          await tx.$executeRaw`
            INSERT INTO repo_star_day (repo_id, day, official_added, external_added, updated_at)
            SELECT t.repo_id, t.day, t.official, t.external, now()
              FROM unnest(${out.map((o) => o.repoId)}::int[], ${out.map((o) => o.day)}::date[],
                          ${out.map((o) => o.official)}::int[], ${out.map((o) => o.external)}::int[])
                   AS t(repo_id, day, official, external)
            ON CONFLICT (repo_id, day) DO UPDATE SET
              official_added = COALESCE(EXCLUDED.official_added, repo_star_day.official_added),
              external_added = COALESCE(EXCLUDED.external_added, repo_star_day.external_added),
              updated_at = now()`;
        }
        if (done.length)
          await tx.repo.updateMany({
            where: { id: { in: done } },
            data: { starBackfilledAt: new Date() },
          });
      });
    }
  }
}
