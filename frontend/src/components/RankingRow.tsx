// 순위/목록 한 행. 트렌딩(저장소 단위)·카탈로그·검색·북마크가 공유. 모바일은 2단 카드, md 이상은 표 형태 그리드.
import { Link } from "react-router-dom";
import { formatGain, formatRankChange, type RankTone } from "../shared/format";
import type { Kind, Level } from "../shared/schemas";
import { BookmarkButton } from "./BookmarkButton";
import { Sparkline } from "./Sparkline";
import { KindTag, LevelBadge } from "./ui";

export type RowModel = {
  itemId: number | null; // 상세·북마크 대상 항목(트렌딩 행은 저장소의 대표 항목)
  rank?: number | null;
  change?: { delta: number | null; isNew: boolean };
  fullName: string;
  summary: string | null;
  kind: Kind | null;
  gain: number | null;
  spark: (number | null)[];
  stars: number;
  level: Level | null;
};

const TONE: Record<RankTone, string> = { up: "text-accent", down: "text-muted", flat: "text-muted", new: "text-ink" };
export const ROW_COLS = "md:grid-cols-[52px_minmax(0,1fr)_84px_176px_92px_92px_44px]";

export function RankingHeader() {
  return (
    <div aria-hidden="true" className={`hidden h-11 items-center gap-4 px-3.5 text-xs font-medium text-muted md:grid ${ROW_COLS}`}>
      <span>순위</span>
      <span>저장소 / 한국어 요약</span>
      <span>종류</span>
      <span className="text-right font-semibold text-accent">7일 증가</span>
      <span className="text-right">총 스타</span>
      <span>보안</span>
      <span />
    </div>
  );
}

export function RankingRow({ row }: { row: RowModel }) {
  const [owner, ...rest] = row.fullName.split("/");
  const name = rest.join("/");
  const ch = row.change ? formatRankChange(row.change) : null;
  return (
    <li
      className={`grid min-h-[78px] grid-cols-[44px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[18px] border-t border-[#eef1f7] px-3.5 py-2.5 first:border-t-transparent motion-safe:transition motion-safe:duration-300 hover:bg-accent/5 ${ROW_COLS}`}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-lg font-semibold tracking-tight">{row.rank ?? "·"}</span>
        {ch?.text && (
          <span className={`font-mono text-[11px] font-semibold ${TONE[ch.tone]}`} aria-label={`순위 변동 ${ch.text}`}>
            {ch.text}
          </span>
        )}
      </div>
      <div className="min-w-0">
        {row.itemId !== null ? (
          <Link to={`/items/${row.itemId}`} className="font-mono text-sm hover:text-accent">
            <span className="text-muted">{owner}/</span>
            <span className="font-semibold">{name}</span>
          </Link>
        ) : (
          <span className="font-mono text-sm">{row.fullName}</span>
        )}
        {row.summary && <p className="mt-1 truncate text-[13.5px] leading-normal text-ink-3">{row.summary}</p>}
      </div>
      <div className="col-span-2 flex flex-wrap items-center justify-between gap-3 md:contents">
        <span className="md:order-none">{row.kind && <KindTag kind={row.kind} />}</span>
        <div className="flex items-center justify-end gap-3">
          <Sparkline values={row.spark} />
          <span className="min-w-[58px] text-right text-[21px] font-bold tracking-tight text-accent" aria-label={`7일 증가 ${formatGain(row.gain)}`}>
            {formatGain(row.gain)}
          </span>
        </div>
        <span className="text-right text-sm text-ink-3">
          <span className="md:hidden text-xs text-muted">총 스타 </span>
          {row.stars.toLocaleString("en-US")}
        </span>
        <span>
          <LevelBadge level={row.level} />
        </span>
        <span>{row.itemId !== null && <BookmarkButton itemId={row.itemId} label={row.fullName} />}</span>
      </div>
    </li>
  );
}
