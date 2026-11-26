// 7단계 ai-sync: FastAPI 동기화를 반복 호출해 바뀐 항목의 요약·임베딩·검색 문서를 갱신한다.
import { Injectable } from '@nestjs/common';
import { AiSyncClient } from '../ai-sync.client';
import type { Stage, StageContext } from '../stage';

const MAX_ITEMS_PER_CALL = 20;
/** 안전장치: 20건 × 200회 = 4000건/실행. 정상이라면 remaining이 먼저 0이 된다. */
const MAX_CALLS = 200;

@Injectable()
export class AiSyncStage implements Stage {
  readonly name = 'AI_SYNC' as const;

  constructor(private readonly ai: AiSyncClient) {}

  async run(ctx: StageContext): Promise<void> {
    for (let call = 0; call < MAX_CALLS; call++) {
      const r = await this.ai.sync(MAX_ITEMS_PER_CALL);
      ctx.add('processed', r.processed);
      ctx.add('insufficient', r.insufficient);
      ctx.add('aiFailed', r.failed);
      ctx.stats.remaining = r.remaining;
      await ctx.commit({ calls: call + 1, indexVersion: r.indexVersion });
      // 예산 소진이거나 진전이 없으면(전부 실패·대기) 같은 호출을 되풀이해도 소용없다
      if (r.budgetExhausted || r.processed === 0 || r.remaining === 0) return;
    }
  }
}
