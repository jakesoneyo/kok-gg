import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import axios, { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../store/auth";
import { api } from "./api";

type Handler = (cfg: InternalAxiosRequestConfig) => { status: number; data?: unknown };

function mockAdapter(handler: Handler): AxiosAdapter {
  return async (cfg) => {
    const { status, data } = handler(cfg);
    const res = { status, data, statusText: "", headers: {}, config: cfg } as AxiosResponse;
    if (status >= 400) throw new AxiosError("fail", String(status), cfg, null, res);
    return res;
  };
}

const user = { id: 1, email: "admin", name: "admin", role: "ADMIN" as const };

beforeEach(() => {
  useAuth.getState().setSession({ user, accessToken: "old", refreshToken: "r1" });
});
afterEach(() => vi.restoreAllMocks());

describe("api 인터셉터", () => {
  it("공개 경로에는 Authorization 을 붙이지 않고 보호 경로에는 붙임", async () => {
    const seen: Record<string, unknown> = {};
    api.defaults.adapter = mockAdapter((cfg) => {
      seen[cfg.url ?? ""] = cfg.headers.Authorization;
      return { status: 200, data: {} };
    });
    await api.get("/items");
    await api.get("/me/bookmarks/ids");
    expect(seen["/items"]).toBeUndefined();
    expect(seen["/me/bookmarks/ids"]).toBe("Bearer old");
  });

  it("동시에 401 이 나도 refresh 는 한 번, 새 토큰으로 재시도", async () => {
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({ data: { accessToken: "new", refreshToken: "r2" } });
    api.defaults.adapter = mockAdapter((cfg) =>
      cfg.headers.Authorization === "Bearer new" ? { status: 200, data: { ok: true } } : { status: 401, data: {} },
    );
    const [a, b] = await Promise.all([api.get("/me/bookmarks"), api.get("/me/bookmarks/ids")]);
    expect(a.data.ok && b.data.ok).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(useAuth.getState().refreshToken).toBe("r2");
  });

  it("refresh 실패 시 세션을 비우고 원래 401 을 던짐", async () => {
    vi.spyOn(axios, "post").mockRejectedValue(new Error("expired"));
    api.defaults.adapter = mockAdapter(() => ({ status: 401, data: {} }));
    await expect(api.get("/me/bookmarks")).rejects.toMatchObject({ response: { status: 401 } });
    expect(useAuth.getState().user).toBeNull();
  });
});
