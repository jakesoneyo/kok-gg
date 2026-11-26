// 2단계 qualify: 후보 저장소의 트리를 1회 조회해 Item을 만들고 TRACKED / IGNORED / TOO_LARGE / GONE으로 판정한다.
// 처리된 후보는 CANDIDATE 집합에서 빠지므로 별도 커서 없이도 재개가 된다(커서는 관측용으로만 기록).
import { Inject, Injectable } from '@nestjs/common';
import { GithubClient } from '../../github/github.client';
import { GithubError } from '../../github/github.types';
import { PrismaService } from '../../prisma/prisma.service';
import { INGEST_CONFIG, type IngestConfig } from '../ingest.config';
import { RepoInspector } from '../repo-inspector.service';
import type { Stage, StageContext } from '../stage';
import { chunk, errorMessage, isoDay, isPause, toDate } from '../util';

const BATCH = 50;
const RECHECK_DAYS = 30;

@Injectable()
export class QualifyStage implements Stage {
  readonly name = 'QUALIFY' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inspector: RepoInspector,
    private readonly github: GithubClient,
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    // 증거 없음으로 IGNORED 됐어도 30일 뒤 push가 있었으면 재판별(SPEC F1)
    const cutoff = new Date(
      toDate(ctx.asOf).getTime() - RECHECK_DAYS * 86_400_000,
    );
    await this.prisma.$executeRaw`
      UPDATE repo SET status = 'CANDIDATE'
       WHERE status = 'IGNORED' AND ignored_reason = 'NO_EVIDENCE'
         AND qualified_at < ${cutoff} AND pushed_at > qualified_at`;

    await this.refreshCodeSearchCandidates();

    let tracked = await this.prisma.repo.count({
      where: { status: 'TRACKED' },
    });
    const skip = new Set<number>(); // 이번 실행에서 오류로 못 끝낸 저장소(무한 루프 방지)
    let lastRepoId = 0;

    for (;;) {
      // 스타 많은 후보부터 — 상한(MAX_TRACKED_REPOS)에 걸리면 낮은 스타가 밀려난다
      const batch = await this.prisma.repo.findMany({
        where: { status: 'CANDIDATE', id: { notIn: [...skip] } },
        orderBy: [{ stars: 'desc' }, { id: 'asc' }],
        take: BATCH,
      });
      if (!batch.length) return;

      for (const repo of batch) {
        if (tracked >= this.config.maxTrackedRepos) {
          ctx.add('capped', 1);
          skip.add(repo.id);
          continue;
        }
        try {
          const out = await this.inspector.inspect(repo, 'HEAD');
          const now = new Date();
          if (out.tooLarge) {
            await this.prisma.repo.update({
              where: { id: repo.id },
              data: { status: 'TOO_LARGE', qualifiedAt: now },
            });
          } else {
            // 마켓플레이스가 이미 이 저장소에 항목을 귀속시켰다면(github/git-subdir 소스) 그것도 증거
            const hasItems =
              (await this.prisma.item.count({
                where: { repoId: repo.id, status: 'ACTIVE' },
              })) > 0;
            if (hasItems) {
              tracked += 1;
              await this.prisma.repo.update({
                where: { id: repo.id },
                data: {
                  status: 'TRACKED',
                  qualifiedAt: now,
                  trackedSince: now,
                },
              });
            } else {
              await this.prisma.repo.update({
                where: { id: repo.id },
                data: {
                  status: 'IGNORED',
                  ignoredReason: 'NO_EVIDENCE',
                  qualifiedAt: now,
                },
              });
            }
          }
          ctx.add('processed');
        } catch (e) {
          if (e instanceof GithubError && e.status === 404) {
            await this.prisma.repo.update({
              where: { id: repo.id },
              data: { status: 'GONE' },
            });
            await this.prisma.item.updateMany({
              where: { repoId: repo.id },
              data: { status: 'REMOVED' },
            });
            ctx.add('processed');
          } else if (e instanceof GithubError) {
            skip.add(repo.id);
            await ctx.failure(e.code, errorMessage(e), { repoId: repo.id });
          } else if (isPause(e)) {
            // PAUSED(레이트리밋)는 지금까지의 진행을 커서로 남기고 올린다
            await ctx.commit({ lastRepoId, paused: true });
            throw e;
          } else {
            // 그 외 예외(DB의 NUL 거부 등)도 저장소 단위로 격리 — 안 그러면 같은 저장소를 스타순으로
            // 매일 먼저 집어 단계 전체가 영구 실패한다(REVIEW B4). 진짜 치명 오류는 실패율 규칙이 올린다.
            skip.add(repo.id);
            await ctx.failure('QUALIFY_FAILED', errorMessage(e), {
              repoId: repo.id,
            });
          }
        }
        lastRepoId = repo.id;
      }
      await ctx.commit({ lastRepoId, day: isoDay(new Date()) });
    }
  }

  /**
   * 코드 검색 후보는 축약 저장소 객체라 스타·fork·archived가 기본값(0/false)으로 저장된다(upsert는 기존 행을
   * 갱신하지 않음). 스타순 선별(MAX_TRACKED_REPOS)과 fork 제외가 맞으려면 판별 직전에 GraphQL(100개/호출)로 채운다.
   * 삭제된 저장소(null)는 건드리지 않는다 — 트리 조회의 404가 GONE으로 처리한다.
   */
  private async refreshCodeSearchCandidates(): Promise<void> {
    const rows = await this.prisma.repo.findMany({
      where: { status: 'CANDIDATE', discoveredVia: 'CODE_SEARCH' },
      select: { id: true, nodeId: true },
      orderBy: { id: 'asc' },
    });
    for (const group of chunk(rows, 100)) {
      const snaps = await this.github.snapshots(group.map((r) => r.nodeId));
      for (const [i, snap] of snaps.entries()) {
        if (!snap) continue;
        await this.prisma.repo.update({
          where: { id: group[i].id },
          data: {
            stars: snap.stars,
            description: snap.description,
            defaultBranch: snap.defaultBranch,
            pushedAt: snap.pushedAt ? new Date(snap.pushedAt) : null,
            ghCreatedAt: snap.createdAt ? new Date(snap.createdAt) : null,
            archived: snap.archived,
            isFork: snap.fork,
            topics: snap.topics,
            ...(snap.fork || snap.archived
              ? {
                  status: 'IGNORED' as const,
                  ignoredReason: snap.fork ? 'fork' : 'archived',
                }
              : {}),
          },
        });
      }
    }
  }
}
