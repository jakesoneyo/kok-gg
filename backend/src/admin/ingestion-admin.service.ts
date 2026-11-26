// 관리자: 수집 실행 요청·이력 조회. 실제 수집은 배치 컨테이너(C4)가 하고, 여기서는 run 행 생성과 워크플로 dispatch만 한다.
import { Injectable, Logger } from '@nestjs/common';
import { IngestionRun, StageName } from '@prisma/client';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/cursor/cursor.codec';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';

const toRunBrief = (run: IngestionRun) => ({
  id: run.id,
  trigger: run.trigger,
  asOf: run.asOf.toISOString().slice(0, 10),
  status: run.status,
  stages: run.stages,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
});

const cursorSchema = z.object({ id: z.number().int().positive() });

@Injectable()
export class IngestionAdminService {
  private readonly logger = new Logger(IngestionAdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 수동 실행 요청. 활성(REQUESTED/RUNNING) 실행이 있으면 409.
   * ponytail: check-then-create라 관리자 두 명이 같은 ms에 누르면 둘 다 통과할 수 있다 — 배치의 advisory lock이
   * 실제 동시 실행을 막으므로 허용. 엄격히 하려면 활성 여부를 유니크 키로 승격.
   */
  async requestRun(userId: number, stages: StageName[]) {
    const active = await this.prisma.ingestionRun.findFirst({
      where: { status: { in: ['REQUESTED', 'RUNNING'] } },
      select: { id: true },
    });
    if (active) {
      throw new DomainException(
        409,
        'RUN_ALREADY_ACTIVE',
        '이미 진행 중이거나 대기 중인 실행이 있습니다.',
        { runId: active.id },
      );
    }
    const run = await this.prisma.ingestionRun.create({
      data: {
        trigger: 'MANUAL',
        asOf: new Date(new Date().toISOString().slice(0, 10)),
        stages,
        requestedBy: userId,
      },
    });
    return { runId: run.id, dispatched: await this.dispatch(run.id, stages) };
  }

  /**
   * GitHub workflow_dispatch 호출. 토큰이 없거나 실패하면 false — run 행은 REQUESTED로 남아
   * 다음 정기 실행이 집어 간다(ARCHITECTURE 3.2). 실패가 요청 자체를 실패시키지 않는다.
   */
  private async dispatch(runId: number, stages: StageName[]): Promise<boolean> {
    const { GH_DISPATCH_TOKEN, GH_DISPATCH_REPO, GH_DISPATCH_WORKFLOW } =
      process.env;
    if (!GH_DISPATCH_TOKEN || !GH_DISPATCH_REPO || !GH_DISPATCH_WORKFLOW) {
      return false;
    }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_DISPATCH_REPO}/actions/workflows/${GH_DISPATCH_WORKFLOW}/dispatches`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${GH_DISPATCH_TOKEN}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            ref: process.env.GH_DISPATCH_REF ?? 'main',
            inputs: { run_id: String(runId), stages: stages.join(',') },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!res.ok) this.logger.error(`workflow_dispatch 실패 ${res.status}`);
      return res.ok;
    } catch (err) {
      this.logger.error(
        `workflow_dispatch 호출 실패: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /**
   * 실행 이력 keyset 페이지(id 내림차순). 실패 건수는 COUNT 서브쿼리 없이 _count로 한 번에 가져온다.
   *
   * @param q limit·cursor
   * @throws DomainException 400 INVALID_CURSOR
   */
  async listRuns(q: { cursor?: string; limit: number }) {
    const c = q.cursor ? decodeCursor(q.cursor, cursorSchema) : null;
    const rows = await this.prisma.ingestionRun.findMany({
      where: c ? { id: { lt: c.id } } : undefined,
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      include: { _count: { select: { failures: true } } },
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((run) => ({
        ...toRunBrief(run),
        failureCount: run._count.failures,
      })),
      nextCursor:
        rows.length > q.limit
          ? encodeCursor({ id: page[page.length - 1].id })
          : null,
    };
  }

  /** 실행 상세: 단계 체크포인트 + 최근 실패 100건(저장소 이름은 한 번에 조회). */
  async runDetail(id: number) {
    const run = await this.prisma.ingestionRun.findUnique({
      where: { id },
      include: {
        stageRows: { orderBy: { startedAt: 'asc' } },
        failures: { orderBy: { id: 'desc' }, take: 100 },
      },
    });
    if (!run) {
      throw new DomainException(404, 'NOT_FOUND', '실행을 찾을 수 없습니다.');
    }
    const repoIds = [
      ...new Set(run.failures.flatMap((f) => (f.repoId ? [f.repoId] : []))),
    ];
    const repos = await this.prisma.repo.findMany({
      where: { id: { in: repoIds } },
      select: { id: true, owner: true, name: true },
    });
    const names = new Map(repos.map((r) => [r.id, `${r.owner}/${r.name}`]));

    return {
      run: toRunBrief(run),
      stages: run.stageRows.map((s) => ({
        stage: s.stage,
        status: s.status,
        cursor: s.cursor,
        stats: s.stats,
        error: s.error,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
      })),
      failures: run.failures.map((f) => ({
        stage: f.stage,
        repoFullName: f.repoId ? (names.get(f.repoId) ?? null) : null,
        code: f.code,
        message: f.message,
        createdAt: f.createdAt,
      })),
    };
  }
}
