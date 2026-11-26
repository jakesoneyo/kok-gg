// 선택 실행(opt-in) 라이브 스모크: 실제 GitHub 응답을 1회 캡처해 test/fixtures/github/*.json으로 저장한다.
// 기본은 건너뜀(토큰이 없으니 CI·로컬 기본 실행은 네트워크를 쓰지 않는다).
//
//   GITHUB_LIVE_TOKEN=<fine-grained PAT, 공개 저장소 읽기 전용> npx jest --config ./test/jest-e2e.json github-live
//
// 확인 대상(ARCHITECTURE 3.3·4.1의 [미검증]): Star History `week` 형식·이번 주 포함 여부·무인증/인증 차이·
// x-ratelimit-resource, GraphQL nodes 응답, 코드 검색 1페이지, raw 조회의 core 한도 차감 여부.
// 결과를 보고 ARCHITECTURE.md의 [미검증]을 확인 결과로 고치고 픽스처를 커밋한다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpGithubClient } from '../src/github/github.client';

const token = process.env.GITHUB_LIVE_TOKEN;
const live = token ? describe : describe.skip;
const OUT = join(__dirname, 'fixtures/github');
const REPO = { owner: 'anthropics', name: 'claude-code' };

async function capture(path: string, auth: boolean) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(auth ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  const headers = Object.fromEntries(
    [...res.headers].filter(
      ([k]) => k.startsWith('x-ratelimit') || k === 'retry-after',
    ),
  );
  return {
    status: res.status,
    headers,
    body: (await res.json().catch(() => null)) as unknown,
  };
}

const coreRemaining = async () =>
  (
    (await capture('/rate_limit', true)).body as {
      resources: { core: { remaining: number } };
    }
  ).resources.core.remaining;

live('GitHub 라이브 스모크 (opt-in)', () => {
  const client = new HttpGithubClient({ token: token! });
  const save = (name: string, data: unknown) => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(
      join(OUT, `${name}.json`),
      JSON.stringify(data, null, 2) + '\n',
    );
  };

  it('Star History: 형식·이번 주 포함 여부·인증 차이·rate-limit 리소스를 캡처', async () => {
    const path = `/repos/${REPO.owner}/${REPO.name}/stargazers/history?per_page=30&page=1`;
    const authed = await capture(path, true);
    const anon = await capture(path, false);
    save('star-history', { authed, anon });
    expect(authed.status).toBeLessThan(500);
    // 클라이언트 파서가 실제 응답을 통과하는지(형식이 문서와 다르면 여기서 PARSE_ERROR)
    const weeks = await client.starHistory(REPO.owner, REPO.name);
    expect(weeks.length).toBeGreaterThan(0);
    expect(weeks[0].days).toHaveLength(7);
  });

  it('GraphQL nodes · 코드 검색 1페이지', async () => {
    const repo = await client.getRepo(`${REPO.owner}/${REPO.name}`);
    const snaps = await client.snapshots([repo!.nodeId]);
    save('graphql-nodes', snaps);
    expect(snaps[0]?.headSha).toMatch(/^[0-9a-f]{40}$/);
    const code = await client.searchCode(
      'filename:SKILL.md size:1000..3000',
      1,
    );
    save('code-search-page1', code);
    expect(code.items.length).toBeGreaterThan(0);
  });

  it('raw 조회가 core 한도를 차감하는지 측정', async () => {
    const tree = await client.getTree(REPO.owner, REPO.name, 'HEAD');
    const file = tree.entries.find((e) => /readme\.md$/i.test(e.path))!;
    const before = await coreRemaining();
    await client.getFile(REPO.owner, REPO.name, 'HEAD', file.path);
    const after = await coreRemaining();
    save('raw-rate-limit', { before, after, deductedCore: before - after });
    expect(typeof after).toBe('number');
  });
});
