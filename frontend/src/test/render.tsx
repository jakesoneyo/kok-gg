// 테스트 헬퍼: Router + QueryClient 로 감싸 렌더하고, axios 어댑터를 가짜 서버로 교체한다.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../lib/api";

export type FakeReply = { status?: number; data?: unknown; headers?: Record<string, string> };

/** 요청(method, url, body)을 받아 응답을 돌려주는 가짜 서버. 4xx/5xx 는 AxiosError 로 던진다. */
export function fakeServer(handler: (req: { method: string; url: string; body: unknown }) => FakeReply) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  api.defaults.adapter = async (cfg: InternalAxiosRequestConfig) => {
    const body = typeof cfg.data === "string" ? JSON.parse(cfg.data) : cfg.data;
    const req = { method: (cfg.method ?? "get").toLowerCase(), url: cfg.url ?? "", body };
    calls.push(req);
    const { status = 200, data = {}, headers = {} } = handler(req);
    const res = { status, data, headers, statusText: "", config: cfg } as AxiosResponse;
    if (status >= 400) throw new AxiosError("fail", String(status), cfg, null, res);
    return res;
  };
  return calls;
}

export function renderApp(ui: ReactElement, route = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
