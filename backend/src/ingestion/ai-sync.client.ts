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

@Injectable()
export class AiSyncClient {
  /** 테스트가 교체할 수 있게 필드로 둔다. */
  fetchImpl: typeof fetch = fetch;

  async sync(maxItems: number): Promise<SyncResult> {
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
    if (!res.ok) throw new Error(`ai sync HTTP ${res.status}`);
    return syncResultSchema.parse(await res.json());
  }
}
