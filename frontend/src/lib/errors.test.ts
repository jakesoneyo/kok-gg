import { AxiosError } from "axios";
import { describe, expect, it } from "vitest";
import { describeError, retryAfterSeconds } from "./errors";

function httpError(status: number, data: unknown, headers: Record<string, string> = {}) {
  const e = new AxiosError("fail");
  e.response = { status, data, headers, statusText: "", config: {} as never };
  return e;
}

describe("describeError", () => {
  it("로그인 429 는 잠시 후 재시도 안내", () => {
    const d = describeError(httpError(429, { code: "RATE_LIMITED", message: "x" }, { "retry-after": "30" }));
    expect(d.kind).toBe("rate-limited");
    expect(d.message).toContain("30");
  });
  it("SEARCH_WARMING 은 warming, SEARCH_UNAVAILABLE 은 대체 메시지", () => {
    expect(describeError(httpError(503, { code: "SEARCH_WARMING" }, { "retry-after": "30" })).kind).toBe("warming");
    const u = describeError(httpError(503, { code: "SEARCH_UNAVAILABLE" }));
    expect(u.kind).toBe("search-unavailable");
    expect(u.message).toContain("카탈로그");
  });
  it("DEMO_READ_ONLY 는 읽기 전용 안내", () => {
    expect(describeError(httpError(403, { code: "DEMO_READ_ONLY" })).kind).toBe("demo-read-only");
  });
  it("401 자격 증명 오류와 네트워크 오류 구분", () => {
    expect(describeError(httpError(401, { code: "AUTH_INVALID_CREDENTIALS" })).message).toContain("올바르지");
    expect(describeError(new AxiosError("Network Error")).kind).toBe("network");
  });
  it("서버가 준 한국어 message 가 있으면 일반 오류에 그대로 사용", () => {
    expect(describeError(httpError(400, { code: "INVALID_CURSOR", message: "정렬 방식과 맞지 않는 커서입니다." })).message).toBe(
      "정렬 방식과 맞지 않는 커서입니다.",
    );
  });
});

describe("retryAfterSeconds", () => {
  it("헤더 없으면 기본 30초", () => {
    expect(retryAfterSeconds(httpError(503, {}))).toBe(30);
    expect(retryAfterSeconds(httpError(503, {}, { "retry-after": "12" }))).toBe(12);
  });
});
