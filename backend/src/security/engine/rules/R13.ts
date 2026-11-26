/** R13 버전을 고정하지 않은 패키지 즉시 실행(npx·uvx·bunx·pipx run·pnpm dlx). */
import type { Rule } from '../types';
import { commandTokens, matchLines } from './util';

const RUNNERS: Record<string, string[]> = {
  npx: [],
  uvx: [],
  bunx: [],
  pipx: ['run'],
  pnpm: ['dlx'],
  yarn: ['dlx'],
};

/** `name@1.2.3`·`@scope/name@1.2.3`·`name==1.2.3`는 고정, `@latest`·무버전은 미고정. */
function isPinned(spec: string): boolean {
  const body = spec.startsWith('@') ? spec.slice(1) : spec;
  if (/==\S/.test(body)) return true;
  const at = body.indexOf('@');
  return (
    at > 0 &&
    body.length > at + 1 &&
    !/^(?:latest|next|\*)$/.test(body.slice(at + 1))
  );
}

function hasUnpinned(tokens: string[]): boolean {
  const i = tokens.findIndex((t) => Object.hasOwn(RUNNERS, t));
  if (i < 0) return false;
  const sub = RUNNERS[tokens[i]];
  if (sub.length && tokens[i + 1] !== sub[0]) return false;
  // ponytail: `--from spec` 같은 값 있는 플래그는 값을 패키지로 오인할 수 있음
  const pkg = tokens.slice(i + 1 + sub.length).find((t) => !t.startsWith('-'));
  return pkg !== undefined && !isPinned(pkg);
}

export const R13: Rule = {
  id: 'R13_UNPINNED_PACKAGE_EXEC',
  severity: 'CAUTION',
  titleKo: '버전 미고정 패키지 실행',
  descriptionKo:
    'npx·uvx 등으로 버전을 고정하지 않은 패키지를 받아 즉시 실행합니다. 패키지가 탈취·교체되면 다음 실행부터 악성 코드가 돌 수 있습니다.',
  regions: ['shell', 'mcp'],
  match: (ctx) => matchLines(ctx, (t) => commandTokens(t).some(hasUnpinned)),
};
