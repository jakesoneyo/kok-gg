// 북마크: 저장한 항목 목록 + "등급 변경" 탭(북마크 시점 등급과 달라진 항목, 확인하면 기준 갱신).
import { useState } from "react";
import { Link } from "react-router-dom";
import { useAckChanges, useBookmarks, useSecurityChanges } from "../api/queries";
import { RankingPanel } from "../components/RankingPanel";
import { itemRowModel } from "../components/rows";
import { Bevel, GhostButton, KindTag, LevelBadge, QueryState } from "../components/ui";
import { describeError } from "../lib/errors";

function Changes() {
  const q = useSecurityChanges();
  const ack = useAckChanges();
  const items = q.data?.items ?? [];
  return (
    <QueryState isPending={q.isPending} error={q.error} empty={items.length === 0} emptyText="북마크한 항목 중 보안 등급이 바뀐 것이 없습니다." onRetry={() => void q.refetch()}>
      <div className="flex justify-end">
        <GhostButton disabled={ack.isPending} onClick={() => ack.mutate(undefined)}>
          모두 확인
        </GhostButton>
      </div>
      {ack.error && <p role="alert" className="mt-2 text-sm text-danger">{describeError(ack.error).message}</p>}
      <ul className="mt-3 space-y-3">
        {items.map((c) => (
          <li key={c.item.id}>
            <Bevel inner="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <KindTag kind={c.item.kind} />
                  <Link to={`/items/${c.item.id}`} className="ml-2 font-mono text-sm font-semibold hover:text-accent">
                    {c.item.repo.fullName.split("/")[0]}/{c.item.name}
                  </Link>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted">
                  <LevelBadge level={c.seenLevel} />
                  <span aria-label="에서">→</span>
                  <LevelBadge level={c.currentLevel} />
                  <GhostButton disabled={ack.isPending} onClick={() => ack.mutate([c.item.id])} aria-label={`${c.item.name} 변경 확인`}>
                    확인
                  </GhostButton>
                </div>
              </div>
              {c.newFindings.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="새로 탐지된 신호">
                  {c.newFindings.map((f) => (
                    <li key={f.ruleId} className="inline-flex items-center gap-1.5 rounded-full bg-chip px-3 py-1 text-[13px] text-ink-2">
                      <LevelBadge level={f.severity} />
                      {f.titleKo}
                    </li>
                  ))}
                </ul>
              )}
            </Bevel>
          </li>
        ))}
      </ul>
    </QueryState>
  );
}

export function Bookmarks() {
  const [tab, setTab] = useState<"saved" | "changes">("saved");
  const list = useBookmarks();
  const changes = useSecurityChanges();
  const n = changes.data?.items.length ?? 0;
  const tabCls = (on: boolean) => `min-h-11 cursor-pointer rounded-full px-5 text-sm ${on ? "bg-surface font-bold shadow-card" : "text-ink-3"}`;
  return (
    <section aria-labelledby="bm-h" className="mx-auto max-w-[1240px] px-4 pb-24 pt-12 sm:px-6">
      <h1 id="bm-h" className="text-[30px] font-bold tracking-[-0.035em] sm:text-4xl">
        북마크
      </h1>
      <div role="group" aria-label="북마크 보기" className="mt-6 inline-flex gap-0.5 rounded-full bg-track p-1">
        <button type="button" aria-pressed={tab === "saved"} onClick={() => setTab("saved")} className={tabCls(tab === "saved")}>
          저장한 항목
        </button>
        <button type="button" aria-pressed={tab === "changes"} onClick={() => setTab("changes")} className={tabCls(tab === "changes")}>
          등급 변경{n > 0 ? ` ${n}` : ""}
        </button>
      </div>
      {tab === "saved" ? (
        <RankingPanel
          label="북마크 목록"
          rows={list.items.map((b) => itemRowModel(b.item))}
          isPending={list.isPending}
          error={list.error}
          onRetry={() => void list.refetch()}
          hasNext={list.hasNextPage}
          loadingMore={list.isFetchingNextPage}
          onMore={() => void list.fetchNextPage()}
          emptyText="아직 저장한 항목이 없습니다. 목록에서 북마크 버튼을 눌러 저장해 보세요."
        />
      ) : (
        <div className="mt-5">
          <Changes />
        </div>
      )}
    </section>
  );
}
