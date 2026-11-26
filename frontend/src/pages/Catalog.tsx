// 카탈로그: 정렬 4종 + 종류·보안 등급 필터를 URL 쿼리(kind, level, sort)로 보관 — 공유·뒤로가기 가능, 어떤 조합도 허용.
import { useSearchParams } from "react-router-dom";
import { useItems } from "../api/queries";
import { RankingPanel } from "../components/RankingPanel";
import { itemRowModel } from "../components/rows";
import { ChipButton, Segmented } from "../components/ui";
import { KIND_OPTIONS, LEVEL_OPTIONS, SORT_LABEL } from "../components/labels";
import { parseCatalogParams } from "../shared/query-params";
import { SORTS, type Kind, type Level, type Sort } from "../shared/schemas";


export function Catalog() {
  const [sp, setSp] = useSearchParams();
  const params = parseCatalogParams(sp);
  const items = useItems(params);
  // 필터가 바뀌면 커서는 쿼리 키와 함께 사라지므로 URL 에도 cursor 를 남기지 않는다
  const set = (key: "sort" | "kind" | "level", value: string, dflt: string) => {
    const next = new URLSearchParams(sp);
    if (value === dflt) next.delete(key);
    else next.set(key, value);
    next.delete("cursor");
    setSp(next, { replace: true });
  };
  return (
    <section aria-labelledby="cat-h" className="mx-auto max-w-[1240px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="cat-h" className="text-[30px] font-bold tracking-[-0.035em] sm:text-4xl">
        카탈로그
      </h1>
      <p className="mt-2 text-sm text-muted">
        플러그인·스킬·훅 항목 전체{items.asOf ? `, ${items.asOf} 기준` : ""}. 정렬과 필터는 자유롭게 조합할 수 있어요.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-x-7 gap-y-3">
        <div role="group" aria-label="정렬" className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted">정렬</span>
          {SORTS.map((s: Sort) => (
            <ChipButton key={s} pressed={params.sort === s} onClick={() => set("sort", s, "trending")}>
              {SORT_LABEL[s]}
            </ChipButton>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted">종류</span>
          <Segmented label="종류" value={params.kind ?? "ALL"} onChange={(k: Kind | "ALL") => set("kind", k, "ALL")} options={KIND_OPTIONS} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-muted">보안 등급</span>
          <Segmented label="보안 등급" value={params.level ?? "ALL"} onChange={(l: Level | "ALL") => set("level", l, "ALL")} options={LEVEL_OPTIONS} />
        </div>
      </div>
      <RankingPanel
        label={`${SORT_LABEL[params.sort]} 목록`}
        rows={items.items.map((i) => itemRowModel(i))}
        isPending={items.isPending}
        error={items.error}
        onRetry={() => void items.refetch()}
        hasNext={items.hasNextPage}
        loadingMore={items.isFetchingNextPage}
        onMore={() => void items.fetchNextPage()}
        emptyText="조건에 맞는 항목이 없습니다. 필터를 바꿔 보세요. 보안 등급 필터는 아직 분석되지 않은 항목을 제외합니다."
      />
    </section>
  );
}
