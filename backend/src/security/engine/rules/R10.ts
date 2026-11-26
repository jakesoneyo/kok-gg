/** R10 Claude 설정·권한 변조(settings.json 쓰기, 권한 프롬프트 우회). */
import type { Rule } from '../types';
import { matchLines } from './util';

const SETTINGS =
  /(?:~|\$\{?HOME\}?)?\/?\.claude(?:\/settings(?:\.local)?\.json|\.json)\b/;
// 경로보다 앞에 쓰기 연산이 있어야 한다. `2>`·`&>` 같은 fd 리다이렉트는 제외
const WRITE_OP =
  /(?<![\d&])>>?|\btee\b|\bsed\s+-\w*i\b|\bmv\b|\bcp\b|\binstall\b/;

export const R10: Rule = {
  id: 'R10_CLAUDE_CONFIG_TAMPER',
  severity: 'DANGER',
  titleKo: 'Claude 설정·권한 변조',
  descriptionKo:
    'Claude 설정 파일에 쓰거나 권한 확인을 끄는 옵션(--dangerously-skip-permissions, bypassPermissions)을 사용합니다. 이후 모든 작업이 승인 없이 실행될 수 있습니다.',
  regions: ['shell', 'script', 'mcp'],
  match: (ctx) =>
    matchLines(ctx, (t) => {
      if (/--dangerously-skip-permissions\b/.test(t)) return true;
      if (/defaultMode\W{0,4}bypassPermissions/.test(t)) return true;
      const m = SETTINGS.exec(t);
      return m != null && WRITE_OP.test(t.slice(0, m.index));
    }),
};
