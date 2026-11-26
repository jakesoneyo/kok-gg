// Candidate(후보 저장소) 등록. discover·마켓플레이스 펼치기·awesome 시드가 같은 경로로 repo 행을 만든다.
import { Injectable } from '@nestjs/common';
import { DiscoverySource } from '@prisma/client';
import type { GhRepo } from '../github/github.types';
import { PrismaService } from '../prisma/prisma.service';

const fullNameLower = (r: Pick<GhRepo, 'owner' | 'name'>) =>
  `${r.owner}/${r.name}`.toLowerCase();

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 없는 저장소만 CANDIDATE로 만든다(있으면 상태·값을 건드리지 않음 — 멱등, ON CONFLICT DO NOTHING).
   * 포크·아카이브는 처음부터 IGNORED. 반환: ids = fullNameLower → repo.id (기존 행 포함), created = 새로 생긴 행 수.
   */
  async upsertCandidates(
    repos: readonly GhRepo[],
    via: DiscoverySource,
  ): Promise<{ ids: Map<string, number>; created: number }> {
    if (!repos.length) return { ids: new Map(), created: 0 };
    const unique = [...new Map(repos.map((r) => [r.githubId, r])).values()];
    const { count: created } = await this.prisma.repo.createMany({
      skipDuplicates: true,
      data: unique.map((r) => ({
        githubId: BigInt(r.githubId),
        nodeId: r.nodeId,
        owner: r.owner,
        name: r.name,
        fullNameLower: fullNameLower(r),
        description: r.description,
        defaultBranch: r.defaultBranch,
        stars: r.stars,
        pushedAt: r.pushedAt ? new Date(r.pushedAt) : null,
        ghCreatedAt: r.createdAt ? new Date(r.createdAt) : null,
        archived: r.archived,
        isFork: r.fork,
        topics: r.topics,
        discoveredVia: via,
        ...(r.fork || r.archived
          ? {
              status: 'IGNORED' as const,
              ignoredReason: r.fork ? 'fork' : 'archived',
            }
          : {}),
      })),
    });
    const rows = await this.prisma.repo.findMany({
      where: { githubId: { in: unique.map((r) => BigInt(r.githubId)) } },
      select: { id: true, fullNameLower: true },
    });
    return {
      ids: new Map(rows.map((r) => [r.fullNameLower, r.id])),
      created,
    };
  }
}
