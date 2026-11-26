import { describe, expect, it } from "vitest";
import { itemDetailSchema, itemsPageSchema, loginInputSchema, registerInputSchema, starSeriesSchema } from "./schemas";

const card = {
  id: 812, kind: "HOOK", name: "pre-pr-lint", description: "Runs lint", trendRank7d: 3, rankDelta: 2, isNew: false,
  currentLevel: "CAUTION", hasExternalMcp: false, trendScore7d: 1088.4, firstSeenAt: "2026-11-02T18:04:11Z", components: {},
  repo: { id: 77, fullName: "someone/claude-hooks", stars: 342, pushedAt: "2026-11-23T09:12:00Z", sparkline7d: [2, 3, null, 5, 8, 12, 9] },
};

describe("응답 스키마", () => {
  it("API.md 목록 예시를 통과시키고 스파크라인 길이가 7이 아니면 거부", () => {
    expect(itemsPageSchema.parse({ asOf: "2026-11-24", items: [card], nextCursor: null }).items[0].rankDelta).toBe(2);
    expect(() => itemsPageSchema.parse({ items: [{ ...card, repo: { ...card.repo, sparkline7d: [1] } }], nextCursor: null })).toThrow();
  });
  it("설치 경고가 비어 있거나 없어도 파싱", () => {
    const detail = {
      item: { id: 1, kind: "SKILL", name: "n", path: "p", description: null, hasExternalMcp: false, firstSeenAt: "x" },
      repo: { id: 1, fullName: "a/b", url: "https://github.com/a/b", stars: 1, pushedAt: null, headSha: null, archived: false },
      security: null,
      summary: { status: "OK", summaryKo: "요약", installCommands: [{ command: "/plugin install x" }] },
      trend: { D1: null, D7: null, D30: null },
    };
    expect(itemDetailSchema.parse(detail).summary?.installCommands[0].warnings).toEqual([]);
  });
  it("별 시계열의 gain null 을 보존", () => {
    const r = starSeriesSchema.parse({ repoId: 1, series: [{ day: "2026-11-01", gain: null, total: null, source: null }] });
    expect(r.series[0].gain).toBeNull();
  });
});

describe("입력 스키마", () => {
  it("로그인은 'admin' 리터럴만 이메일 예외", () => {
    expect(loginInputSchema.safeParse({ email: "admin", password: "x" }).success).toBe(true);
    expect(loginInputSchema.safeParse({ email: "root", password: "x" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
  });
  it("회원가입에는 예외가 없음", () => {
    expect(registerInputSchema.safeParse({ email: "admin", password: "12345678", name: "n" }).success).toBe(false);
  });
});
