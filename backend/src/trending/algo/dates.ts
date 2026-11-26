/**
 * `YYYY-MM-DD` 문자열 날짜 산술. Date 객체를 UTC로만 쓰고 바깥에는 문자열만 노출해
 * 타임존(KST/UTC) 경계 버그를 차단한다.
 */
const MS_PER_DAY = 86_400_000;

function toMs(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new RangeError(`날짜는 YYYY-MM-DD 형식이어야 함: ${day}`);
  }
  return Date.parse(`${day}T00:00:00Z`);
}

/** `day`에서 n일 뒤(음수면 앞) 날짜. */
export function addDays(day: string, n: number): string {
  return new Date(toMs(day) + n * MS_PER_DAY).toISOString().slice(0, 10);
}

/** a − b (일 수). */
export function diffDays(a: string, b: string): number {
  return Math.round((toMs(a) - toMs(b)) / MS_PER_DAY);
}
