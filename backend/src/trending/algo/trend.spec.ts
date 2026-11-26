import {
  computeTrendScore,
  concentrationPenalty,
  rankTrendScores,
  TREND_PARAMS,
  PARAMS_VERSION,
} from './trend';

const AS_OF = '2026-06-30';
const created = (daysAgo: number) =>
  new Date(Date.parse(`${AS_OF}T00:00:00Z`) - daysAgo * 86_400_000)
    .toISOString()
    .slice(0, 10);
/** series 끝이 asOf. 직전 기간(prev)을 앞에 붙인다. */
const series = (prev: (number | null)[], cur: (number | null)[]) => [
  ...prev,
  ...cur,
];
const flat = (n: number, v: number | null) => Array<number | null>(n).fill(v);

describe('computeTrendScore — ARCHITECTURE 5.2 예시 (TA-1)', () => {
  it('A 소형 꾸준 성장 ≈ 1090', () => {
    // 7일 40 균등 → 5.71/일. 정수 gain이 필요해 [6,6,6,6,6,5,5]=40
    const cur = [6, 6, 6, 6, 6, 5, 5];
    const r = computeTrendScore(series([1, 1, 1, 1, 1, 0, 0], cur), {
      window: 'D7',
      asOf: AS_OF,
      totalStars: 50,
      repoCreatedAt: created(90),
    });
    expect(r).not.toBeNull();
    expect(Math.abs(r!.score - 1090)).toBeLessThanOrEqual(0.5);
    expect(r!.acceleration).toBe(4); // (40+3)/(5+3)=5.375 → 클램프 4 → ^0.5 = 2
    expect(r!.penalty).toBe(1);
  });

  it('B 대형 ≈ 315', () => {
    const r = computeTrendScore(
      series([40, 40, 40, 40, 40, 40, 40], [43, 43, 43, 43, 43, 43, 42]),
      {
        window: 'D7',
        asOf: AS_OF,
        totalStars: 20000,
        repoCreatedAt: created(730),
      },
    );
    expect(Math.abs(r!.score - 315)).toBeLessThanOrEqual(0.5);
  });

  it('C 신규 런칭 급등: 가속도 1 고정, 집중도 감점 (표의 pen 0.46 / ≈2720은 반올림값)', () => {
    const r = computeTrendScore(
      series(flat(7, null), [400, 10, 5, 0, 0, 0, 0]),
      {
        window: 'D7',
        asOf: AS_OF,
        totalStars: 415,
        repoCreatedAt: created(3),
      },
    );
    expect(r!.acceleration).toBe(1);
    expect(r!.penalty).toBeCloseTo(0.4542, 3);
    expect(r!.score).toBeCloseTo(2693, 0); // 1000 · 5.9286 · 0.4542
    expect(Math.abs(r!.score - 2720) / 2720).toBeLessThan(0.02);
  });

  it('D 커버리지 4/7 → null', () => {
    const r = computeTrendScore([5, 5, 5, 5, null, null, null], {
      window: 'D7',
      asOf: AS_OF,
      totalStars: 100,
      repoCreatedAt: created(90),
    });
    expect(r).toBeNull();
  });
});

