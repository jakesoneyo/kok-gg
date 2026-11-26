/**
 * Finding 지문. 줄 번호는 넣지 않아 위에 줄이 추가돼도 Override가 유지되고,
 * 매칭 줄 내용이 바뀌면 지문이 바뀌어 신호가 다시 뜬다(ARCHITECTURE 6.4).
 */
import { createHash } from 'node:crypto';

export function fingerprint(
  ruleId: string,
  filePath: string,
  matchedLine: string,
): string {
  const normalized = matchedLine.trim().replace(/\s+/g, ' ');
  return createHash('sha256')
    .update(`${ruleId}\0${filePath}\0${normalized}`)
    .digest('hex');
}
