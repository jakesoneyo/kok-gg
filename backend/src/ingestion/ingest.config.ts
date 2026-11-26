// 수집 설정(환경변수). 단계들이 주입받아 쓰므로 테스트는 값을 바꿔 끼운다.
export interface IngestConfig {
  maxTrackedRepos: number;
  maxItemsPerRepo: number;
  /** 토픽 검색 목록(SPEC F1). */
  topics: string[];
  externalSource: 'none' | 'ossinsight';
  /** 이 날짜(포함) 이후 외부 출처 어댑터는 자동 비활성. */
  externalUntil: string;
}

export const INGEST_CONFIG = Symbol('INGEST_CONFIG');

/** Actions 타임아웃(120분)보다 넉넉한 값. 이보다 오래 RUNNING이면 배치는 이미 죽은 것으로 본다. */
export const STALE_RUN_MS = 3 * 3_600_000;

export const DEFAULT_TOPICS = [
  'claude-code',
  'claude-code-plugin',
  'claude-code-plugins',
  'claude-skills',
  'claude-code-skills',
  'claude-code-hooks',
  'claude-code-marketplace',
  'agent-skills',
  'claude-plugin',
];

const num = (v: string | undefined, d: number) => (v ? Number(v) : d);

export function loadIngestConfig(
  env: NodeJS.ProcessEnv = process.env,
): IngestConfig {
  return {
    maxTrackedRepos: num(env.MAX_TRACKED_REPOS, 2000),
    maxItemsPerRepo: num(env.MAX_ITEMS_PER_REPO, 50),
    topics: DEFAULT_TOPICS,
    externalSource:
      env.EXTERNAL_STAR_SOURCE === 'ossinsight' ? 'ossinsight' : 'none',
    externalUntil: env.EXTERNAL_STAR_SOURCE_UNTIL || '2026-12-03',
  };
}
