/**
 * 스타 출처 교차검증(ARCHITECTURE 4.3). 출처 2곳 이상 + 불일치는 이슈로 기록.
 * 공식 일 경계가 UTC 보장이 아니므로 일 단위가 아닌 7일 합으로 비교한다.
 */
import type { DataQualityKind } from '@prisma/client';
import { addDays, diffDays } from './dates';
import type { StarDayRow } from './gains';

export interface QualityIssue {
  kind: DataQualityKind;
  windowStart: string;
  windowEnd: string;
  diff: number;
  values: {
    snapshot?: number;
    previous?: number;
    official?: number;
    external?: number;
    stars?: number;
    tolerance?: number;
  };
}

export interface CrossValidateOptions {
  /** 마지막 완결일(공식 값은 당일 부분값이라 저장하지 않음). 검사 구간 = asOf 포함 7일. */
  asOf: string;
  stars: number;
  repoCreatedAt: string;
  /** External History 활성 여부. OSS Insight 종료 후엔 호출 측이 false. */
  externalEnabled?: boolean;
}

/** 허용오차 비율은 정수 %로 두고 정수 곱셈으로 비교해 부동소수 경계 오차를 피한다. */
const SOURCE_PCT = 15;
const SOURCE_FLOOR = 3;
const TOTAL_PCT = 2;
const TOTAL_FLOOR = 2;
const ANOMALY_KEEP_PCT = 80;
const YOUNG_REPO_DAYS = 30 * 7;

/** 허용오차(올림 없는 실수). 비교는 exceeds()에서 정수로. */
const tolerance = (max: number, floor: number, pct: number) =>
  Math.max(floor, (pct * max) / 100);
const exceeds = (a: number, b: number, floor: number, pct: number) =>
  Math.abs(a - b) * 100 > Math.max(floor * 100, pct * Math.max(a, b));

export function crossValidateStars(
  rows: readonly StarDayRow[],
  opts: CrossValidateOptions,
): QualityIssue[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const start = addDays(opts.asOf, -6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const issues: QualityIssue[] = [];

  const snapGain = (d: string) => {
    const cur = byDay.get(d)?.snapshotTotal;
    const prev = byDay.get(addDays(d, -1))?.snapshotTotal;
    return cur != null && prev != null ? cur - prev : null;
  };

  /** 7일 모두 두 출처가 있을 때만 합계 비교(빈 날을 0으로 보면 가짜 불일치). */
  const weekSums = (
    a: (d: string) => number | null | undefined,
    b: (d: string) => number | null | undefined,
  ) => {
    const as = days.map(a);
    const bs = days.map(b);
    if (as.some((x) => x == null) || bs.some((x) => x == null)) return null;
    return [as as number[], bs as number[]].map((xs) =>
      xs.reduce((s, x) => s + x, 0),
    ) as [number, number];
  };

  const official = (d: string) => byDay.get(d)?.officialAdded;
  const snap = weekSums(snapGain, official);
  if (snap && exceeds(snap[0], snap[1], SOURCE_FLOOR, SOURCE_PCT)) {
    issues.push({
      kind: 'STAR_SOURCE_MISMATCH',
      windowStart: start,
      windowEnd: opts.asOf,
      diff: Math.abs(snap[0] - snap[1]),
      values: {
        snapshot: snap[0],
        official: snap[1],
        tolerance: tolerance(Math.max(...snap), SOURCE_FLOOR, SOURCE_PCT),
      },
    });
  }

  const ext = opts.externalEnabled
    ? weekSums((d) => byDay.get(d)?.externalAdded, official)
    : null;
  if (ext && exceeds(ext[0], ext[1], SOURCE_FLOOR, SOURCE_PCT)) {
    issues.push({
      kind: 'EXTERNAL_MISMATCH',
      windowStart: start,
      windowEnd: opts.asOf,
      diff: Math.abs(ext[0] - ext[1]),
      values: {
        external: ext[0],
        official: ext[1],
        tolerance: tolerance(Math.max(...ext), SOURCE_FLOOR, SOURCE_PCT),
      },
    });
  }

  // ponytail: 생성 30주 이내만 전체 합 비교. 공식 기록이 일부만 적재된 경우의 오탐은 운영 데이터로 보고 조정
  if (diffDays(opts.asOf, opts.repoCreatedAt.slice(0, 10)) <= YOUNG_REPO_DAYS) {
    const officials = rows.filter(
      (r) => r.officialAdded != null && r.day <= opts.asOf,
    );
    const total = officials.reduce(
      (s, r) => s + (r.officialAdded as number),
      0,
    );
    if (
      officials.length > 0 &&
      exceeds(total, opts.stars, TOTAL_FLOOR, TOTAL_PCT)
    ) {
      issues.push({
        kind: 'STAR_TOTAL_MISMATCH',
        windowStart: officials.reduce(
          (m, r) => (r.day < m ? r.day : m),
          officials[0].day,
        ),
        windowEnd: opts.asOf,
        diff: Math.abs(total - opts.stars),
        values: {
          official: total,
          stars: opts.stars,
          tolerance: tolerance(
            Math.max(total, opts.stars),
            TOTAL_FLOOR,
            TOTAL_PCT,
          ),
        },
      });
    }
  }

  for (const d of days) {
    const cur = byDay.get(d)?.snapshotTotal;
    const prev = byDay.get(addDays(d, -1))?.snapshotTotal;
    if (
      cur != null &&
      prev != null &&
      prev > 0 &&
      cur * 100 < prev * ANOMALY_KEEP_PCT
    ) {
      issues.push({
        kind: 'STAR_ANOMALY',
        windowStart: d,
        windowEnd: d,
        diff: cur - prev,
        values: { snapshot: cur, previous: prev },
      });
    }
  }
  return issues;
}
