import { HttpGithubClient } from './github.client';
import { GithubError, RateLimitPausedError } from './github.types';

type Handler = (url: string, n: number) => Response | Promise<Response>;

/** 호출 기록과 가짜 시계를 가진 클라이언트. sleep은 시계를 앞당길 뿐 실제로 기다리지 않는다. */
function setup(handler: Handler, opts: { coreReserve?: number } = {}) {
  let clock = 1_000_000;
  const urls: string[] = [];
  const sleeps: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchImpl = async (url: string) => {
    urls.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await Promise.resolve();
    try {
      return await handler(url, urls.length);
    } finally {
      inFlight -= 1;
    }
  };
  const client = new HttpGithubClient({
    token: 't',
    fetchImpl,
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    ...opts,
  });
  return { client, urls, sleeps, maxInFlight: () => maxInFlight };
}

const json = (
  body: unknown,
  headers: Record<string, string> = {},
  status = 200,
) => new Response(JSON.stringify(body), { status, headers });

describe('HttpGithubClient', () => {
  it('core 잔량이 예비분 아래면 다음 호출 전에 RateLimitPausedError(호출 없음)', async () => {
    const reset = String(Math.floor(1_000_000 / 1000) + 3600);
    const { client, urls } = setup(
      () =>
        json(
          { sha: 's', truncated: false, tree: [] },
          {
            'x-ratelimit-remaining': '150',
            'x-ratelimit-reset': reset,
            'x-ratelimit-resource': 'core',
          },
        ),
      { coreReserve: 200 },
    );
    await client.getTree('o', 'r', 'HEAD');
    await expect(client.getTree('o', 'r', 'HEAD')).rejects.toBeInstanceOf(
      RateLimitPausedError,
    );
    expect(urls).toHaveLength(1);
  });

  it('429 + retry-after는 그만큼 쉬고 재시도한다', async () => {
    const { client, urls, sleeps } = setup((_u, n) =>
      n === 1
        ? json({}, { 'retry-after': '3' }, 429)
        : json({ id: 1, node_id: 'n', name: 'r', owner: { login: 'o' } }),
    );
    expect((await client.getRepo('o/r'))?.name).toBe('r');
    expect(urls).toHaveLength(2);
    expect(sleeps).toEqual([3000]);
  });

  it('Star History 422는 백오프 후 재시도, 3회 모두 실패하면 GithubError(422)', async () => {
    const { client, urls, sleeps } = setup(() => json({}, {}, 422));
    await expect(client.starHistory('o', 'r')).rejects.toMatchObject({
      status: 422,
    });
    expect(urls).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('권한 없음 403(재시도 헤더 없음)은 재시도 없이 즉시 실패', async () => {
    const { client, urls } = setup(() => json({}, {}, 403));
    await expect(client.getRepo('o/r')).rejects.toBeInstanceOf(GithubError);
    expect(urls).toHaveLength(1);
  });

  it('한도 소진 403의 리셋이 1분보다 멀면 기다리지 않고 PAUSED 신호', async () => {
    const reset = String(Math.floor(1_000_000 / 1000) + 3000);
    const { client, sleeps } = setup(() =>
      json(
        {},
        { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset },
        403,
      ),
    );
    await expect(client.getRepo('o/r')).rejects.toBeInstanceOf(
      RateLimitPausedError,
    );
    expect(sleeps).toEqual([]);
  });

  it('코드 검색은 분당 10회 버킷 — 11번째는 대기', async () => {
    const { client, sleeps } = setup(() => json({ items: [] }));
    for (let i = 0; i < 11; i++) await client.searchCode('q', 1);
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps[0]).toBeGreaterThanOrEqual(6000 - 1); // 60s/10회
    expect(client.usage().codeSearch).toBe(11);
  });

  it('동시 요청은 4개를 넘지 않는다', async () => {
    const { client, maxInFlight } = setup(() => json({ sha: 's', tree: [] }));
    await Promise.all(
      Array.from({ length: 12 }, () => client.getTree('o', 'r', 'HEAD')),
    );
    expect(maxInFlight()).toBeLessThanOrEqual(4);
  });

  it('getFile: raw 404는 null, raw 5xx는 contents API로 대체', async () => {
    const a = setup(() => new Response('', { status: 404 }));
    expect(await a.client.getFile('o', 'r', 'sha', 'a.md')).toBeNull();
    expect(a.client.usage().core).toBe(0); // raw는 core 미차감 집계

    const b = setup((url) =>
      url.includes('raw.githubusercontent')
        ? new Response('', { status: 503 })
        : new Response('hello'),
    );
    expect(await b.client.getFile('o', 'r', 'sha', 'dir/a b.md')).toBe('hello');
    expect(b.urls[0]).toContain('dir/a%20b.md');
    expect(b.client.usage().core).toBe(1);
  });

  it('REVIEW Y10: getRepo는 세그먼트별로 인코딩하고 점 세그먼트는 호출하지 않는다', async () => {
    const a = setup(() => json({ message: 'nf' }, {}, 404));
    await expect(a.client.getRepo('../..')).resolves.toBeNull();
    expect(a.urls).toEqual([]);
    await a.client.getRepo('o/r?x');
    expect(a.urls[0]).toContain('/repos/o/r%3Fx');
  });

  it('REVIEW B4: getFile은 raw·contents 경로 모두 NUL을 제거한다(Postgres text는 NUL 거부)', async () => {
    const raw = setup(() => new Response('a\0b'));
    expect(await raw.client.getFile('o', 'r', 'sha', 'a.md')).toBe('ab');
    const api = setup((url) =>
      url.includes('raw.githubusercontent')
        ? new Response('', { status: 503 })
        : new Response('c\0d'),
    );
    expect(await api.client.getFile('o', 'r', 'sha', 'a.md')).toBe('cd');
  });

  it('snapshots: null 노드를 순서 그대로 보존', async () => {
    const node = {
      id: 'N1',
      databaseId: 1,
      name: 'r',
      owner: { login: 'o' },
      stargazerCount: 7,
      isArchived: false,
      isFork: false,
      defaultBranchRef: { name: 'main', target: { oid: 'a'.repeat(40) } },
      repositoryTopics: { nodes: [{ topic: { name: 'claude-code' } }] },
    };
    const { client } = setup(() => json({ data: { nodes: [null, node] } }));
    const out = await client.snapshots(['X', 'N1']);
    expect(out[0]).toBeNull();
    expect(out[1]).toMatchObject({
      stars: 7,
      headSha: 'a'.repeat(40),
      topics: ['claude-code'],
    });
    expect(client.usage().graphql).toBe(1);
  });
});
