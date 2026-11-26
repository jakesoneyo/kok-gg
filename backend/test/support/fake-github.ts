// 네트워크 없는 GitHub 세계. 저장소·파일·스타 기록을 코드로 선언하고, 호출 횟수를 센다(외부 호출 0 단언용).
// 수집 단계는 GithubClient 인터페이스만 알므로 운영 코드는 그대로 이 가짜 위에서 돈다.
import { GithubClient } from '../../src/github/github.client';
import {
  GithubError,
  type GhRepo,
  type GhSearchPage,
  type GhSnapshot,
  type GhTree,
  type GithubUsage,
  type StarWeek,
} from '../../src/github/github.types';

export interface FakeRepo {
  owner: string;
  name: string;
  stars: number;
  head: string;
  /** 경로 → 내용. */
  files: Record<string, string>;
  topics?: string[];
  createdAt?: string;
  fork?: boolean;
  archived?: boolean;
  /** undefined = 정상, 'fail' = 공식 Star History 호출 실패. */
  history?: StarWeek[] | 'fail';
}

let nextId = 5000;
const SHA = (c: string) => c.repeat(40);
export const sha = SHA;

export class FakeGithub extends GithubClient {
  readonly repos = new Map<string, FakeRepo & { id: number; nodeId: string }>();
  /** 메서드별 호출 횟수. */
  readonly calls: Record<string, number> = {};
  private used: GithubUsage = { core: 0, search: 0, codeSearch: 0, graphql: 0 };
  /** 호출 직전에 실행되는 훅 — 지연·예외 주입용. */
  hook?: (method: string, n: number) => Promise<void> | void;

  add(r: FakeRepo): this {
    this.repos.set(`${r.owner}/${r.name}`.toLowerCase(), {
      ...r,
      id: nextId++,
      nodeId: `N_${r.owner}_${r.name}`,
    });
    return this;
  }

  repo(fullName: string) {
    return this.repos.get(fullName.toLowerCase())!;
  }

  private async tick(
    method: string,
    bucket: keyof GithubUsage | null = 'core',
  ) {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    if (bucket) this.used[bucket] += 1;
    await this.hook?.(method, this.calls[method]);
  }

  private lite(r: FakeRepo & { id: number; nodeId: string }): GhRepo {
    return {
      githubId: r.id,
      nodeId: r.nodeId,
      owner: r.owner,
      name: r.name,
      description: null,
      stars: r.stars,
      pushedAt: '2026-11-25T00:00:00Z',
      createdAt: r.createdAt ?? '2025-01-01T00:00:00Z',
      archived: !!r.archived,
      fork: !!r.fork,
      topics: r.topics ?? [],
      defaultBranch: 'main',
    };
  }

  async searchRepositories(q: string, page: number): Promise<GhSearchPage> {
    await this.tick('searchRepositories', 'search');
    const topic = /topic:([\w-]+)/.exec(q)?.[1];
    const items =
      page === 1
        ? [...this.repos.values()]
            .filter((r) => topic && r.topics?.includes(topic))
            .map((r) => this.lite(r))
        : [];
    return { items, hasMore: false };
  }

  async searchCode(): Promise<GhSearchPage> {
    await this.tick('searchCode', 'codeSearch');
    return { items: [], hasMore: false };
  }

  async getRepo(fullName: string): Promise<GhRepo | null> {
    await this.tick('getRepo');
    const r = this.repos.get(fullName.toLowerCase());
    return r ? this.lite(r) : null;
  }

  async snapshots(nodeIds: string[]): Promise<(GhSnapshot | null)[]> {
    await this.tick('snapshots', 'graphql');
    const byNode = new Map([...this.repos.values()].map((r) => [r.nodeId, r]));
    return nodeIds.map((id) => {
      const r = byNode.get(id);
      return r ? { ...this.lite(r), headSha: r.head } : null;
    });
  }

  async getTree(owner: string, repo: string): Promise<GhTree> {
    await this.tick('getTree');
    const r = this.repos.get(`${owner}/${repo}`.toLowerCase());
    if (!r) throw new GithubError(404, 'GH_404', `${owner}/${repo}`);
    return {
      sha: r.head,
      truncated: false,
      entries: Object.entries(r.files).map(([path, c]) => ({
        path,
        size: c.length,
      })),
    };
  }

  async getFile(owner: string, repo: string, _ref: string, path: string) {
    await this.tick('getFile', null); // raw는 core 미차감
    return (
      this.repos.get(`${owner}/${repo}`.toLowerCase())?.files[path] ?? null
    );
  }

  async starHistory(owner: string, repo: string): Promise<StarWeek[]> {
    await this.tick('starHistory');
    const h = this.repos.get(`${owner}/${repo}`.toLowerCase())?.history;
    if (h === 'fail') throw new GithubError(422, 'GH_422', 'spammed');
    return h ?? [];
  }

  usage(): GithubUsage {
    return { ...this.used };
  }

  /** 호출 횟수 합계(스냅샷용). */
  total(): number {
    return Object.values(this.calls).reduce((a, b) => a + b, 0);
  }
}

/**
 * asOf 직전 `values.length`일의 공식 일별 증가량을 Star History 형식(일요일 시작 주, 최신 주 먼저)으로 만든다.
 * values[0]이 asOf−1일, values[1]이 asOf−2일 …
 */
export function officialHistory(asOf: string, values: number[]): StarWeek[] {
  const DAY = 86_400_000;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const perDay = new Map<number, number>();
  values.forEach((v, i) => perDay.set(end - (i + 1) * DAY, v));
  const weeks = new Map<number, number[]>();
  for (const [t, v] of perDay) {
    const dow = new Date(t).getUTCDay();
    const start = t - dow * DAY;
    const days = weeks.get(start) ?? Array<number>(7).fill(0);
    days[dow] = v;
    weeks.set(start, days);
  }
  return [...weeks.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([start, days]) => ({
      week: start / 1000,
      total: days.reduce((a, b) => a + b, 0),
      days,
    }));
}
