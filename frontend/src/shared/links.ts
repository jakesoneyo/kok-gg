// 외부 링크 조립: 원문 퍼머링크와 오탐 신고용 GitHub Issue 양식(.github/ISSUE_TEMPLATE/security-appeal.yml) 프리필.

/** 검사 시점 커밋에 고정된 퍼머링크. headSha 가 없으면 줄 위치가 틀어질 수 있어 링크를 만들지 않는다. */
export function permalink(repoUrl: string, headSha: string | null, filePath: string, line: number): string | null {
  return headSha ? `${repoUrl}/blob/${headSha}/${filePath}#L${line}` : null;
}

/** 이슈 양식의 필드 id(item_id, fingerprint)에 맞춰 쿼리를 채운다. fingerprint 가 없으면 항목 id 만 채움. */
export function falsePositiveIssueUrl(repo: string, f: { itemId: number; itemName: string; fingerprint?: string }): string {
  const sp = new URLSearchParams({ template: "security-appeal.yml", title: `[오탐 신고] ${f.itemName}`, item_id: String(f.itemId) });
  if (f.fingerprint) sp.set("fingerprint", f.fingerprint);
  return `https://github.com/${repo}/issues/new?${sp.toString()}`;
}
