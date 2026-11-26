/**
 * 트렌드 점수(ARCHITECTURE 5장). 규모 보정 일평균 속도 × 평활 가속도^β × 급등 집중도 감점.
 * 순수 함수 — 시리즈는 dailyGains() 결과를 받는다.
 */
import type { TrendWindow } from '@prisma/client';
import { diffDays } from './dates';

/** 파라미터를 바꾸면 과거 점수와 비교 불가 → trend_score.params_version에 함께 저장. */
export const PARAMS_VERSION = 1;

export const TREND_PARAMS = {
  window: { D1: 1, D7: 7, D30: 30 } satisfies Record<TrendWindow, number>,
  /** 0★ 저장소 +10 ≈ 1만★ 저장소 +100 이 되도록 하는 사전값. */
  k: 100,
  /** 직전 기간 증가량이 0일 때 가속도 무한대 방지(라플라스 평활). */
  alpha: 3,
  accelMin: 0.5,
  accelMax: 4,
  beta: 0.5,
  /** 하루에 이 비율 넘게 몰리면 감점 시작. */
  tau: 0.6,
  /** 전부 하루에 몰렸을 때의 최저 배율. */
  floor: 0.4,
  minGain: { D1: 3, D7: 5, D30: 10 } satisfies Record<TrendWindow, number>,
  minActiveDays: { D1: 0, D7: 3, D30: 5 } satisfies Record<TrendWindow, number>,
  minCoverage: 0.8,
};
export type TrendParams = typeof TREND_PARAMS;

export interface TrendContext {
  window: TrendWindow;
  /** 기준일. series의 마지막 원소가 이 날. */
  asOf: string;
  totalStars: number;
  /** 저장소 생성일(YYYY-MM-DD 또는 ISO — 앞 10자만 사용). */
  repoCreatedAt: string;
}

export interface TrendResult {
  score: number;
  /** 기간 증가량 G — 동률 해소에 사용. */
  gain: number;
  velocity: number;
  acceleration: number;
  concentration: number;
  penalty: number;
}

const sum = (xs: (number | null)[]) =>
  xs.reduce<number>((a, x) => a + (x ?? 0), 0);
const known = (xs: (number | null)[]) => xs.filter((x) => x != null).length;

/** 집중도 c → 감점 배율. c ≤ τ 이면 1, c=1 이면 floor. */
export function concentrationPenalty(
  c: number,
  p: TrendParams = TREND_PARAMS,
): number {
  if (c <= p.tau) return 1;
  return 1 - (1 - p.floor) * ((c - p.tau) / (1 - p.tau));
}

/**
 * 자격 미달·데이터 부족이면 null(순위 제외). 왜 순수 함수: 같은 입력이면 같은 점수여야 재실행해도 순위가 안 흔들린다.
 * @param ctx 기간·기준일·누적 스타·생성일
 * @param params 테스트에서 파라미터를 바꿔 볼 수 있게 주입
 * @returns 점수와 구성 요소, 자격 미달이면 null
 * @param series 일일 증가량, 오래된 날 → asOf. 길이는 최대 2×기간(직전 기간 포함); 짧으면 모자란 날은 모름 취급.
 */
export function computeTrendScore(
  series: readonly (number | null)[],
  ctx: TrendContext,
  params: TrendParams = TREND_PARAMS,
): TrendResult | null {
  const w = params.window[ctx.window];
  const cur = series.slice(-w);
  const prev = series.slice(-2 * w, -w);

  if (known(cur) / w < params.minCoverage) return null;
  // 직전 기간이 짧아 모자란 칸은 모름이므로 분모를 w로 고정
  const prevCoverage = known(prev) / w;

  const gain = sum(cur);
  if (gain < params.minGain[ctx.window]) return null;
  if (cur.filter((x) => (x ?? 0) > 0).length < params.minActiveDays[ctx.window])
    return null;

  const startStars = Math.max(ctx.totalStars - gain, 0);
  const velocity = gain / (w * Math.sqrt(startStars + params.k));

  // 신규 저장소(나이 < 2w)·직전 데이터 부족이면 가속도 가산 금지 → 1 고정
  const age = diffDays(ctx.asOf, ctx.repoCreatedAt.slice(0, 10));
  const acceleration =
    age < 2 * w || prevCoverage < params.minCoverage
      ? 1
      : Math.min(
          Math.max(
            // 언스타로 직전 합이 음수가 돼도 분모가 0 이하가 되지 않게(REVIEW Y1)
            (gain + params.alpha) / (Math.max(sum(prev), 0) + params.alpha),
            params.accelMin,
          ),
          params.accelMax,
        );

  // 언스타로 음수 일이 섞이면 max/gain이 1을 넘어 감점 배율이 음수가 된다 → [0,1]로 고정
  const concentration =
    w >= 7
      ? Math.min(Math.max(Math.max(...cur.map((x) => x ?? 0)) / gain, 0), 1)
      : 0;
  const penalty = w >= 7 ? concentrationPenalty(concentration, params) : 1;

  const score =
    Math.round(1000 * velocity * acceleration ** params.beta * penalty * 1e4) /
    1e4;
  return { score, gain, velocity, acceleration, concentration, penalty };
}

export interface RankInput {
  repoId: number;
  score: number;
  gain: number;
}

/**
 * score desc → gain desc → repoId asc. 동률도 결정적이라 재실행해도 순위가 흔들리지 않는다.
 * @returns 1부터 시작하는 rank가 붙은 정렬 사본
 */
export function rankTrendScores<T extends RankInput>(
  entries: readonly T[],
): (T & { rank: number })[] {
  return [...entries]
    .sort((a, b) => b.score - a.score || b.gain - a.gain || a.repoId - b.repoId)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
