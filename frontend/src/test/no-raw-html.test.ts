// PLAN C5 금지 규칙: 요약·발췌·README 문자열을 HTML/마크다운으로 렌더하지 않는다.
import { describe, expect, it } from "vitest";

const files = import.meta.glob(["../**/*.{ts,tsx}", "!../**/*.test.*", "!../test/**"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;

describe("원문 렌더 금지", () => {
  it("src 에 dangerouslySetInnerHTML·innerHTML·마크다운 렌더러가 없음", () => {
    const bad = /dangerouslySetInnerHTML|\.innerHTML|react-markdown|marked\(|markdown-it/;
    expect(Object.keys(files).length).toBeGreaterThan(10); // glob 이 비어 통과하는 오탐 방지
    expect(Object.entries(files).filter(([, src]) => bad.test(src)).map(([f]) => f)).toEqual([]);
  });
});
