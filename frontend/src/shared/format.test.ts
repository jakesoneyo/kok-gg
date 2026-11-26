import { describe, expect, it } from "vitest";
import { formatGain, formatRankChange, sparklineGain, sparklinePoints, trendRankChange } from "./format";

describe("formatRankChange", () => {
  it("양수는 상승, 음수는 하락, 0은 변동 없음", () => {
    expect(formatRankChange({ delta: 2, isNew: false })).toEqual({ text: "▲2", tone: "up" });
    expect(formatRankChange({ delta: -1, isNew: false })).toEqual({ text: "▼1", tone: "down" });
    expect(formatRankChange({ delta: 0, isNew: false })).toEqual({ text: "–", tone: "flat" });
  });
  it("NEW는 delta보다 우선, 미자격(null)은 표시 없음", () => {
    expect(formatRankChange({ delta: null, isNew: true })).toEqual({ text: "NEW", tone: "new" });
    expect(formatRankChange({ delta: null, isNew: false })).toEqual({ text: "", tone: "flat" });
  });
});

describe("trendRankChange", () => {
  it("prevRank - rank 로 계산하고 isNew 는 그대로 전달", () => {
    expect(trendRankChange({ rank: 1, prevRank: 4, isNew: false })).toEqual({ delta: 3, isNew: false });
    expect(trendRankChange({ rank: 5, prevRank: null, isNew: true })).toEqual({ delta: null, isNew: true });
  });
});

describe("formatGain / sparklineGain", () => {
  it("증가량은 부호 포함, null 은 대시", () => {
    expect(formatGain(746)).toBe("+746");
    expect(formatGain(1234)).toBe("+1,234");
    expect(formatGain(0)).toBe("+0");
    expect(formatGain(null)).toBe("–");
  });
  it("스파크라인 합계는 null 을 0으로 보지 않고 전부 모르면 null", () => {
    expect(sparklineGain([1, 2, null, 4, 0, 0, 3])).toBe(10);
    expect(sparklineGain([null, null, null, null, null, null, null])).toBeNull();
  });
});

describe("sparklinePoints", () => {
  it("null 구간에서 선이 끊기도록 구간별 점 배열로 나눔", () => {
    const segs = sparklinePoints([1, 2, null, 4, 5, null, null], 64, 26);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toHaveLength(2);
    expect(segs[1]).toHaveLength(2);
  });
  it("전부 0이어도 NaN 이 나오지 않음", () => {
    const [seg] = sparklinePoints([0, 0, 0, 0, 0, 0, 0], 64, 26);
    expect(seg.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
