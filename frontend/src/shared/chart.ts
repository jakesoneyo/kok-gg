// 스타 시계열 → 차트 데이터. gain 이 null(모름)인 날은 0이 아니라 null 로 둬 선이 끊기게 한다.
import type { StarSeries } from "./schemas";

export type ChartPoint = { day: string; label: string; total: number | null; gain: number | null };

export function mapStarSeries(series: StarSeries["series"]): ChartPoint[] {
  return series.map((s) => ({
    day: s.day,
    label: s.day.slice(5).replace("-", "/"),
    // gain 을 모르는 날의 total 은 신뢰하지 않는다
    total: s.gain === null ? null : s.total,
    gain: s.gain,
  }));
}

/** 스크린리더용 요약 재료: 최근 7일 증가량 합과 모르는 날 수. */
export function chartSummary(points: ChartPoint[]) {
  const last7 = points.slice(-7);
  return {
    gain7d: last7.reduce((a, p) => a + (p.gain ?? 0), 0),
    unknownDays: points.filter((p) => p.gain === null).length,
  };
}
