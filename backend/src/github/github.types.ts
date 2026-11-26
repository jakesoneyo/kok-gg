// GitHub 클라이언트의 계약 타입. 수집 단계는 이 인터페이스만 알고 HTTP 세부(헤더·페이지·GraphQL)는 모른다 —
// 그래서 테스트·CI는 네트워크 없이 fake 구현으로 돈다.

/**
 * GitHub 원문 문자열에서 NUL(\0)을 제거한다. Postgres text/jsonb는 NUL을 거부하고, 저장소 작성자가 README·JSON에
 * NUL을 넣을 수 있으므로 DB에 쓰기 전 신뢰 경계(GitHub 응답)에서 한 번 걸러야 한 저장소가 배치 전체를 멈추지 못한다.
 */
/** 파일 1개를 메모리로 읽는 상한. 이보다 큰 파일은 받지 않는다(검사·요약 대상으로 의미 없고 메모리 소진 방지). */
export const MAX_FILE_BYTES = 256 * 1024;

export const stripNul = (s: string): string => s.replaceAll('\0', '');

export interface GhRepo {
  githubId: number;
  nodeId: string;
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  pushedAt: string | null;
  createdAt: string | null;
  archived: boolean;
  fork: boolean;
  topics: string[];
  defaultBranch: string | null;
}

/** GraphQL 스냅샷: 저장소 필드 + 기본 브랜치 최신 커밋. */
export interface GhSnapshot extends GhRepo {
  headSha: string | null;
}

export interface GhSearchPage {
  /** 코드 검색 결과는 저장소 단위로 중복 제거하지 않는다(같은 저장소가 여러 파일로 나올 수 있음). */
  items: GhRepo[];
  hasMore: boolean;
}

export interface TreeEntry {
  path: string;
  size: number;
}

export interface GhTree {
  sha: string;
  /** 초대형 저장소는 GitHub이 트리를 잘라 보낸다 → 호출 측이 TOO_LARGE로 표시. */
  truncated: boolean;
  entries: TreeEntry[];
}

/** 공식 Star History 한 주. `days`는 일요일 시작 7칸. */
export interface StarWeek {
  week: number;
  total: number;
  days: number[];
}

export interface GithubUsage {
  core: number;
  search: number;
  codeSearch: number;
  graphql: number;
}

export class GithubError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 남은 한도가 예비분 아래라 더 부르지 않는다 → 단계는 PAUSED로 커서를 저장하고 끝낸다(IT-4). */
export class RateLimitPausedError extends Error {
  constructor(message = 'GitHub 레이트리밋 예비분 도달') {
    super(message);
  }
}
