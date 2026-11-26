// 3단계 snapshot: GraphQL `nodes(ids:)` 100개씩 stargazerCount·pushedAt·headSha를 받아 오늘 스냅샷(repo_star_day)과
// 카탈로그 정렬용 비정규화 컬럼(item.repo_stars·repo_pushed_at)을 갱신한다.
import { Injectable } from '@nestjs/common';
import { GithubClient } from '../../github/github.client';
import { PrismaService } from '../../prisma/prisma.service';
import type { Stage, StageContext } from '../stage';
import { toDate } from '../util';

const BATCH = 100;

@Injectable()
export class SnapshotStage implements Stage {
  readonly name = 'SNAPSHOT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubClient,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    const day = toDate(ctx.asOf);
    let after = Number(ctx.cursor?.lastRepoId ?? 0);

    for (;;) {
      const repos = await this.prisma.repo.findMany({
        where: { status: 'TRACKED', id: { gt: after } },
        orderBy: { id: 'asc' },
        take: BATCH,
        select: { id: true, nodeId: true },
      });
      if (!repos.length) return;

      const snaps = await this.github.snapshots(repos.map((r) => r.nodeId));
      const live = repos.flatMap((r, i) =>
        snaps[i] ? [{ r, s: snaps[i] }] : [],
      );
      const gone = repos.filter((_, i) => !snaps[i]).map((r) => r.id);
      const stopped = live
        .filter(({ s }) => s.archived || s.fork)
        .map(({ r }) => r.id);

      after = repos[repos.length - 1].id;
      ctx.add('processed', repos.length);
      await ctx.commit({ lastRepoId: after }, async (tx) => {
        for (const { r, s } of live) {
          await tx.repo.update({
            where: { id: r.id },
            data: {
              owner: s.owner,
              name: s.name,
              fullNameLower: `${s.owner}/${s.name}`.toLowerCase(),
              description: s.description,
              defaultBranch: s.defaultBranch,
              headSha: s.headSha,
              stars: s.stars,
              pushedAt: s.pushedAt ? new Date(s.pushedAt) : null,
              ghCreatedAt: s.createdAt ? new Date(s.createdAt) : null,
              archived: s.archived,
              isFork: s.fork,
              topics: s.topics,
            },
          });
          // 같은 날 재실행은 같은 행을 덮어쓴다(자연키 upsert)
          await tx.repoStarDay.upsert({
            where: { repoId_day: { repoId: r.id, day } },
            create: { repoId: r.id, day, snapshotTotal: s.stars },
            update: { snapshotTotal: s.stars },
          });
        }
        // 접근 불가(삭제·비공개)·아카이브·포크는 추적 종료 — 항목도 목록에서 내린다
        const ended = [...gone, ...stopped];
        if (ended.length) {
          await tx.repo.updateMany({
            where: { id: { in: gone } },
            data: { status: 'GONE' },
          });
          await tx.repo.updateMany({
            where: { id: { in: stopped } },
            data: { status: 'IGNORED', ignoredReason: 'archived_or_fork' },
          });
          await tx.item.updateMany({
            where: { repoId: { in: ended } },
            data: { status: 'REMOVED' },
          });
        }
        if (live.length) {
          await tx.$executeRaw`
            UPDATE item SET repo_stars = r.stars, repo_pushed_at = COALESCE(r.pushed_at, item.repo_pushed_at)
              FROM repo r WHERE item.repo_id = r.id AND r.id = ANY(${live.map(({ r }) => r.id)}::int[])`;
        }
      });
    }
  }
}
