// 서버 상태(TanStack Query) 훅 모음. 응답 형태 검증은 lib/api의 get/send가 Zod로 처리.
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { z } from "zod";
import { API_ORIGIN, get, send } from "../lib/api";
import { useAuth } from "../store/auth";
import {
  answerSchema,
  bookmarkIdsSchema,
  bookmarksPageSchema,
  dqIssuesSchema,
  dqSummarySchema,
  healthSchema,
  itemDetailSchema,
  itemsPageSchema,
  overridesPageSchema,
  overviewSchema,
  rulesSchema,
  runDetailSchema,
  runRequestResultSchema,
  runsPageSchema,
  searchSchema,
  securityChangesSchema,
  starSeriesSchema,
  trendingPageSchema,
  type Kind,
  type Level,
} from "../shared/schemas";
import {
  serializeCatalogQuery,
  serializeTrendingQuery,
  type CatalogParams,
  type TrendingParams,
} from "../shared/query-params";

const withQuery = (path: string, ...qs: (string | undefined)[]) => {
  const q = qs.filter(Boolean).join("&");
  return q ? `${path}?${q}` : path;
};
const cur = (c?: string) => (c ? `cursor=${encodeURIComponent(c)}` : undefined);

/**
 * keyset 무한 목록. 쿼리 키에 정렬·필터가 들어가므로 바뀌면 커서가 자동으로 초기화되고,
 * 페이지들의 asOf 가 서로 다르면(배치가 중간에 갱신) 처음부터 다시 읽는다.
 */
