// URL/API 쿼리 직렬화·파싱. 파라미터 순서를 고정해 엣지 캐시 키를 정규화하고(API.md 3.1), 기본값은 생략한다.
import {
  kindSchema,
  levelSchema,
  sortSchema,
  windowSchema,
  type Kind,
  type Level,
  type Sort,
  type TrendWindow,
} from "./schemas";

function build(order: string[], values: Record<string, string | number | undefined>, defaults: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const key of order) {
    const v = values[key];
    if (v === undefined || v === "" || v === defaults[key]) continue;
    sp.set(key, String(v));
  }
  return sp.toString();
}

export type CatalogParams = { kind?: Kind; level?: Level; sort?: Sort; cursor?: string; limit?: number };

/** 카탈로그: kind, level, sort, cursor, limit 순서 고정. */
export function serializeCatalogQuery(p: CatalogParams): string {
  return build(["kind", "level", "sort", "cursor", "limit"], p, { sort: "trending", limit: 24 });
}

export type TrendingParams = { window?: TrendWindow; kind?: Kind; limit?: number; cursor?: string };

/** 트렌딩: window, kind, limit, cursor 순서 고정(window 기본 D7). */
export function serializeTrendingQuery(p: TrendingParams): string {
  return build(["window", "kind", "limit", "cursor"], p, { window: "D7", limit: 20 });
}

/** 브라우저 URL → 카탈로그 상태. 알 수 없거나 잘못된 값은 버려 URL 왕복이 항상 유효한 상태로 수렴. cursor 는 URL 에 싣지 않는다(무한 목록은 쿼리 상태가 관리). */
export function parseCatalogParams(sp: URLSearchParams): { sort: Sort; kind?: Kind; level?: Level } {
  return {
    sort: sortSchema.catch("trending").parse(sp.get("sort") ?? undefined),
    kind: kindSchema.optional().catch(undefined).parse(sp.get("kind") ?? undefined),
    level: levelSchema.optional().catch(undefined).parse(sp.get("level") ?? undefined),
  };
}

export function parseTrendingParams(sp: URLSearchParams): { window: TrendWindow; kind?: Kind } {
  return {
    window: windowSchema.catch("D7").parse(sp.get("window") ?? undefined),
    kind: kindSchema.optional().catch(undefined).parse(sp.get("kind") ?? undefined),
  };
}