describe('computeTrendScore — 불변식', () => {
  const base = {
    window: 'D7' as const,
    asOf: AS_OF,
    repoCreatedAt: created(365),
  };
  const cur = [3, 3, 3, 3, 3, 3, 3];

  it('TA-2: 같은 G에서 시작 스타가 커질수록 점수 단조 감소', () => {
    const scores = [10, 100, 1000, 10000].map(
      (s0) =>
        computeTrendScore(series(cur, cur), { ...base, totalStars: s0 + 21 })!
          .score,
    );
    for (let i = 1; i < scores.length; i++)
      expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it('TA-4: 7일 중 known 5일(0.71) → null, 6일은 통과', () => {
    const five = [3, 3, 3, 3, 3, null, null];
    expect(computeTrendScore(five, { ...base, totalStars: 500 })).toBeNull();
    const six = [3, 3, 3, 3, 3, 3, null];
    expect(computeTrendScore(six, { ...base, totalStars: 500 })).not.toBeNull();
  });

  it('TA-5: 나이 10일 저장소의 D7은 가속도 1', () => {
    const r = computeTrendScore(
      series([0, 0, 0, 0, 0, 0, 0], [9, 9, 9, 9, 9, 9, 9]),
      {
        ...base,
        repoCreatedAt: created(10),
        totalStars: 500,
      },
    );
    expect(r!.acceleration).toBe(1);
  });

  it('직전 기간 커버리지 80% 미만이면 가속도 1', () => {
    const r = computeTrendScore(
      series([1, 1, null, null, null, null, null], cur),
      {
        ...base,
        totalStars: 500,
      },
    );
    expect(r!.acceleration).toBe(1);
  });

  it('시리즈가 짧아 직전 기간이 없으면 가속도 1', () => {
    const r = computeTrendScore(cur, { ...base, totalStars: 500 });
    expect(r!.acceleration).toBe(1);
  });

  it('가속도 비율은 0.5~4로 클램프', () => {
    const r = computeTrendScore(
      series([100, 100, 100, 100, 100, 100, 100], cur),
      {
        ...base,
        totalStars: 5000,
      },
    );
    expect(r!.acceleration).toBe(0.5); // (21+3)/(700+3) < 0.5 → 클램프
    expect(r!.score).toBeCloseTo(
      1000 * (21 / (7 * Math.sqrt(5000 - 21 + 100))) * Math.sqrt(0.5),
      3,
    );
  });

  it('TA-6: 집중도 c=0.6 → pen 1, c=1.0 → pen 0.4', () => {
    // G=10, 최대 6 → c=0.6 (활동일 3)
    const r = computeTrendScore([6, 2, 2, 0, 0, 0, 0], {
      ...base,
      totalStars: 500,
    });
    expect(r!.concentration).toBeCloseTo(0.6);
    expect(r!.penalty).toBe(1);
    // c=1.0은 활동일 자격 때문에 점수 경로로는 도달 불가 → 함수 단위로 고정
    expect(concentrationPenalty(0.6)).toBe(1);
    expect(concentrationPenalty(1)).toBe(0.4);
  });

  it('c가 τ를 넘으면 pen이 선형 감소', () => {
    // G=100, 최대 80 → c=0.8 → pen = 1 − 0.6·(0.2/0.4) = 0.7
    const r = computeTrendScore([80, 10, 10, 0, 0, 0, 0], {
      ...base,
      totalStars: 500,
    });
    expect(r!.penalty).toBeCloseTo(0.7);
  });

  it('D1은 집중도 감점 없음, known 필수', () => {
    expect(
      computeTrendScore([null], { ...base, window: 'D1', totalStars: 100 }),
    ).toBeNull();
    const r = computeTrendScore([50], {
      ...base,
      window: 'D1',
      totalStars: 100,
    });
    expect(r!.penalty).toBe(1);
    expect(r!.score).toBeGreaterThan(0);
  });

  it('최소 증가량 미달 → null (D1 3, D7 5, D30 10)', () => {
    expect(
      computeTrendScore([2], { ...base, window: 'D1', totalStars: 100 }),
    ).toBeNull();
    expect(
      computeTrendScore([1, 1, 1, 1, 0, 0, 0], { ...base, totalStars: 100 }),
    ).toBeNull();
    expect(
      computeTrendScore([...flat(25, 0), 1, 1, 1, 1, 1], {
        ...base,
        window: 'D30',
        totalStars: 100,
      }),
    ).toBeNull(); // G=5 < 10
  });

  it('활동일 조건 미달(D7 3일 / D30 5일) → null', () => {
    expect(
      computeTrendScore([5, 5, 0, 0, 0, 0, 0], { ...base, totalStars: 500 }),
    ).toBeNull();
    const d30 = [...flat(26, 0), 4, 4, 4, 4];
    expect(
      computeTrendScore(d30, { ...base, window: 'D30', totalStars: 500 }),
    ).toBeNull();
  });

  it('D30 정상 경로와 활동일 조건', () => {
    const r = computeTrendScore(flat(30, 1), {
      ...base,
      window: 'D30',
      totalStars: 500,
    });
    expect(r!.gain).toBe(30);
    expect(TREND_PARAMS.window.D30).toBe(30);
  });

  it('점수는 소수 4자리로 반올림', () => {
    const r = computeTrendScore(series(cur, cur), { ...base, totalStars: 777 });
    expect(r!.score).toBe(Math.round(r!.score * 1e4) / 1e4);
  });

  it('파라미터 버전 상수', () => {
    expect(PARAMS_VERSION).toBe(1);
  });
});

describe('rankTrendScores (TA-7)', () => {
  it('score desc, gain desc, repoId asc 로 결정적', () => {
    const ranked = rankTrendScores([
      { repoId: 9, score: 10, gain: 5 },
      { repoId: 3, score: 10, gain: 5 },
      { repoId: 5, score: 10, gain: 8 },
      { repoId: 1, score: 20, gain: 1 },
    ]);
    expect(ranked.map((r) => [r.repoId, r.rank])).toEqual([
      [1, 1],
      [5, 2],
      [3, 3],
      [9, 4],
    ]);
  });
});
