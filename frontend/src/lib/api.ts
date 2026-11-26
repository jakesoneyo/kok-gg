// Axios 클라이언트: 보호 경로에만 Bearer 부착, 401 시 refresh 1회(동시 요청은 큐잉) 후 재시도, 응답은 Zod로 검증.
import axios, { isAxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from "axios";
import type { z } from "zod";
import { useAuth } from "../store/auth";
import { refreshResultSchema } from "../shared/schemas";
import { InvalidResponseError } from "./errors";

export const API_ORIGIN: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  timeout: 70_000, // Render 무료 티어 콜드 스타트(최대 ~1분)를 견딤
});

// 공개 읽기는 Authorization 을 아예 보내지 않는다 — 공유 캐시 키를 오염시키지 않기 위함(API.md 1장).
const AUTHED = [/^\/me(\/|$)/, /^\/admin(\/|$)/, /^\/auth\/(me|logout)$/];
const needsAuth = (url = "") => AUTHED.some((re) => re.test(url.split("?")[0]));

api.interceptors.request.use((cfg) => {
  const token = useAuth.getState().accessToken;
  if (token && needsAuth(cfg.url)) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

let refreshing: Promise<string> | null = null;

/** 동시에 여러 요청이 401 을 받아도 refresh 는 한 번만(회전 토큰 재사용 감지로 계열 폐기되는 것을 방지). */
function refreshOnce(): Promise<string> {
  refreshing ??= (async () => {
    const { refreshToken, setTokens, clear } = useAuth.getState();
    if (!refreshToken) throw new Error("no refresh token");
    try {
      const res = await axios.post(`${api.defaults.baseURL}/auth/refresh`, { refreshToken });
      const t = refreshResultSchema.parse(res.data);
      setTokens(t);
      return t.accessToken;
    } catch (e) {
      clear();
      throw e;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

api.interceptors.response.use(undefined, async (error: unknown) => {
  if (!isAxiosError(error) || error.response?.status !== 401) throw error;
  const cfg = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  if (!cfg || cfg._retried || !needsAuth(cfg.url) || !useAuth.getState().refreshToken) throw error;
  cfg._retried = true;
  try {
    const token = await refreshOnce();
    cfg.headers.Authorization = `Bearer ${token}`;
  } catch {
    throw error;
  }
  return api.request(cfg);
});

/** 요청 후 Zod 로 응답 형태를 검증. 형식이 다르면 화면에서 "응답 형식 오류"로 구분해 보여줌. */
export async function get<S extends z.ZodType>(
  url: string,
  schema: S,
  config?: AxiosRequestConfig,
): Promise<z.infer<S>> {
  const res = await api.get(url, config);
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw new InvalidResponseError(parsed.error.message);
  return parsed.data;
}

export async function send<S extends z.ZodType>(
  method: "post" | "put" | "patch" | "delete",
  url: string,
  schema: S | null,
  body?: unknown,
): Promise<z.infer<S>> {
  const res = await api.request({ method, url, data: body });
  if (!schema) return undefined as z.infer<S>;
  const parsed = schema.safeParse(res.data);
  if (!parsed.success) throw new InvalidResponseError(parsed.error.message);
  return parsed.data;
}
