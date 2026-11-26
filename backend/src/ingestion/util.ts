// 수집 단계 공용 유틸.
import { RateLimitPausedError } from '../github/github.types';

/**
 * 동시 `limit`개로 항목을 처리한다. 항목 하나의 예외는 나머지를 멈추고(새 항목 시작 안 함) 모두 정리된 뒤 다시 던진다 —
 * PAUSED 신호가 나면 진행 중이던 쓰기가 끝난 뒤에 커서를 저장해야 하기 때문이다.
 * 항목별 실패 격리는 fn 안에서 try/catch로 하고, 여기까지 올라온 예외는 단계 수준 문제다.
 */
export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  let fatal: unknown;
  let failed = false;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && !failed) {
        const item = items[next++];
        try {
          await fn(item);
        } catch (e) {
          if (!failed) fatal = e;
          failed = true;
        }
      }
    }),
  );
  if (failed) throw fatal;
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export const isPause = (e: unknown): e is RateLimitPausedError =>
  e instanceof RateLimitPausedError;

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
export const toDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
export const chunk = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n),
  );
