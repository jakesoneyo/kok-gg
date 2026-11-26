import { describe, expect, it } from "vitest";
import { chartSummary, mapStarSeries } from "./chart";

const day = (d: number, gain: number | null, total: number | null) => ({
  day: `2026-11-${String(d).padStart(2, "0")}`,
  gain,
  total,
  source: gain === null ? null : ("SNAPSHOT" as const),
});

describe("mapStarSeries", () => {
  it("gain 이 null 인 날은 0 이 아니라 null(끊김)", () => {
    const pts = mapStarSeries([day(1, 5, 100), day(2, null, null), day(3, 7, 112)]);
    expect(pts.map((p) => p.total)).toEqual([100, null, 112]);
    expect(pts[1].gain).toBeNull();
  });
  it("gain 이 null 이면 total 이 있어도 끊김으로 취급", () => {
    expect(mapStarSeries([day(1, null, 100)])[0].total).toBeNull();
  });
  it("축 라벨은 MM/DD", () => {
    expect(mapStarSeries([day(4, 1, 1)])[0].label).toBe("11/04");
  });
});

describe("chartSummary", () => {
  it("최근 7일 증가량 합과 알 수 없는 일수를 요약", () => {
    const series = Array.from({ length: 10 }, (_, i) => day(i + 1, i === 8 ? null : 10, 100 + i));
    const s = chartSummary(mapStarSeries(series));
    expect(s.gain7d).toBe(60);
    expect(s.unknownDays).toBe(1);
  });
});
