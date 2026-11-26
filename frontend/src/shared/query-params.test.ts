import { describe, expect, it } from "vitest";
import { parseCatalogParams, serializeCatalogQuery, serializeTrendingQuery } from "./query-params";

describe("serializeCatalogQuery", () => {
  it("kind, level, sort, cursor, limit 고정 순서로 직렬화", () => {
    expect(serializeCatalogQuery({ limit: 10, cursor: "abc", sort: "stars", level: "SAFE", kind: "HOOK" })).toBe(
      "kind=HOOK&level=SAFE&sort=stars&cursor=abc&limit=10",
    );
  });
  it("기본값(trending, limit 24)과 빈 값은 생략", () => {
    expect(serializeCatalogQuery({ sort: "trending", limit: 24 })).toBe("");
    expect(serializeCatalogQuery({ kind: undefined, sort: "new" })).toBe("sort=new");
  });
  it("커서는 인코딩", () => {
    expect(serializeCatalogQuery({ cursor: "a+b/c=" })).toBe("cursor=a%2Bb%2Fc%3D");
  });
});

describe("serializeTrendingQuery", () => {
  it("window 기본값 D7 생략, window, kind, limit, cursor 순서 고정", () => {
    expect(serializeTrendingQuery({ window: "D7" })).toBe("");
    expect(serializeTrendingQuery({ cursor: "x", kind: "SKILL", window: "D30" })).toBe("window=D30&kind=SKILL&cursor=x");
  });
});

describe("parseCatalogParams", () => {
  it("URL 쿼리를 읽고 잘못된 값은 버림(왕복)", () => {
    const p = parseCatalogParams(new URLSearchParams("sort=stars&kind=HOOK&level=NOPE&foo=1"));
    expect(p).toEqual({ sort: "stars", kind: "HOOK", level: undefined });
    expect(serializeCatalogQuery(p)).toBe("kind=HOOK&sort=stars");
  });
  it("아무것도 없으면 기본 정렬", () => {
    expect(parseCatalogParams(new URLSearchParams(""))).toEqual({ sort: "trending", kind: undefined, level: undefined });
  });
});
