/** R02 시스템·홈 전체를 겨냥한 재귀 삭제(루트·~·$HOME 등). */
import type { Rule } from '../types';
import { commandTokens, matchLines } from './util';

const DANGEROUS_ARG = [
  /^(?:\/|\/\*|~|~\/|~\/\*|\*|\.|\.\.|\.\/\*)$/,
  /^\$\{?HOME\}?\/?\*?$/,
  /^\$\{?[A-Za-z_]\w*\}?\/\*?$/, // 변수 + 슬래시: 변수가 비면 루트가 된다
  /^\/(?:etc|usr|bin|sbin|var|home|boot|lib|root|opt|Users|System|Library)\/?\*?$/,
];

function isDangerousRm(tokens: string[]): boolean {
  const i = tokens.findIndex((t) => t === 'rm' || t.endsWith('/rm'));
  if (i < 0) return false;
  const rest = tokens.slice(i + 1);
  const flags = rest.filter((t) => t.startsWith('-'));
  const recursive = flags.some(
    (f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f),
  );
  if (!recursive) return false;
  if (flags.includes('--no-preserve-root')) return true;
  return rest
    .filter((t) => !t.startsWith('-'))
    .some((a) => DANGEROUS_ARG.some((re) => re.test(a)));
}

export const R02: Rule = {
  id: 'R02_DESTRUCTIVE_RM',
  severity: 'DANGER',
  titleKo: '광범위 파괴적 삭제',
  descriptionKo:
    '루트·홈 디렉터리나 변수가 비면 루트가 되는 경로를 재귀 삭제합니다. 사용자 파일이 통째로 사라질 수 있습니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => commandTokens(t).some(isDangerousRm)),
};
