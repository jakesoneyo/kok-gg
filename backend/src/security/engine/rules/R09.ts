/** R09 셸 프로필(.zshrc·.bashrc 등) 변조. */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

const PROFILE = String.raw`(?:~|\$\{?HOME\}?)\/(?:\.(?:zshrc|bashrc|bash_profile|zprofile|profile|zshenv|zlogin)|\.config\/fish\/config\.fish)\b`;
const PATTERNS = [
  new RegExp(String.raw`>>?\s*${PROFILE}`),
  new RegExp(String.raw`\btee\s+(?:-a\s+)?${PROFILE}`),
  new RegExp(String.raw`\bsed\s+-\w*i\b[^|\n]*${PROFILE}`),
];

export const R09: Rule = {
  id: 'R09_SHELL_PROFILE_WRITE',
  severity: 'DANGER',
  titleKo: '셸 프로필 변조',
  descriptionKo:
    '.zshrc·.bashrc 같은 셸 시작 파일에 내용을 써 넣습니다. 터미널을 열 때마다 코드가 실행되도록 남기는 영속화 수법입니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => anyRe(PATTERNS, t)),
};
