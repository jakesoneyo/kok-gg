import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer, renderApp } from "../test/render";
import { Search } from "./Search";

const card = (id: number) => ({
  id, kind: "HOOK", name: `hook-${id}`, description: "설명", trendRank7d: id, rankDelta: 1, isNew: false, currentLevel: "SAFE",
  hasExternalMcp: false, trendScore7d: 1, firstSeenAt: "2026-11-01T00:00:00Z",
  repo: { id, fullName: "o/r", stars: 10, pushedAt: null, sparkline7d: [1, 2, null, 4, 5, 6, 7] },
});

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => vi.useRealTimers());

describe("검색 화면", () => {
  it("SEARCH_WARMING 이면 워밍 안내를 보이고 Retry-After 뒤 자동 재시도해 결과를 표시", async () => {
    let n = 0;
    fakeServer((req) => {
      if (req.url.startsWith("/search/answer")) return { data: { answerKo: "답변", citedItemIds: [1], degraded: false, reason: null } };
      n += 1;
      return n === 1
        ? { status: 503, data: { code: "SEARCH_WARMING" }, headers: { "retry-after": "2" } }
        : { data: { query: "린트", degraded: false, indexVersion: 1, items: [{ item: card(1), score: 1, ranks: { bm25: 1, vector: 1 }, snippetKo: "스니펫" }] } };
    });
    renderApp(<Search />, "/search?q=린트");
    expect(await screen.findByText(/검색 서버를 깨우는 중/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(await screen.findByText("스니펫")).toBeInTheDocument();
  });

  it("SEARCH_UNAVAILABLE 이면 카탈로그 이동 안내", async () => {
    fakeServer(() => ({ status: 503, data: { code: "SEARCH_UNAVAILABLE" } }));
    renderApp(<Search />, "/search?q=린트");
    expect(await screen.findByRole("alert")).toHaveTextContent("카탈로그");
    expect(screen.getByRole("link", { name: "카탈로그로 이동" })).toBeInTheDocument();
  });
});
