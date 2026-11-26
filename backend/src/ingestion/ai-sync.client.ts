// FastAPI 내부 동기화 호출(POST /internal/jobs/sync). 요약·임베딩·검색 문서 갱신은 AI 서비스 소관 — 배치는 반복 호출만 한다.
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const syncResultSchema = z.object({
  processed: z.number().int(),
  insufficient: z.number().int(),
  failed: z.number().int(),
  remaining: z.number().int(),
  budgetExhausted: z.boolean(),
  indexVersion: z.number().int(),
});
export type SyncResult = z.infer<typeof syncResultSchema>;

/** sync 1회는 LLM 호출 최대 50건이라 검색 프록시(8초)보다 훨씬 길게 기다린다. */
const SYNC_TIMEOUT_MS = 300_000;
/** 무료 티어 슬립(첫 호출 502/503·연결 실패)에서 깨어나길 기다리는 재시도 간격 — 합계 65초. */
const RETRY_DELAYS_MS = [5_000, 15_000, 45_000];

@Injectable()
export class AiSyncClient {
  /** 테스트가 교체할 수 있게 필드로 둔다. */
  fetchImpl: typeof fetch = fetch;
  sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /**
   * AI 서비스에 동기화 1회를 요청한다. 무료 티어는 슬립 중 첫 호출이 실패하므로 연결 실패·타임아웃·5xx는
   * 최대 3번 재시도한다(4xx는 설정 오류라 즉시 실패 — 재시도해도 같다). 동기화는 항목 단위로 멱등이라 재시도가 안전하다.
   * @param maxItems 이번 호출에서 처리할 최대 항목 수
   * @returns 처리 통계(remaining·budgetExhausted로 호출 측이 반복 여부 결정)
   * @throws 재시도 소진 후 마지막 오류, 4xx(HTTP 상태 포함), 응답 형식 불일치
   */
  async sync(maxItems: number): Promise<SyncResult> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.callOnce(maxItems);
      } catch (e) {
        const retryable = !(e instanceof HttpError) || e.status >= 500;
        if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw e;
        await this.sleep(RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  private async callOnce(maxItems: number): Promise<SyncResult> {
    const res = await this.fetchImpl(
      `${process.env.AI_BASE_URL}/internal/jobs/sync`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': process.env.INTERNAL_API_TOKEN ?? '',
        },
        body: JSON.stringify({ maxItems }),
        signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new HttpError(res.status);
    return syncResultSchema.parse(await res.json());
  }
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(`ai sync HTTP ${status}`);
  }
}
