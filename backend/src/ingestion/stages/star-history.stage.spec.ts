import { officialDays } from './star-history.stage';

describe('officialDays', () => {
  it('일요일 시작 주를 날짜로 펼치고 asOf 당일 이후(부분값)는 버린다', () => {
    // 2026-11-22(일) 주: 일~토 = 22..28일
    const week = {
      week: Date.parse('2026-11-22T00:00:00Z') / 1000,
      total: 28,
      days: [1, 2, 3, 4, 5, 6, 7],
    };
    expect(officialDays([week], '2026-11-26')).toEqual([
      { day: '2026-11-22', added: 1 },
      { day: '2026-11-23', added: 2 },
      { day: '2026-11-24', added: 3 },
      { day: '2026-11-25', added: 4 },
    ]);
  });
});
