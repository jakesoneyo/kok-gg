// 수집 파이프라인 오케스트레이터: advisory lock → run upsert → 9단계 순회 → 상태 확정(ARCHITECTURE 3장).
import { Inject, Injectable, Logger } from '@nestjs/common';
import { IngestionRun, RunStatus, StageName } from '@prisma/client';
import { Client } from 'pg';
import { GithubClient } from '../github/github.client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckpointService } from './checkpoint.service';
import { STAGES, type Stage } from './stage';
import { errorMessage, isoDay, isPause, toDate } from './util';

const LOCK_NAME = 'kok-ingest';
/** 처리 건수 대비 실패율이 이를 넘으면 단계 FAILED(ARCHITECTURE 3.1). */
const MAX_FAIL_RATE = 0.2;

export interface IngestOptions {
  /** 기본: 지금 UTC 날짜. */
  asOf?: string;
  /** 관리자 수동 실행(MANUAL) 행을 이어서 실행. */
  runId?: number;
  /** 생략하면 run.stages(빈 배열 = 전체). */
  stages?: StageName[];
}

export type IngestOutcome =
  { skipped: true } | { skipped: false; runId: number; status: RunStatus };

@Injectable()
export class IngestionPipeline {
  private readonly logger = new Logger(IngestionPipeline.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checkpoint: CheckpointService,
    private readonly github: GithubClient,
    @Inject(STAGES) private readonly stages: readonly Stage[],
  ) {}

  /**
   * 실행 1회. 다른 실행이 진행 중이면 아무것도 하지 않고 `{skipped:true}`(종료 코드 0 — 크론 겹침은 오류가 아님).
   * 락은 풀러(트랜잭션 모드)를 거치면 의미가 없으므로 직결 URL의 전용 연결에 건다 — 연결이 살아 있는 동안만 유효하고
   * 프로세스가 죽으면 DB가 자동으로 푼다.
   */
  async ingest(opts: IngestOptions = {}): Promise<IngestOutcome> {
    const lock = new Client({
      connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
    });
    await lock.connect();
    try {
      const { rows } = await lock.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS ok',
        [LOCK_NAME],
      );
      if (!rows[0].ok) {
        this.logger.warn('다른 수집이 진행 중 — 종료');
        return { skipped: true };
      }
      // 락을 쥔 건 이 프로세스뿐이므로 RUNNING으로 남은 run은 강제 종료된 배치의 흔적이다. 정리하지 않으면
      // 관리자 수동 요청이 영원히 409가 된다(REVIEW Y5). openRun 전에 해야 이어받을 run이 RUNNING→RUNNING으로 보존된다.
      await this.prisma.ingestionRun.updateMany({
        where: { status: 'RUNNING' },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      const run = await this.openRun(opts);
      const status = await this.execute(run, opts.stages ?? run.stages);
      return { skipped: false, runId: run.id, status };
    } finally {
      await lock.end();
    }
  }

  /**
   * 정기 실행이 끝난 뒤 REQUESTED로 남은 수동 실행(워크플로 dispatch 실패·토큰 없음)을 순서대로 집어 간다(ARCHITECTURE 3.2).
   * 반환: 실행한 run id들.
   */
  async drainRequested(): Promise<number[]> {
    const done: number[] = [];
    for (;;) {
      const next = await this.prisma.ingestionRun.findFirst({
        where: { status: 'REQUESTED', id: { notIn: done } },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      if (!next) return done;
      done.push(next.id);
      const out = await this.ingest({ runId: next.id });
      if (out.skipped) return done;
    }
  }

  private async openRun(opts: IngestOptions): Promise<IngestionRun> {
    const asOfDay = opts.asOf ?? isoDay(new Date());
    const asOf = toDate(asOfDay);
    const started = { status: 'RUNNING' as const, finishedAt: null };
    if (opts.runId) {
      const run = await this.prisma.ingestionRun.findUniqueOrThrow({
        where: { id: opts.runId },
      });
      return this.prisma.ingestionRun.update({
        where: { id: run.id },
        data: { ...started, asOf, startedAt: run.startedAt ?? new Date() },
      });
    }
    // 정기 실행은 하루 1행(cronKey 유일) — 같은 날 재실행은 같은 행·같은 체크포인트를 이어받는다
    return this.prisma.ingestionRun.upsert({
      where: { cronKey: asOfDay },
      create: {
        trigger: 'CRON',
        asOf,
        cronKey: asOfDay,
        startedAt: new Date(),
        ...started,
      },
      update: started,
    });
  }

  private async execute(
    run: IngestionRun,
    requested: readonly StageName[],
  ): Promise<RunStatus> {
    const asOf = isoDay(run.asOf);
    const wanted = new Set(
      requested.length ? requested : this.stages.map((s) => s.name),
    );
    const results: Record<string, 'DONE' | 'PAUSED' | 'FAILED'> = {};

    for (const stage of this.stages) {
      if (!wanted.has(stage.name)) {
        await this.checkpoint.markSkipped(run.id, stage.name);
        continue;
      }
      const ctx = await this.checkpoint.open(run.id, stage.name, asOf);
      if (!ctx) {
        results[stage.name] = 'DONE';
        continue;
      }
      const before = this.github.usage();
      let status: 'DONE' | 'PAUSED' | 'FAILED' = 'DONE';
      let error: string | undefined;
      try {
        await stage.run(ctx);
      } catch (e) {
        if (isPause(e)) status = 'PAUSED';
        else {
          status = 'FAILED';
          error = errorMessage(e);
          this.logger.error(`단계 ${stage.name} 실패: ${error}`);
        }
      }
      const total = (ctx.stats.processed ?? 0) + (ctx.stats.failed ?? 0);
      if (
        status === 'DONE' &&
        total > 0 &&
        (ctx.stats.failed ?? 0) / total > MAX_FAIL_RATE
      ) {
        status = 'FAILED';
        error = `실패율 ${ctx.stats.failed}/${total}`;
      }
      const after = this.github.usage();
      ctx.add('ghCoreUsed', after.core - before.core);
      ctx.add('ghGraphqlUsed', after.graphql - before.graphql);
      ctx.add('ghSearchUsed', after.search - before.search);
      ctx.add('ghCodeSearchUsed', after.codeSearch - before.codeSearch);
      await this.checkpoint.finish(ctx, stage.name, status, error);
      results[stage.name] = status;
    }

    // 하나도 못 끝내고 실패가 있으면 FAILED, 일부만 끝났거나 PAUSED가 있으면 PARTIAL
    const statuses = Object.values(results);
    const final: RunStatus = statuses.every((s) => s === 'DONE')
      ? 'SUCCEEDED'
      : statuses.some((s) => s === 'DONE') || !statuses.includes('FAILED')
        ? 'PARTIAL'
        : 'FAILED';
    await this.prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: final, finishedAt: new Date() },
    });
    return final;
  }
}
