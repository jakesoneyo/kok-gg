// 단계 체크포인트: ingestion_stage 행(상태·커서·통계)과 실패 기록. 커서는 처리 단위 커밋과 같은 트랜잭션에서 갱신한다.
import { Injectable } from '@nestjs/common';
import { Prisma, StageName, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Cursor, StageContext } from './stage';

const toStats = (v: Prisma.JsonValue): Record<string, number> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (Object.fromEntries(
        Object.entries(v).filter(([, x]) => typeof x === 'number'),
      ) as Record<string, number>)
    : {};

class Ctx implements StageContext {
  constructor(
    private readonly prisma: PrismaService,
    readonly runId: number,
    private readonly stage: StageName,
    readonly asOf: string,
    readonly cursor: Cursor,
    readonly stats: Record<string, number>,
  ) {}

  add(key: string, n = 1) {
    this.stats[key] = (this.stats[key] ?? 0) + n;
  }

  async commit(
    cursor: Cursor,
    writes?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    await this.prisma.$transaction(
      async (tx) => {
        await writes?.(tx);
        await tx.ingestionStage.update({
          where: { runId_stage: { runId: this.runId, stage: this.stage } },
          data: {
            cursor: (cursor ?? Prisma.DbNull) as Prisma.InputJsonValue,
            stats: this.stats,
          },
        });
      },
      { timeout: 60_000 },
    );
  }

  async failure(
    code: string,
    message: string,
    ref: { repoId?: number; itemId?: number } = {},
  ) {
    this.add('failed');
    await this.prisma.ingestionFailure.create({
      data: {
        runId: this.runId,
        stage: this.stage,
        code,
        message: message.slice(0, 500),
        ...ref,
      },
    });
  }
}

@Injectable()
export class CheckpointService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 단계를 시작한다. 이미 DONE이면 null(건너뜀). RUNNING(강제 종료 흔적)·PAUSED·FAILED는 저장된 커서·통계를 이어받는다.
   */
  async open(
    runId: number,
    stage: StageName,
    asOf: string,
  ): Promise<StageContext | null> {
    const row = await this.prisma.ingestionStage.upsert({
      where: { runId_stage: { runId, stage } },
      create: { runId, stage },
      update: {},
    });
    if (row.status === 'DONE') return null;
    await this.prisma.ingestionStage.update({
      where: { runId_stage: { runId, stage } },
      data: {
        status: 'RUNNING',
        error: null,
        startedAt: row.startedAt ?? new Date(),
        finishedAt: null,
      },
    });
    return new Ctx(
      this.prisma,
      runId,
      stage,
      asOf,
      (row.cursor as Cursor) ?? null,
      toStats(row.stats),
    );
  }

  async finish(
    ctx: StageContext,
    stage: StageName,
    status: Extract<StageStatus, 'DONE' | 'PAUSED' | 'FAILED'>,
    error?: string,
  ) {
    await this.prisma.ingestionStage.update({
      where: { runId_stage: { runId: ctx.runId, stage } },
      data: {
        status,
        error: error?.slice(0, 500) ?? null,
        stats: ctx.stats,
        finishedAt: new Date(),
      },
    });
  }

  /** 요청되지 않은 단계는 SKIPPED로 남긴다(이미 행이 있으면 건드리지 않음). */
  async markSkipped(runId: number, stage: StageName) {
    await this.prisma.ingestionStage.upsert({
      where: { runId_stage: { runId, stage } },
      create: { runId, stage, status: 'SKIPPED' },
      update: {},
    });
  }
}
