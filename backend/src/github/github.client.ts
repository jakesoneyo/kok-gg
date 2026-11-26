// GitHub 클라이언트 인터페이스(DI 토큰 겸용)와 native fetch 구현. 레이트리밋 예산은 여기서만 다룬다:
// 리소스별 토큰 버킷(search 30/분·code 10/분) · 잔량 추적과 예비분 · 403/429/422/5xx 백오프 · 동시 요청 4.
import { Injectable } from '@nestjs/common';
import {
  GithubError,
  RateLimitPausedError,
  type GhRepo,
  type GhSearchPage,
  type GhSnapshot,
  type GhTree,
  type GithubUsage,
  type StarWeek,
} from './github.types';

export abstract class GithubClient {
  abstract searchRepositories(q: string, page: number): Promise<GhSearchPage>;
  abstract searchCode(q: string, page: number): Promise<GhSearchPage>;
  /** 없는 저장소는 null. */
  abstract getRepo(fullName: string): Promise<GhRepo | null>;
  /** 입력 순서를 유지하며, 삭제·접근 불가 저장소는 null. 100개 이하. */
  abstract snapshots(nodeIds: string[]): Promise<(GhSnapshot | null)[]>;
  abstract getTree(owner: string, repo: string, ref: string): Promise<GhTree>;
  /** 없는 파일은 null. */
  abstract getFile(
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<string | null>;
  abstract starHistory(owner: string, repo: string): Promise<StarWeek[]>;
  /** 누적 호출 횟수(단계 통계용: 단계 전후 차이를 기록). */
  abstract usage(): GithubUsage;
}

type Resource = 'core' | 'search' | 'code_search' | 'graphql';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- 외부 JSON, 아래 map*에서 좁힌다

export interface HttpGithubOptions {
  token: string;
  /** 이 값 미만으로 남으면 core/graphql 호출을 멈춘다(ARCHITECTURE 3.1). */
  coreReserve?: number;
  concurrency?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  apiBase?: string;
  rawBase?: string;
}

const MAX_ATTEMPTS = 3;
/** 이보다 오래 기다려야 하면(시간당 한도 소진) 대기 대신 PAUSED로 끝낸다. */
const MAX_INLINE_WAIT_MS = 60_000;
const BUCKETS: Partial<Record<Resource, number>> = {
  search: 30,
  code_search: 10,
};

/** 분당 N회 토큰 버킷. 비었으면 다음 토큰까지 sleep. */
class TokenBucket {
  private tokens: number;
  private last: number;
  constructor(
    private readonly perMinute: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {
    this.tokens = perMinute;
    this.last = now();
  }
  async take(): Promise<void> {
    for (;;) {
      const t = this.now();
      this.tokens = Math.min(
        this.perMinute,
        this.tokens + ((t - this.last) / 60_000) * this.perMinute,
      );
      this.last = t;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await this.sleep(
        Math.ceil(((1 - this.tokens) * 60_000) / this.perMinute),
      );
    }
  }
}

/** 동시 실행 상한(2차 한도 100 동시 대비 4). */
class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max)
      await new Promise<void>((r) => this.waiting.push(r));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

const GRAPHQL = `query($ids:[ID!]!){nodes(ids:$ids){... on Repository{
  id databaseId name owner{login} description stargazerCount pushedAt createdAt
  isArchived isFork defaultBranchRef{name target{oid}} repositoryTopics(first:20){nodes{topic{name}}}}}}`;

export function mapRepo(r: Json): GhRepo {
  const owner = r.owner?.login ?? r.full_name?.split('/')[0];
  const name = r.name ?? r.full_name?.split('/')[1];
  const githubId = r.id ?? r.databaseId;
  if (!owner || !name || typeof githubId !== 'number' || !r.node_id)
    throw new GithubError(0, 'PARSE_ERROR', '저장소 응답 형식 불일치');
  return {
    githubId,
    nodeId: r.node_id,
    owner,
    name,
    description: r.description ?? null,
    stars: r.stargazers_count ?? 0,
    pushedAt: r.pushed_at ?? null,
    createdAt: r.created_at ?? null,
    archived: !!r.archived,
    fork: !!r.fork,
    topics: r.topics ?? [],
    defaultBranch: r.default_branch ?? null,
  };
}

@Injectable()
export class HttpGithubClient extends GithubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly reserve: number;
  private readonly api: string;
  private readonly raw: string;
  private readonly sem: Semaphore;
  private readonly buckets = new Map<Resource, TokenBucket>();
  /** 응답 헤더로 갱신하는 리소스별 잔량·리셋(epoch ms). */
  private readonly limits = new Map<
    string,
    { remaining: number; resetAt: number }
  >();
  private readonly used: GithubUsage = {
    core: 0,
    search: 0,
    codeSearch: 0,
    graphql: 0,
  };

