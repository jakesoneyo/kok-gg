// 수집 단계 계약. 단계는 DB·GitHub만 알고 체크포인트(커서·통계·실패 기록)는 StageContext로만 남긴다.
import type { Prisma, StageName } from '@prisma/client';

export type Cursor = Record<string, unknown> | null;

export interface StageContext {
  readonly runId: number;
  /** 실행 기준일 YYYY-MM-DD(UTC). */
  readonly asOf: string;
  /** 이전 시도에서 저장된 커서(처음이면 null). */
  readonly cursor: Cursor;
  readonly stats: Record<string, number>;
  /** 통계 카운터 가산(commit·단계 종료 때 함께 저장). */
  add(key: string, n?: number): void;
  /**
   * 한 처리 단위(저장소 50개 등)의 쓰기와 커서 갱신을 같은 트랜잭션으로 커밋한다.
   * 크래시해도 중복 처리 범위는 최대 한 묶음이고, 쓰기가 전부 upsert라 무해하다.
   */
  commit(
    cursor: Cursor,
    writes?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void>;
  /** 저장소·항목 단위 실패를 기록하고 계속한다(실패 격리). */
  failure(
    code: string,
    message: string,
    ref?: { repoId?: number; itemId?: number },
  ): Promise<void>;
}

export interface Stage {
  readonly name: StageName;
  /**
   * 끝까지 돌면 정상 반환. RateLimitPausedError를 던지면 파이프라인이 PAUSED로 기록하고 다음 단계로 간다.
   * 그 외 예외는 단계 FAILED.
   */
  run(ctx: StageContext): Promise<void>;
}

/** 파이프라인이 실행하는 단계 목록(순서 = 실행 순서)의 DI 토큰. */
export const STAGES = Symbol('INGEST_STAGES');
