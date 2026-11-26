// 보안 검사에 넘길 파일 선택(순수). 엔진이 실제로 쓰는 것만 고른다: 설정 JSON · SKILL.md · bin/ · 스킬·훅·scripts 아래 스크립트.
// 훅이 `${CLAUDE_PLUGIN_ROOT}/…`로 참조하는 임의 위치의 스크립트는 1차 검사의 MISSING_FILE 노트로 알아내 추가로 가져온다.
import type { TreeEntry } from '../github/github.types';
import { isConfigJson } from '../security/engine';

export const MAX_FILES_PER_ITEM = 200;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_ITEM_BYTES = 2 * 1024 * 1024;

const SCRIPT_EXT = /\.(?:sh|bash|zsh|py|js|ts|mjs|cjs)$/;
const base = (p: string) => p.slice(p.lastIndexOf('/') + 1);

const priority = (r: string, root: string) =>
  isConfigJson(r, root) ? 0 : base(r) === 'SKILL.md' ? 1 : 2;

const rel = (path: string, root: string) =>
  root
    ? path.startsWith(`${root}/`)
      ? path.slice(root.length + 1)
      : null
    : path;

/**
 * root 아래 파일 중 1차 검사 대상. 호출 측이 앞에서부터 2MB 예산으로 받아 오므로
 * 설정 JSON → SKILL.md → 스크립트 순으로 정렬한다 — 큰 스크립트로 예산을 먼저 소진시켜 설정 파일을 밀어내는 우회 방지(REVIEW B1).
 * @returns files 우선순위 정렬된 선택 파일, tooMany 상한(200) 초과 → 호출 측이 TOO_LARGE로 처리
 */
export function selectScanFiles(
  entries: readonly TreeEntry[],
  root: string,
): { files: TreeEntry[]; tooMany: boolean } {
  const inRoot = entries.flatMap((e) => {
    const r = rel(e.path, root);
    return r === null ? [] : [{ e, r }];
  });
  const skillDirs = inRoot
    .filter(({ r }) => base(r) === 'SKILL.md')
    .map(({ r }) => r.slice(0, Math.max(r.lastIndexOf('/'), 0)));
  const files = inRoot
    .filter(({ r }) => {
      const name = base(r);
      if (isConfigJson(r, root) || name === 'SKILL.md' || r.startsWith('bin/'))
        return true;
      if (!SCRIPT_EXT.test(r)) return false;
      return (
        r.startsWith('scripts/') ||
        r.startsWith('hooks/') ||
        skillDirs.some((d) => d && r.startsWith(`${d}/`))
      );
    })
    // 안정 정렬: 같은 순위끼리는 트리 순서 유지
    .sort((a, b) => priority(a.r, root) - priority(b.r, root))
    .map(({ e }) => e);
  return {
    files: files.slice(0, MAX_FILES_PER_ITEM),
    tooMany: files.length > MAX_FILES_PER_ITEM,
  };
}

/** `${CLAUDE_PLUGIN_ROOT}/` 기준 상대 참조를 저장소 경로로. 루트 탈출·빈 경로는 null. */
export function refToRepoPath(ref: string, root: string): string | null {
  const stack: string[] = [];
  for (const part of ref.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!stack.pop()) return null;
    } else stack.push(part);
  }
  return stack.length
    ? root
      ? `${root}/${stack.join('/')}`
      : stack.join('/')
    : null;
}
