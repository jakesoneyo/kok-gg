/** R07 동적 평가(eval·sh -c "$VAR"·new Function 등). 알려진 init 관용구는 허용. */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

// 셸 초기화 도구의 표준 `eval "$(tool init)"` 관용구
const SAFE_TOOLS =
  'direnv|pyenv|rbenv|nodenv|fnm|starship|zoxide|mise|ssh-agent|brew|conda|pipenv|thefuck|register-python-argcomplete';
const PATTERNS = [
  new RegExp(String.raw`\beval\s+["']?(?:\$\(|\x60)(?!\s*(?:${SAFE_TOOLS})\b)`),
  /\beval\s+["']?\$[A-Za-z_{0-9]/,
  /\b(?:ba|z)?sh\s+-c\s+["']?\$[A-Za-z_{]/,
  /\b(?:exec|eval)\s*\(\s*[A-Za-z_][\w.]*\s*\)/,
  /\bnew\s+Function\s*\(/,
  /\bexec(?:Sync)?\s*\(\s*`[^`]*\$\{/,
];

export const R07: Rule = {
  id: 'R07_DYNAMIC_EVAL',
  severity: 'CAUTION',
  titleKo: '동적 코드 평가',
  descriptionKo:
    '변수나 명령 치환 결과를 코드로 평가(eval 등)합니다. 입력에 따라 의도하지 않은 명령이 실행될 수 있습니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => anyRe(PATTERNS, t)),
};
