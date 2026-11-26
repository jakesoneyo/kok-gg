// 순위 목록 패널(이중 베젤) + "더 보기". 로딩·오류·빈 상태를 목록 영역 안에서 처리.
import { ChevronDown } from "lucide-react";
import { Loading, QueryState } from "./ui";
import { RankingHeader, RankingRow, type RowModel } from "./RankingRow";

export function RankingPanel({
  rows,
  isPending,
  error,
  onRetry,
  hasNext,
  loadingMore,
  onMore,
  emptyText,
  label,
}: {
  rows: RowModel[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  hasNext: boolean;
  loadingMore: boolean;
  onMore: () => void;
  emptyText: string;
  label: string;
}) {
  return (
    <>
      <div className="mt-5 rounded-[30px] bg-[rgba(30,45,90,0.04)] p-1.5 shadow-[inset_0_0_0_1px_rgba(30,45,90,0.06)]">
        <div className="rounded-3xl bg-surface px-2.5 pb-2.5 pt-2 shadow-card">
          <QueryState isPending={isPending} error={error} empty={rows.length === 0} emptyText={emptyText} onRetry={onRetry}>
            <RankingHeader />
            <ol aria-label={label}>
              {rows.map((r, i) => (
                <RankingRow key={`${r.itemId ?? r.fullName}-${i}`} row={r} />
              ))}
            </ol>
          </QueryState>
        </div>
      </div>
      {hasNext && (
        <div className="mt-[18px] flex justify-end px-2">
          <button
            type="button"
            disabled={loadingMore}
            onClick={onMore}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-full bg-surface pl-[18px] pr-1.5 text-sm font-medium shadow-hair hover:shadow-card disabled:opacity-60"
          >
            {loadingMore ? "불러오는 중" : "더 보기"}
            <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-chip">
              <ChevronDown size={14} />
            </span>
          </button>
        </div>
      )}
      {loadingMore && <Loading />}
    </>
  );
}
