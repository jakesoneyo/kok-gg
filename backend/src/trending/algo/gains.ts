/**
 * 일일 증가량(Daily Gain) 계산. 스냅샷 차분 > 공식 기록 > 모름(null) 우선순위(ARCHITECTURE 4.2).
 * 모르는 날을 0이나 누적 차분으로 메우지 않는 것이 신규 저장소 가짜 급등 방지의 핵심.
 */
import { addDays } from './dates';

/** `repo_star_day` 한 행. 날짜는 YYYY-MM-DD 문자열. */
export interface StarDayRow {
  day: string;
  snapshotTotal?: number | null;
  officialAdded?: number | null;
  externalAdded?: number | null;
}

/**
 * from~to(포함) 각 날의 증가량. 오래된 날 → 최신 순, 모르는 날은 null.
 * 왜 외부 출처를 안 쓰나: External History는 교차검증 전용(F2) — 증가량에 섞으면 출처 불일치를 가린다.
 * 언스타로 음수가 나와도 그대로 둔다(ponytail: 클램프하면 급감 이상치 탐지 근거가 사라짐).
 */
export function dailyGains(
  rows: readonly StarDayRow[],
  from: string,
  to: string,
): (number | null)[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: (number | null)[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const cur = byDay.get(d)?.snapshotTotal;
    const prev = byDay.get(addDays(d, -1))?.snapshotTotal;
    if (cur != null && prev != null) out.push(cur - prev);
    else out.push(byDay.get(d)?.officialAdded ?? null);
  }
  return out;
}

/** `repo.sparkline_7d`용 7칸(asOf 포함 최근 7일, 오래된 날 → 오늘). */
export function sparkline7d(
  rows: readonly StarDayRow[],
  asOf: string,
): (number | null)[] {
  return dailyGains(rows, addDays(asOf, -6), asOf);
}