function useCursorList<I>(
  key: unknown[],
  url: (cursor?: string) => string,
  schema: z.ZodType<{ items: I[]; nextCursor: string | null; asOf?: string | undefined }>,
  enabled = true,
) {
  const qc = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => get(url(pageParam), schema),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const asOfs = new Set(q.data?.pages.map((p) => p.asOf));
  const drifted = asOfs.size > 1;
  useEffect(() => {
    if (drifted) void qc.resetQueries({ queryKey: key });
    // key 는 매 렌더 새 배열이라 drifted 전환에만 반응하게 의존성에서 뺀다
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [drifted]);
  return { ...q, items: q.data?.pages.flatMap((p) => p.items) ?? [], asOf: q.data?.pages[0]?.asOf };
}

export const useTrending = (p: TrendingParams) =>
  useCursorList(["trending", p.window, p.kind], (c) => withQuery("/trending", serializeTrendingQuery({ ...p, cursor: c })), trendingPageSchema);

export const useItems = (p: CatalogParams) =>
  useCursorList(["items", p.sort, p.kind, p.level], (c) => withQuery("/items", serializeCatalogQuery({ ...p, cursor: c })), itemsPageSchema);

export const useItemDetail = (id: number) =>
  useQuery({ queryKey: ["item", id], queryFn: () => get(`/items/${id}`, itemDetailSchema) });
export const useStarSeries = (id: number, days = 30) =>
  useQuery({ queryKey: ["stars", id, days], queryFn: () => get(`/items/${id}/stars?days=${days}`, starSeriesSchema) });
export const useRules = () =>
  useQuery({ queryKey: ["rules"], queryFn: () => get("/security/rules", rulesSchema), staleTime: Infinity, retry: 1 });
export const useOverview = () => useQuery({ queryKey: ["overview"], queryFn: () => get("/stats/overview", overviewSchema) });
export const useHealth = () =>
  useQuery({ queryKey: ["health"], queryFn: () => get("/health", healthSchema, { baseURL: API_ORIGIN }), retry: false });

type SearchFilter = { kind?: Kind; level?: Level };
const searchQs = (q: string, f: SearchFilter) => {
  const sp = new URLSearchParams({ q });
  if (f.kind) sp.set("kind", f.kind);
  if (f.level) sp.set("level", f.level);
  return sp.toString();
};
export const useSearch = (q: string, f: SearchFilter = {}) =>
  useQuery({
    queryKey: ["search", q, f.kind, f.level],
    queryFn: () => get(`/search?${searchQs(q, f)}&limit=10`, searchSchema),
    enabled: q.length > 0,
    retry: false, // 503 SEARCH_WARMING 은 화면이 Retry-After 로 직접 재시도
  });
export const useAnswer = (q: string, enabled: boolean, f: SearchFilter = {}) =>
  useQuery({
    queryKey: ["answer", q, f.kind, f.level],
    queryFn: () => get(`/search/answer?${searchQs(q, f)}`, answerSchema),
    enabled: enabled && q.length > 0,
    retry: false,
  });

// ---- 북마크 ----
const useLoggedIn = () => useAuth((s) => s.user !== null);

export function useBookmarkIds() {
  const on = useLoggedIn();
  return useQuery({
    queryKey: ["bookmark-ids"],
    queryFn: () => get("/me/bookmarks/ids", bookmarkIdsSchema),
    enabled: on,
    select: (d) => new Set(d.itemIds),
  });
}
export const useBookmarks = () =>
  useCursorList(["bookmarks"], (c) => withQuery("/me/bookmarks", cur(c)), bookmarksPageSchema);
export const useSecurityChanges = () =>
  useQuery({ queryKey: ["security-changes"], queryFn: () => get("/me/bookmarks/security-changes", securityChangesSchema) });

function useInvalidating<V, R>(fn: (v: V) => Promise<R>, keys: string[][]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}
const BM_KEYS = [["bookmark-ids"], ["bookmarks"], ["security-changes"]];
export const useToggleBookmark = () =>
  useInvalidating(
    ({ itemId, on }: { itemId: number; on: boolean }) =>
      send(on ? "put" : "delete", `/me/bookmarks/${itemId}`, null),
    BM_KEYS,
  );
export const useAckChanges = () =>
  useInvalidating(
    (itemIds?: number[]) => send("post", "/me/bookmarks/security-changes/ack", null, itemIds ? { itemIds } : {}),
    BM_KEYS,
  );

// ---- 관리자 ----
export const useRuns = () => useCursorList(["admin-runs"], (c) => withQuery("/admin/ingestion/runs", cur(c)), runsPageSchema);
export const useRunDetail = (id: number | null) =>
  useQuery({ queryKey: ["admin-run", id], queryFn: () => get(`/admin/ingestion/runs/${id}`, runDetailSchema), enabled: id !== null });
export const useRequestRun = () =>
  useInvalidating(() => send("post", "/admin/ingestion/runs", runRequestResultSchema, { stages: [] }), [["admin-runs"]]);
export const useDqSummary = () => useQuery({ queryKey: ["admin-dq"], queryFn: () => get("/admin/data-quality/summary", dqSummarySchema) });
export const useIssues = (status: "OPEN" | "RESOLVED" | "IGNORED") =>
  useCursorList(["admin-issues", status], (c) => withQuery("/admin/data-quality/issues", `status=${status}`, cur(c)), dqIssuesSchema);
export const usePatchIssue = () =>
  useInvalidating(
    ({ id, ...body }: { id: number; status: "RESOLVED" | "IGNORED"; note: string }) =>
      send("patch", `/admin/data-quality/issues/${id}`, null, body),
    [["admin-issues"], ["admin-dq"]],
  );
export const useOverrides = () =>
  useCursorList(["admin-overrides"], (c) => withQuery("/admin/security/overrides", "active=true", cur(c)), overridesPageSchema);
export const useCreateOverride = () =>
  useInvalidating(
    (body: { itemId: number; fingerprint: string; reason: string; appealUrl?: string }) =>
      send("post", "/admin/security/overrides", null, body),
    [["admin-overrides"], ["item"]],
  );
export const useRevokeOverride = () =>
  useInvalidating((id: number) => send("post", `/admin/security/overrides/${id}/revoke`, null, {}), [["admin-overrides"], ["item"]]);
