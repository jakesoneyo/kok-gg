// API 모델 → 화면 행 모델 변환(트렌딩 저장소 행, 항목 카드). 컴포넌트에서 필드 매핑을 흩뿌리지 않기 위함.
import { sparklineGain, trendRankChange } from "../shared/format";
import type { ItemCard, TrendRow } from "../shared/schemas";
import type { RowModel } from "./RankingRow";

export function trendRowModel(r: TrendRow): RowModel {
  const top = r.topItems[0];
  return {
    itemId: top?.id ?? null,
    rank: r.rank,
    change: trendRankChange(r),
    fullName: r.repo.fullName,
    summary: r.repo.description,
    kind: top?.kind ?? null,
    gain: r.gain,
    spark: r.repo.sparkline7d,
    stars: r.repo.stars,
    level: r.worstLevel,
  };
}

export function itemRowModel(i: ItemCard, rank: number | null | undefined = i.trendRank7d, summary: string | null = i.description): RowModel {
  return {
    itemId: i.id,
    rank,
    change: { delta: i.rankDelta, isNew: i.isNew },
    fullName: `${i.repo.fullName.split("/")[0]}/${i.name}`,
    summary,
    kind: i.kind,
    gain: sparklineGain(i.repo.sparkline7d),
    spark: i.repo.sparkline7d,
    stars: i.repo.stars,
    level: i.currentLevel,
  };
}
