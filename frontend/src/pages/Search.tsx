// 검색 "이런 거 있어?": 하이브리드 결과를 먼저 보여 주고 AI 답변 카드는 뒤늦게 로드(인용 항목 링크).
import { Search as SearchIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAnswer, useSearch } from "../api/queries";
import { RankingHeader, RankingRow } from "../components/RankingRow";
import { itemRowModel } from "../components/rows";
import { Warming } from "../components/Warming";
import { Bevel, Empty, ErrorBox, Loading, PrimaryButton } from "../components/ui";
import { describeError } from "../lib/errors";
import type { ItemCard } from "../shared/schemas";

const REASON: Record<string, string> = {
  BUDGET_EXHAUSTED: "오늘 AI 답변 한도를 모두 사용해 검색 결과만 보여 드립니다.",
  NO_RESULTS: "검색 결과가 없어 답변을 만들지 못했습니다.",
  CITATION_INVALID: "근거를 확인하지 못해 답변을 표시하지 않습니다. 아래 결과를 직접 확인해 주세요.",
};

function AnswerCard({ q, ready, byId }: { q: string; ready: boolean; byId: Map<number, ItemCard> }) {
  const a = useAnswer(q, ready);
  if (!ready || a.isPending) return <Bevel inner="p-6"><Loading label="AI 답변을 정리하는 중" /></Bevel>;
  if (a.error) return <Bevel inner="p-6"><p role="alert" className="text-sm text-ink-3">{describeError(a.error).message}</p></Bevel>;
  const { answerKo, citedItemIds, degraded, reason } = a.data;
  return (
    <Bevel inner="p-6">
      <h2 className="text-base font-semibold">답변</h2>
      {answerKo ? (
        <>
          <p className="mt-3 max-w-[68ch] whitespace-pre-line text-[15px] leading-[1.8] text-ink-2">{answerKo}</p>
          {citedItemIds.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              근거:
              {citedItemIds.map((id) => (
                <Link key={id} to={`/items/${id}`} className="inline-flex min-h-11 items-center rounded-full bg-chip px-3 font-mono text-ink-2">
                  {byId.get(id)?.name ?? `#${id}`}
                </Link>
              ))}
            </p>
          )}
          <p className="mt-2 text-xs text-muted">AI가 요약문을 근거로 생성했습니다. 설치 전 원문을 확인하세요.</p>
        </>
      ) : (
        <p className="mt-3 text-sm text-ink-3">{(reason && REASON[reason]) ?? "답변을 만들지 못했습니다."}</p>
      )}
      {degraded && <p className="mt-2 text-xs text-muted">예산 절약 모드: 키워드 검색(BM25)만 사용했습니다.</p>}
    </Bevel>
  );
}

export function Search() {
  const [sp, setSp] = useSearchParams();
  const q = (sp.get("q") ?? "").trim().slice(0, 200);
  const [draft, setDraft] = useState(q);
  const res = useSearch(q);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = draft.trim();
    if (t) setSp({ q: t });
  };
  const info = res.error ? describeError(res.error) : null;
  const byId = new Map((res.data?.items ?? []).map((r) => [r.item.id, r.item]));
  return (
    <section aria-labelledby="s-h" className="mx-auto max-w-[1240px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="s-h" className="text-[30px] font-bold tracking-[-0.035em] sm:text-4xl">
        이런 거 있어?
      </h1>
      <form role="search" onSubmit={submit} className="mt-6 flex items-center gap-2 rounded-card bg-surface py-1.5 pl-5 pr-1.5 shadow-card">
        <SearchIcon size={20} className="flex-none text-muted" aria-hidden="true" />
        <label htmlFor="sq" className="sr-only">
          자연어로 검색
        </label>
        <input id="sq" type="search" maxLength={200} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="필요한 기능을 말로 적어 보세요" className="h-12 min-w-0 flex-1 bg-transparent px-1 text-base outline-offset-4" />
        <PrimaryButton type="submit" className="!bg-accent">
          찾아보기
        </PrimaryButton>
      </form>

      {!q && <Empty>찾고 싶은 기능을 한 문장으로 적어 보세요. 예: 커밋 메시지를 한국어로 다듬어 주는 스킬</Empty>}
      {q && res.isPending && <Loading label="검색하는 중" />}
      {info?.kind === "warming" && <Warming key={res.errorUpdatedAt} error={res.error} onRetry={() => void res.refetch()} />}
      {info && info.kind !== "warming" && (
        <div className="mt-6">
          <ErrorBox error={res.error} onRetry={info.kind === "search-unavailable" ? undefined : () => void res.refetch()} />
          {info.kind === "search-unavailable" && (
            <p className="text-center">
              <Link to="/catalog" className="inline-flex min-h-11 items-center text-accent underline underline-offset-3">
                카탈로그로 이동
              </Link>
            </p>
          )}
        </div>
      )}
      {res.data && (
        <div className="mt-6 space-y-5">
          {res.data.degraded && <p role="status" className="rounded-2xl bg-caution px-5 py-3 text-[13px] text-caution-ink">예산 절약 모드라 키워드 검색(BM25)만 사용한 결과입니다. 의미 기반 정확도가 낮을 수 있어요.</p>}
          {res.data.items.length === 0 ? (
            <Empty>“{res.data.query}”와 맞는 항목을 찾지 못했습니다. 다른 표현으로 물어보세요.</Empty>
          ) : (
            <>
              <div className="rounded-[30px] bg-[rgba(30,45,90,0.04)] p-1.5">
                <div className="rounded-3xl bg-surface px-2.5 pb-2.5 pt-2 shadow-card">
                  <RankingHeader />
                  <ol aria-label="검색 결과">
                    {res.data.items.map((r, i) => (
                      <RankingRow key={r.item.id} row={itemRowModel(r.item, i + 1, r.snippetKo ?? r.item.description)} />
                    ))}
                  </ol>
                </div>
              </div>
              <AnswerCard q={q} ready byId={byId} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
