// 홈: "이런 거 있어?" 자연어 검색 히어로 + 현황 카드 + 데모 로그인 + 저장소 트렌딩(기간·종류).
import { ArrowRight, Search } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useOverview, useTrending } from "../api/queries";
import { DemoLogin } from "../components/DemoLogin";
import { RankingPanel } from "../components/RankingPanel";
import { trendRowModel } from "../components/rows";
import { Segmented } from "../components/ui";
import { KIND_OPTIONS } from "../components/labels";
import { parseTrendingParams } from "../shared/query-params";
import { WINDOWS, type Kind, type TrendWindow } from "../shared/schemas";
import { useAuth } from "../store/auth";

const EXAMPLES = ["커밋 메시지를 한국어로 다듬어 주는 스킬", "토큰 사용량을 상태줄에 보여 주는 플러그인", "마이그레이션 실수를 막는 훅"];
const WINDOW_LABEL: Record<TrendWindow, string> = { D1: "1일", D7: "7일", D30: "30일" };

function Hero() {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const overview = useOverview();
  const [q, setQ] = useState("");
  const go = (text: string) => {
    const t = text.trim();
    if (t) nav(`/search?q=${encodeURIComponent(t)}`);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(q);
  };
  const total = overview.data ? Object.values(overview.data.counts).reduce((a, b) => a + b, 0) : null;
  const stat = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));
  return (
    <section aria-labelledby="hero-h" className="mx-auto flex max-w-[1240px] flex-wrap items-end gap-x-14 gap-y-10 px-4 pb-16 pt-14 sm:px-6 md:pb-[88px] md:pt-20">
      <form role="search" onSubmit={submit} className="flex min-w-0 basis-[600px] flex-[999_1_600px] flex-col">
        <span className="inline-flex h-7 items-center gap-2 self-start rounded-full bg-surface px-3 text-xs font-medium text-ink-3 shadow-hair">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
          Claude Code 플러그인, 스킬, 훅 데일리 트렌드
        </span>
        <h1 id="hero-h" className="mt-5 text-[40px] font-bold leading-[1.08] tracking-[-0.04em] sm:text-[64px]">
          이런 거 있어?
        </h1>
        <p className="mt-4 max-w-[54ch] text-[17px] leading-[1.65] text-ink-3">
          필요한 걸 말로 물어보세요. 한국어 요약과 매일 스타 증가량, 위험 신호 탐지 결과를 함께 보여 드립니다.
        </p>
        <div className="mt-8 rounded-bevel bg-[rgba(30,45,90,0.04)] p-1.5 shadow-[inset_0_0_0_1px_rgba(30,45,90,0.06)]">
          <div className="flex items-center gap-2 rounded-card bg-surface py-1.5 pl-5 pr-1.5 shadow-card">
            <Search size={20} className="flex-none text-muted" aria-hidden="true" />
            <label htmlFor="q" className="sr-only">
              자연어로 검색
            </label>
            <input
              id="q"
              type="search"
              maxLength={200}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="PR 올리기 전에 자동으로 린트 돌려주는 훅 있어?"
              className="h-14 min-w-0 flex-1 bg-transparent px-1 text-[17px] outline-offset-4"
            />
            <button type="submit" className="inline-flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-[18px] bg-accent pl-5 pr-1.5 text-[15px] font-semibold text-white">
              찾아보기
              <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-[13px] bg-white/15">
                <ArrowRight size={16} />
              </span>
            </button>
          </div>
        </div>
        <div className="mt-[18px] flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[13px] text-muted">이렇게 물어보세요</span>
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => go(ex)} className="min-h-11 cursor-pointer rounded-full bg-surface px-4 text-sm text-ink-2 shadow-hair hover:shadow-card">
              {ex}
            </button>
          ))}
        </div>
      </form>

      <div className="grid min-w-0 flex-1 basis-[340px] grid-cols-2 gap-3">
        <div className="rounded-card bg-surface p-5 shadow-card">
          <div className="text-xs text-muted">추적 중인 저장소</div>
          <div className="mt-2.5 text-[30px] font-semibold tracking-tight">{stat(overview.data?.trackedRepos)}</div>
          <div className="mt-1 text-xs font-semibold text-accent">{overview.isError ? "불러오지 못함" : overview.data?.asOf ? `${overview.data.asOf} 기준` : " "}</div>
        </div>
        <div className="rounded-card bg-surface p-5 shadow-card">
          <div className="text-xs text-muted">등록된 항목</div>
          <div className="mt-2.5 text-[30px] font-semibold tracking-tight">{stat(total)}</div>
          <div className="mt-1 text-xs text-muted">{overview.data?.lastRun ? `마지막 수집 ${overview.data.lastRun.status}` : " "}</div>
        </div>
        <div className="col-span-2 rounded-bevel bg-accent/12 p-1.5 shadow-[inset_0_0_0_1px_rgba(51,85,214,0.2)]">
          <div className="rounded-card bg-surface p-5">
            <p className="text-[15px] font-semibold tracking-tight">북마크한 항목의 보안 등급이 바뀌면 알려 드려요</p>
            <div className="mt-4">
              {user ? (
                <Link to="/bookmarks" className="inline-flex min-h-[52px] w-full items-center justify-center rounded-full bg-ink text-[15px] font-semibold text-white">
                  내 북마크 보기
                </Link>
              ) : (
                <DemoLogin />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Home() {
  const [sp, setSp] = useSearchParams();
  const params = parseTrendingParams(sp);
  const trending = useTrending(params);
  const update = (patch: { window?: TrendWindow; kind?: Kind | "ALL" }) => {
    const next = new URLSearchParams(sp);
    if (patch.window) {
      if (patch.window === "D7") next.delete("window");
      else next.set("window", patch.window);
    }
    if (patch.kind) {
      if (patch.kind === "ALL") next.delete("kind");
      else next.set("kind", patch.kind);
    }
    setSp(next, { replace: true });
  };
  return (
    <>
      <Hero />
      <section aria-labelledby="trend-h" className="mx-auto max-w-[1240px] px-4 pb-24 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="min-w-0">
            <h2 id="trend-h" className="text-[30px] font-bold leading-[1.15] tracking-[-0.035em] sm:text-4xl">
              트렌딩
            </h2>
            <p className="mt-2 text-sm text-muted">
              저장소 단위 Trend Score{trending.asOf ? `, ${trending.asOf} 기준` : ""}. 큰 숫자는 기간 내 스타 증가량입니다.{" "}
              <Link to="/catalog" className="underline underline-offset-3 hover:text-accent">
                정렬·보안 등급 필터는 카탈로그에서
              </Link>
            </p>
          </div>
          <Segmented size="lg" label="기간" value={params.window} onChange={(w) => update({ window: w })} options={WINDOWS.map((w) => ({ value: w, label: WINDOW_LABEL[w] }))} />
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-muted">종류</span>
          <Segmented label="종류" value={params.kind ?? "ALL"} onChange={(k) => update({ kind: k })} options={KIND_OPTIONS} />
        </div>
        <RankingPanel
          label={`${WINDOW_LABEL[params.window]} 트렌딩 순위`}
          rows={trending.items.map(trendRowModel)}
          isPending={trending.isPending}
          error={trending.error}
          onRetry={() => void trending.refetch()}
          hasNext={trending.hasNextPage}
          loadingMore={trending.isFetchingNextPage}
          onMore={() => void trending.fetchNextPage()}
          emptyText="이 조건에 맞는 트렌딩 저장소가 없습니다. 증가량·활동일·데이터 커버리지 기준을 넘지 못한 저장소는 순위에서 빠집니다."
        />
        <p className="mt-4 px-2 text-[13px] text-muted">증가량, 활동일, 데이터 커버리지 기준을 넘지 못한 저장소는 순위에서 빠집니다.</p>
      </section>
    </>
  );
}

