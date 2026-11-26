import type { SyncResult } from '../ai-sync.client';
import type { StageContext } from '../stage';
import { AiSyncStage } from './ai-sync.stage';

const res = (over: Partial<SyncResult>): SyncResult => ({
  processed: 0,
  insufficient: 0,
  failed: 0,
  remaining: 0,
  budgetExhausted: false,
  indexVersion: 1,
  ...over,
});

function run(results: SyncResult[]) {
  let calls = 0;
  const stage = new AiSyncStage({
    sync: () => Promise.resolve(results[calls++]),
  } as never);
  const ctx = {
    stats: {},
    add: (k: string, n = 1) => (ctx.stats[k] = (ctx.stats[k] ?? 0) + n),
    commit: () => Promise.resolve(),
  } as unknown as StageContext;
  return stage.run(ctx).then(() => calls);
}

describe('AiSyncStage 반복 종료 조건', () => {
  it('remaining이 0이 될 때까지 반복', async () => {
    expect(
      await run([
        res({ processed: 20, remaining: 25 }),
        res({ processed: 20, remaining: 5 }),
        res({ processed: 5, remaining: 0 }),
      ]),
    ).toBe(3);
  });
  it('예산 소진이면 남아 있어도 중단', async () => {
    expect(
      await run([res({ processed: 3, remaining: 50, budgetExhausted: true })]),
    ).toBe(1);
  });
  it('진전이 없으면(processed 0) 중단 — 같은 호출을 되풀이하지 않는다', async () => {
    expect(await run([res({ processed: 0, remaining: 10, failed: 10 })])).toBe(
      1,
    );
  });
});
