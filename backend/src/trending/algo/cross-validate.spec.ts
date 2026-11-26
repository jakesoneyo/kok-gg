import { crossValidateStars } from './cross-validate';
import { addDays } from './dates';
import type { StarDayRow } from './gains';

const END = '2026-06-30';
const START = addDays(END, -6);
const OLD = '2020-01-01';

/** 7일 구간: 스냅샷 증가량과 공식 값을 각각 주어 행을 만든다. */
function week(
  snapGains: number[],
  official: (number | null)[],
  base = 1000,
): StarDayRow[] {
  const rows: StarDayRow[] = [{ day: addDays(START, -1), snapshotTotal: base }];
  let total = base;
  snapGains.forEach((g, i) => {
    total += g;
    rows.push({
      day: addDays(START, i),
      snapshotTotal: total,
      officialAdded: official[i],
    });
  });
  return rows;
}
const opts = { asOf: END, stars: 100000, repoCreatedAt: OLD };

describe('crossValidateStars', () => {
  it('일치하면 이슈 없음', () => {
    expect(
      crossValidateStars(
        week([3, 3, 3, 3, 3, 3, 2], [3, 3, 3, 3, 3, 3, 2]),
        opts,
      ),
    ).toEqual([]);
  });

  describe('TA-8 스냅샷 vs 공식 7일 합', () => {
    // Σsnap=20 → 허용오차 max(3, 3)=3
    const snap = [3, 3, 3, 3, 3, 3, 2];
    it('차이가 허용오차와 정확히 같으면 통과', () => {
      expect(
        crossValidateStars(week(snap, [2, 3, 3, 3, 2, 2, 2]), opts),
      ).toEqual([]); // 합 17, 차 3
    });
    it('허용오차를 1 초과하면 STAR_SOURCE_MISMATCH', () => {
      const issues = crossValidateStars(
        week(snap, [2, 3, 3, 2, 2, 2, 2]),
        opts,
      ); // 합 16, 차 4
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: 'STAR_SOURCE_MISMATCH',
        windowStart: START,
        windowEnd: END,
        diff: 4,
      });
      expect(issues[0].values).toMatchObject({
        snapshot: 20,
        official: 16,
        tolerance: 3,
      });
    });
    it('비율 허용오차(15%)가 3보다 크면 그쪽을 쓴다', () => {
      // 합 200 vs 170 → 허용 30, 차 30 → 통과 / 169 → 이슈
      const g = [29, 29, 29, 29, 28, 28, 28];
      expect(
        crossValidateStars(week(g, [25, 25, 25, 25, 24, 23, 23]), opts),
      ).toEqual([]);
      expect(
        crossValidateStars(week(g, [24, 25, 25, 25, 24, 23, 23]), opts),
      ).toHaveLength(1);
    });
    it('한쪽이라도 빈 날이 있으면 비교하지 않는다', () => {
      expect(
        crossValidateStars(week(snap, [0, 0, 0, 0, 0, 0, null]), opts),
      ).toEqual([]);
    });
  });

  describe('TA-9 급감 이상치', () => {
    const rows = (prev: number, cur: number): StarDayRow[] => [
      { day: addDays(END, -1), snapshotTotal: prev },
      { day: END, snapshotTotal: cur },
    ];
    it('−20% 는 통과', () => {
      expect(crossValidateStars(rows(1000, 800), opts)).toEqual([]);
    });
    it('−21% 는 STAR_ANOMALY', () => {
      const issues = crossValidateStars(rows(1000, 790), opts);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        kind: 'STAR_ANOMALY',
        windowStart: END,
        windowEnd: END,
        diff: -210,
      });
    });
    it('전일이 0이거나 없으면 판단하지 않는다', () => {
      expect(crossValidateStars(rows(0, 0), opts)).toEqual([]);
      expect(
        crossValidateStars([{ day: END, snapshotTotal: 10 }], opts),
      ).toEqual([]);
    });
  });

  describe('공식 총합 vs 현재 스타', () => {
    const young = (official: number): StarDayRow[] => [
      { day: addDays(END, -10), officialAdded: official },
    ];
    const created = addDays(END, -20);
    it('허용오차 이내면 통과', () => {
      expect(
        crossValidateStars(young(98), {
          asOf: END,
          stars: 100,
          repoCreatedAt: created,
        }),
      ).toEqual([]);
    });
    it('초과하면 STAR_TOTAL_MISMATCH', () => {
      const issues = crossValidateStars(young(90), {
        asOf: END,
        stars: 100,
        repoCreatedAt: created,
      });
      expect(issues[0]).toMatchObject({
        kind: 'STAR_TOTAL_MISMATCH',
        diff: 10,
      });
      expect(issues[0].values).toMatchObject({
        official: 90,
        stars: 100,
        tolerance: 2,
      });
    });
    it('생성 30주 초과 저장소는 건너뜀', () => {
      expect(
        crossValidateStars(young(1), {
          asOf: END,
          stars: 100,
          repoCreatedAt: OLD,
        }),
      ).toEqual([]);
    });
    it('공식 기록이 없으면 건너뜀', () => {
      expect(
        crossValidateStars([], {
          asOf: END,
          stars: 100,
          repoCreatedAt: created,
        }),
      ).toEqual([]);
    });
  });

  describe('외부 vs 공식', () => {
    const rows = (ext: number) =>
      Array.from({ length: 7 }, (_, i) => ({
        day: addDays(START, i),
        officialAdded: 10,
        externalAdded: ext,
      }));
    it('비활성이면 비교하지 않음(기본)', () => {
      expect(crossValidateStars(rows(0), opts)).toEqual([]);
    });
    it('활성이고 허용오차를 넘으면 EXTERNAL_MISMATCH', () => {
      const issues = crossValidateStars(rows(0), {
        ...opts,
        externalEnabled: true,
      });
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ kind: 'EXTERNAL_MISMATCH', diff: 70 });
    });
    it('활성이어도 일치하면 통과', () => {
      expect(
        crossValidateStars(rows(10), { ...opts, externalEnabled: true }),
      ).toEqual([]);
    });
  });
});
