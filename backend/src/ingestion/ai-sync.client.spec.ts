import { AiSyncClient } from './ai-sync.client';

const OK = {
  processed: 1,
  insufficient: 0,
  failed: 0,
  remaining: 0,
  budgetExhausted: false,
  indexVersion: 1,
};
const ok = () => new Response(JSON.stringify(OK));

function setup(responses: (() => Response | Promise<Response>)[]) {
  const c = new AiSyncClient();
  const sleeps: number[] = [];
  let n = 0;
  c.fetchImpl = () => Promise.resolve(responses[n++]());
  c.sleep = (ms) => {
    sleeps.push(ms);
    return Promise.resolve();
  };
  return { c, sleeps, calls: () => n };
}
const boom = () => {
  throw new TypeError('fetch failed');
};

describe('AiSyncClient (REVIEW Y11)', () => {
  it('연결 실패·5xx(무료 티어 기상 중)는 지수 백오프로 재시도해 성공한다', async () => {
    const { c, sleeps, calls } = setup([
      boom,
      () => new Response('', { status: 503 }),
      ok,
    ]);
    await expect(c.sync(10)).resolves.toMatchObject({ processed: 1 });
    expect(calls()).toBe(3);
    expect(sleeps).toEqual([5000, 15000]);
  });

  it('재시도 3회를 넘기면 마지막 오류로 실패(총 4번 시도)', async () => {
    const { c, calls } = setup([boom, boom, boom, boom]);
    await expect(c.sync(10)).rejects.toThrow('fetch failed');
    expect(calls()).toBe(4);
  });

  it('4xx는 재시도하지 않는다', async () => {
    const { c, calls } = setup([() => new Response('', { status: 401 })]);
    await expect(c.sync(10)).rejects.toThrow('HTTP 401');
    expect(calls()).toBe(1);
  });
});