  constructor(private readonly opts: HttpGithubOptions) {
    super();
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.reserve = opts.coreReserve ?? 200;
    this.api = opts.apiBase ?? 'https://api.github.com';
    this.raw = opts.rawBase ?? 'https://raw.githubusercontent.com';
    this.sem = new Semaphore(opts.concurrency ?? 4);
    for (const [res, n] of Object.entries(BUCKETS))
      this.buckets.set(
        res as Resource,
        new TokenBucket(n, this.now, this.sleep),
      );
  }

  usage(): GithubUsage {
    return { ...this.used };
  }

  private count(resource: Resource) {
    if (resource === 'code_search') this.used.codeSearch += 1;
    else this.used[resource] += 1;
  }

  /** core·graphql 잔량이 예비분 아래면(리셋 전) 호출하지 않고 PAUSED 신호를 던진다. */
  private guardReserve(resource: Resource) {
    const l = this.limits.get(resource);
    if (!l || BUCKETS[resource]) return;
    if (this.now() >= l.resetAt) this.limits.delete(resource);
    else if (l.remaining < this.reserve) throw new RateLimitPausedError();
  }

  private track(res: Response, fallback: Resource) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining === null || reset === null) return;
    const resource = (res.headers.get('x-ratelimit-resource') ??
      fallback) as Resource;
    this.limits.set(resource, {
      remaining: Number(remaining),
      resetAt: Number(reset) * 1000,
    });
  }

  /**
   * 한 요청의 공통 경로: 버킷 → 예비분 검사 → 호출 → 헤더 추적 → 재시도.
   * 404는 호출 측이 의미를 정하도록 응답을 그대로 돌려준다.
   * 재시도 대상: 429 · 403(2차 한도/소진) · 422(Star History spam 방지) · 5xx · 네트워크 오류.
   */
  private async request(
    resource: Resource,
    url: string,
    init: RequestInit = {},
    retryOn422 = false,
  ): Promise<Response> {
    return this.sem.run(async () => {
      let lastErr: unknown;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await this.buckets.get(resource)?.take();
        this.guardReserve(resource);
        this.count(resource);
        let res: Response;
        try {
          res = await this.fetchImpl(url, {
            ...init,
            headers: {
              accept: 'application/vnd.github+json',
              authorization: `Bearer ${this.opts.token}`,
              'x-github-api-version': '2022-11-28',
              ...init.headers,
            },
            signal: AbortSignal.timeout(30_000),
          });
        } catch (e) {
          lastErr = e;
          await this.sleep(1000 * 2 ** (attempt - 1));
          continue;
        }
        this.track(res, resource);
        // 403은 한도 소진·2차 한도(retry-after)일 때만 재시도 — 접근 금지 403을 재시도하면 PAUSED로 오인된다
        const limited =
          res.status === 429 ||
          (res.status === 403 &&
            (res.headers.has('retry-after') ||
              res.headers.get('x-ratelimit-remaining') === '0'));
        const retryable =
          limited || res.status >= 500 || (retryOn422 && res.status === 422);
        if (!retryable) return res;

        const wait = this.backoffMs(res, attempt);
        if (wait > MAX_INLINE_WAIT_MS) throw new RateLimitPausedError();
        lastErr = new GithubError(res.status, `GH_${res.status}`, url);
        if (attempt < MAX_ATTEMPTS) await this.sleep(wait);
        else if (limited)
          throw new RateLimitPausedError(`GitHub ${res.status} 재시도 소진`);
      }
      throw lastErr instanceof GithubError
        ? lastErr
        : new GithubError(0, 'GH_NETWORK', String(lastErr));
    });
  }

  /** retry-after 우선, 한도 소진이면 리셋까지, 아니면 지수 백오프. */
  private backoffMs(res: Response, attempt: number): number {
    const ra = res.headers.get('retry-after');
    if (ra) return Number(ra) * 1000;
    if (res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      return Math.max(reset - this.now(), 0) + 1000;
    }
    return 1000 * 2 ** (attempt - 1);
  }

  private async json<T = Json>(
    resource: Resource,
    path: string,
    init?: RequestInit,
    retryOn422 = false,
  ): Promise<T | null> {
    const res = await this.request(
      resource,
      `${this.api}${path}`,
      init,
      retryOn422,
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new GithubError(res.status, `GH_${res.status}`, path);
    return (await res.json()) as T;
  }

  async searchRepositories(q: string, page: number): Promise<GhSearchPage> {
    const body = await this.json(
      'search',
      `/search/repositories?q=${encodeURIComponent(q)}&sort=updated&per_page=100&page=${page}`,
    );
    const items = (body?.items ?? []).map(mapRepo);
    return { items, hasMore: items.length === 100 };
  }

  async searchCode(q: string, page: number): Promise<GhSearchPage> {
    const body = await this.json(
      'code_search',
      `/search/code?q=${encodeURIComponent(q)}&per_page=100&page=${page}`,
    );
    const raw: Json[] = body?.items ?? [];
    return {
      items: raw.map((i) => mapRepo(i.repository)),
      hasMore: raw.length === 100,
    };
  }

  async getRepo(fullName: string): Promise<GhRepo | null> {
    const body = await this.json('core', `/repos/${fullName}`);
    return body ? mapRepo(body) : null;
  }

  async snapshots(nodeIds: string[]): Promise<(GhSnapshot | null)[]> {
    const body = await this.json('graphql', '/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: GRAPHQL, variables: { ids: nodeIds } }),
    });
    if (body?.errors && !body.data)
      throw new GithubError(200, 'GH_GRAPHQL', JSON.stringify(body.errors));
    const nodes: (Json | null)[] = body?.data?.nodes ?? [];
    return nodes.map((n) =>
      n?.id
        ? {
            githubId: n.databaseId,
            nodeId: n.id,
            owner: n.owner.login,
            name: n.name,
            description: n.description ?? null,
            stars: n.stargazerCount,
            pushedAt: n.pushedAt ?? null,
            createdAt: n.createdAt ?? null,
            archived: n.isArchived,
            fork: n.isFork,
            topics: (n.repositoryTopics?.nodes ?? []).map(
              (t: Json) => t.topic.name,
            ),
            defaultBranch: n.defaultBranchRef?.name ?? null,
            headSha: n.defaultBranchRef?.target?.oid ?? null,
          }
        : null,
    );
  }

  async getTree(owner: string, repo: string, ref: string): Promise<GhTree> {
    const body = await this.json(
      'core',
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    if (!body) throw new GithubError(404, 'GH_404', `${owner}/${repo}`);
    return {
      sha: body.sha,
      truncated: !!body.truncated,
      entries: (body.tree as Json[])
        .filter((e) => e.type === 'blob')
        .map((e) => ({ path: e.path, size: e.size ?? 0 })),
    };
  }

  /**
   * raw 우선(core 한도 미차감으로 알려져 있음 — [미검증], 캡처 후 확인), raw가 404 외로 실패하면 contents API로 대체.
   * raw 호스트에는 토큰을 보내지 않는다(공개 저장소만 다루며 PAT를 다른 호스트로 내보낼 이유가 없음).
   */
  async getFile(
    owner: string,
    repo: string,
    ref: string,
    path: string,
  ): Promise<string | null> {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    try {
      const res = await this.fetchImpl(
        `${this.raw}/${owner}/${repo}/${ref}/${encoded}`,
        { signal: AbortSignal.timeout(30_000) },
      );
      if (res.status === 404) return null;
      if (res.ok) return await res.text();
    } catch {
      /* contents API로 대체 */
    }
    const res = await this.request(
      'core',
      `${this.api}/repos/${owner}/${repo}/contents/${encoded}?ref=${ref}`,
      { headers: { accept: 'application/vnd.github.raw+json' } },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new GithubError(res.status, `GH_${res.status}`, path);
    return res.text();
  }

  /** 응답 형식은 문서 기준(`{week,total,days[7]}`, 최신 주부터) — 실제 캡처 전까지 [미검증]. */
  async starHistory(owner: string, repo: string): Promise<StarWeek[]> {
    const body = await this.json<Json[]>(
      'core',
      `/repos/${owner}/${repo}/stargazers/history?per_page=30&page=1`,
      undefined,
      true,
    );
    if (!body) throw new GithubError(404, 'GH_404', `${owner}/${repo}`);
    return body.map((w) => ({
      week: Number(w.week),
      total: Number(w.total),
      days: (w.days as number[]).map(Number),
    }));
  }
}
