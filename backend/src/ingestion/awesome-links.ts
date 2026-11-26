// awesome 목록 README에서 GitHub 저장소 링크를 뽑는다(순수). 1회 시드(seed-awesome)가 Candidate로 등록한다.

/** 저장소가 아닌 github.com 최상위 경로(소유자 자리에 올 수 없는 이름). */
const RESERVED = new Set([
  'topics',
  'sponsors',
  'orgs',
  'features',
  'marketplace',
  'settings',
  'apps',
  'collections',
  'trending',
  'login',
  'about',
  'pricing',
  'explore',
  'search',
  'notifications',
  'issues',
  'pulls',
  'users',
]);
const LINK = /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)/gi;

export function parseGithubRepoLinks(
  markdown: string,
): { owner: string; name: string }[] {
  const seen = new Map<string, { owner: string; name: string }>();
  for (const m of markdown.matchAll(LINK)) {
    const owner = m[1];
    const name = m[2].replace(/\.git$/, '').replace(/\.+$/, '');
    if (!name || RESERVED.has(owner.toLowerCase())) continue;
    const key = `${owner}/${name}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, { owner, name });
  }
  return [...seen.values()];
}
