// API 오류를 화면 문구·종류로 매핑. 컴포넌트가 코드 문자열을 직접 비교하지 않게 한 곳에서 해석한다.
import { isAxiosError } from "axios";

export type ErrorKind =
  | "rate-limited"
  | "warming"
  | "search-unavailable"
  | "demo-read-only"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "network"
  | "invalid-response"
  | "generic";

export type ErrorInfo = { kind: ErrorKind; message: string; code?: string };

export class InvalidResponseError extends Error {}

export function retryAfterSeconds(e: unknown, fallback = 30): number {
  const raw = isAxiosError(e) ? e.response?.headers?.["retry-after"] : undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function describeError(e: unknown): ErrorInfo {
  if (e instanceof InvalidResponseError) {
    return { kind: "invalid-response", message: "서버 응답 형식이 예상과 달라 표시할 수 없습니다." };
  }
  if (!isAxiosError(e)) return { kind: "generic", message: "알 수 없는 오류가 발생했습니다." };
  if (!e.response) {
    return { kind: "network", message: "서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요." };
  }
  const { status, data } = e.response;
  const code: string | undefined = data?.code;
  const serverMessage: string | undefined = typeof data?.message === "string" ? data.message : undefined;
  if (status === 429) {
    return {
      kind: "rate-limited",
      code,
      message: `요청이 너무 많습니다. ${retryAfterSeconds(e, 60)}초쯤 뒤에 다시 시도해 주세요.`,
    };
  }
  if (code === "SEARCH_WARMING") {
    return { kind: "warming", code, message: "검색 서버를 깨우는 중입니다. 잠시 뒤 자동으로 다시 시도합니다." };
  }
  if (code === "SEARCH_UNAVAILABLE") {
    return {
      kind: "search-unavailable",
      code,
      message: "지금은 검색을 쓸 수 없습니다. 카탈로그에서 정렬·필터로 직접 찾아보세요.",
    };
  }
  if (code === "DEMO_READ_ONLY") {
    return { kind: "demo-read-only", code, message: "데모 관리자 계정은 읽기 전용입니다. 변경은 막혀 있습니다." };
  }
  if (status === 401) {
    return {
      kind: "unauthorized",
      code,
      message: code === "AUTH_INVALID_CREDENTIALS" ? "이메일 또는 비밀번호가 올바르지 않습니다." : "로그인이 필요합니다.",
    };
  }
  if (status === 403) return { kind: "forbidden", code, message: "권한이 없습니다." };
  if (status === 404) return { kind: "not-found", code, message: serverMessage ?? "찾을 수 없습니다." };
  return { kind: "generic", code, message: serverMessage ?? "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
}
