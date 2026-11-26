import { ExternalStarSource } from './external-star-source';
import type { IngestConfig } from './ingest.config';

const cfg = (over: Partial<IngestConfig>): IngestConfig => ({
  maxTrackedRepos: 1,
  maxItemsPerRepo: 1,
  topics: [],
  externalSource: 'ossinsight',
  externalUntil: '2026-12-03',
  ...over,
});

describe('ExternalStarSource', () => {
  it('none이면 호출 없이 null', async () => {
    const s = new ExternalStarSource(cfg({ externalSource: 'none' }));
    s.fetchImpl = jest.fn() as never;
    expect(await s.fetchDaily('o', 'r', '2026-11-26')).toBeNull();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it('종료일(포함) 이후는 설정이 켜져 있어도 자동 no-op', async () => {
    const s = new ExternalStarSource(cfg({}));
    s.fetchImpl = jest.fn() as never;
    expect(s.isActive('2026-12-02')).toBe(true);
    expect(s.isActive('2026-12-03')).toBe(false);
    expect(await s.fetchDaily('o', 'r', '2026-12-04')).toBeNull();
    expect(s.fetchImpl).not.toHaveBeenCalled();
  });

  it('활성: 누적값을 일 차분으로 변환, 실패는 null', async () => {
    const s = new ExternalStarSource(cfg({}));
    s.fetchImpl = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              rows: [
                { date: '2026-11-01', stargazers: '10' },
                { date: '2026-11-02', stargazers: '14' },
              ],
            },
          }),
        ),
      );
    expect(await s.fetchDaily('o', 'r', '2026-11-26')).toEqual([
      { day: '2026-11-02', added: 4 },
    ]);
    s.fetchImpl = () => Promise.resolve(new Response('', { status: 500 }));
    expect(await s.fetchDaily('o', 'r', '2026-11-26')).toBeNull();
  });
});
