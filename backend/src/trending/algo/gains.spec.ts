import { dailyGains, sparkline7d } from './gains';
import { addDays, diffDays } from './dates';

describe('dates', () => {
  it('월·연 경계를 넘는다', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28);
  });
  it('형식이 틀리면 던진다', () => {
    expect(() => addDays('2026/01/01', 1)).toThrow(RangeError);
  });
});

describe('dailyGains', () => {
  it('스냅샷 차분을 쓴다', () => {
    const rows = [
      { day: '2026-01-01', snapshotTotal: 100 },
      { day: '2026-01-02', snapshotTotal: 110 },
      { day: '2026-01-03', snapshotTotal: 125 },
    ];
    expect(dailyGains(rows, '2026-01-02', '2026-01-03')).toEqual([10, 15]);
  });

  it('스냅샷 차분이 공식 기록보다 우선한다', () => {
    const rows = [
      { day: '2026-01-01', snapshotTotal: 100, officialAdded: 9 },
      { day: '2026-01-02', snapshotTotal: 110, officialAdded: 9 },
    ];
    expect(dailyGains(rows, '2026-01-02', '2026-01-02')).toEqual([10]);
  });

  it('전일 스냅샷이 없으면 공식 기록, 그것도 없으면 null (TA-3)', () => {
    const rows = [
      { day: '2026-01-02', snapshotTotal: 5000, officialAdded: 7 },
      { day: '2026-01-05', snapshotTotal: 5100 },
    ];
    const g = dailyGains(rows, '2026-01-02', '2026-01-05');
    // 1/2: 전일 스냅샷 없음 → 공식 7, 총합 5000을 하루치로 계산하면 안 됨
    expect(g).toEqual([7, null, null, null]);
  });

  it('언스타로 음수 증가량도 그대로 둔다', () => {
    const rows = [
      { day: '2026-01-01', snapshotTotal: 100 },
      { day: '2026-01-02', snapshotTotal: 90 },
    ];
    expect(dailyGains(rows, '2026-01-02', '2026-01-02')).toEqual([-10]);
  });

  it('행이 아예 없으면 전부 null', () => {
    expect(dailyGains([], '2026-01-01', '2026-01-03')).toEqual([
      null,
      null,
      null,
    ]);
  });
});

describe('sparkline7d', () => {
  it('오래된 날 → 오늘 7칸, 모르는 날은 null', () => {
    const rows = [
      { day: '2026-01-07', snapshotTotal: 10 },
      { day: '2026-01-08', snapshotTotal: 14 },
      { day: '2026-01-09', snapshotTotal: 15 },
      { day: '2026-01-10', officialAdded: 2 },
    ];
    expect(sparkline7d(rows, '2026-01-10')).toEqual([
      null,
      null,
      null,
      null,
      4,
      1,
      2,
    ]);
  });
});
