import { parseCliArgs } from './cli-args';

describe('parseCliArgs', () => {
  it('옵션을 해석한다', () => {
    expect(
      parseCliArgs([
        'ingest',
        '--as-of',
        '2026-11-26',
        '--run-id',
        '7',
        '--stages',
        'DISCOVER,QUALITY',
      ]),
    ).toEqual({
      asOf: '2026-11-26',
      runId: 7,
      stages: ['DISCOVER', 'QUALITY'],
    });
    expect(parseCliArgs(['ingest'])).toEqual({
      asOf: undefined,
      runId: undefined,
      stages: undefined,
    });
  });
  it('잘못된 명령·날짜·단계는 거절', () => {
    expect(() => parseCliArgs(['nope'])).toThrow();
    expect(() => parseCliArgs(['ingest', '--as-of', '11/26'])).toThrow();
    expect(() => parseCliArgs(['ingest', '--stages', 'BOGUS'])).toThrow();
  });
});
