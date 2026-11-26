// 로컬 검증용 가짜 GitHub·AI 서버: 통합 테스트와 같은 세계(test/support/world)를 HTTP로 내놓는다.
// 실제 HttpGithubClient(레이트리밋·재시도·zod 파싱)를 네트워크·토큰 없이 끝까지 돌려 보는 용도.
//
// 실행: npx ts-node scripts/fake-github-server.ts [port=4010]
//   그다음 GITHUB_API_BASE=http://127.0.0.1:4010 GITHUB_RAW_BASE=http://127.0.0.1:4010/raw \
//        AI_BASE_URL=http://127.0.0.1:4010 GITHUB_TOKEN_INGEST=fake npm run cli
import { createServer, type ServerResponse } from 'node:http';
import { FakeGithub } from '../test/support/fake-github';
import { D1, world } from '../test/support/world';

const gh: FakeGithub = world();
const port = Number(process.argv[2] ?? 4010);

const rest = (r: ReturnType<FakeGithub['repo']>) => ({
  id: r.id,
  node_id: r.nodeId,
  name: r.name,
  owner: { login: r.owner },
  description: null,
  stargazers_count: r.stars,
  pushed_at: '2026-11-25T00:00:00Z',
  created_at: r.createdAt ?? '2025-01-01T00:00:00Z',
  archived: !!r.archived,
  fork: !!r.fork,
  topics: r.topics ?? [],
  default_branch: 'main',
});

function send(res: ServerResponse, status: number, body: unknown, raw = false) {
  res.writeHead(status, {
    'content-type': raw ? 'text/plain' : 'application/json',
    'x-ratelimit-remaining': '4900',
    'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
    'x-ratelimit-resource': 'core',
  });
  res.end(raw ? String(body) : JSON.stringify(body));
}

createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://x');
    const seg = url.pathname.split('/').filter(Boolean);
    const find = (o: string, n: string) =>
      gh.repos.get(`${o}/${n}`.toLowerCase());

    if (req.method === 'POST' && seg[0] === 'internal') {
      return send(res, 200, {
        processed: 0,
        insufficient: 0,
        failed: 0,
        remaining: 0,
        budgetExhausted: false,
        indexVersion: 1,
      });
    }
    if (url.pathname === '/search/repositories') {
      const topic = /topic:([\w-]+)/.exec(url.searchParams.get('q') ?? '')?.[1];
      const items =
        url.searchParams.get('page') === '1'
          ? [...gh.repos.values()]
              .filter((r) => topic && r.topics?.includes(topic))
              .map(rest)
          : [];
      return send(res, 200, { items });
    }
    if (url.pathname === '/search/code') return send(res, 200, { items: [] });
    if (url.pathname === '/graphql') {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const { variables } = JSON.parse(Buffer.concat(chunks).toString()) as {
        variables: { ids: string[] };
      };
      const byNode = new Map([...gh.repos.values()].map((r) => [r.nodeId, r]));
      const nodes = variables.ids.map((id) => {
        const r = byNode.get(id);
        return r
          ? {
              id: r.nodeId,
              databaseId: r.id,
              name: r.name,
              owner: { login: r.owner },
              description: null,
              stargazerCount: r.stars,
              pushedAt: '2026-11-25T00:00:00Z',
              createdAt: r.createdAt ?? '2025-01-01T00:00:00Z',
              isArchived: false,
              isFork: false,
              defaultBranchRef: { name: 'main', target: { oid: r.head } },
              repositoryTopics: {
                nodes: (r.topics ?? []).map((name) => ({ topic: { name } })),
              },
            }
          : null;
      });
      return send(res, 200, { data: { nodes } });
    }
    // raw: /raw/:o/:r/:ref/<path>  ·  REST: /repos/:o/:r[/…]
    if (seg[0] === 'raw') {
      const text = find(seg[1], seg[2])?.files[
        decodeURIComponent(seg.slice(4).join('/'))
      ];
      return text === undefined
        ? send(res, 404, 'not found', true)
        : send(res, 200, text, true);
    }
    if (seg[0] === 'repos') {
      const r = find(seg[1], seg[2]);
      if (!r) return send(res, 404, { message: 'Not Found' });
      if (seg.length === 3) return send(res, 200, rest(r));
      if (seg[3] === 'git') {
        return send(res, 200, {
          sha: r.head,
          truncated: false,
          tree: Object.entries(r.files).map(([path, c]) => ({
            path,
            type: 'blob',
            size: c.length,
          })),
        });
      }
      if (seg[3] === 'stargazers') {
        const h = await gh.starHistory(seg[1], seg[2]).catch(() => null);
        return h ? send(res, 200, h) : send(res, 422, { message: 'spammed' });
      }
      if (seg[3] === 'contents') {
        const text = r.files[decodeURIComponent(seg.slice(4).join('/'))];
        return text === undefined
          ? send(res, 404, {})
          : send(res, 200, text, true);
      }
    }
    send(res, 404, { message: 'Not Found' });
  })();
}).listen(port, '127.0.0.1', () =>
  console.log(`fake github on :${port} (as_of 권장 ${D1})`),
);
