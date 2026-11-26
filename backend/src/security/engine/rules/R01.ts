/** R01 원격 스크립트를 내려받아 바로 실행(curl | bash 류). */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

const INTERP = String.raw`(?:(?:ba|z|da|k)?sh|python3?|node|perl|ruby)\b`;
const PATTERNS = [
  new RegExp(String.raw`\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?${INTERP}`),
  /\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^|\n]*\|\s*(?:iex|Invoke-Expression)\b/i,
  /\b(?:ba|z)?sh\s+<\(\s*(?:curl|wget)\b/,
  /\b(?:ba|z)?sh\s+-c\s+["']?\$\(\s*(?:curl|wget)\b/,
  /\beval\s+["']?\$\(\s*(?:curl|wget)\b/,
];

export const R01: Rule = {
  id: 'R01_REMOTE_PIPE_EXEC',
  severity: 'DANGER',
  titleKo: '원격 스크립트 즉시 실행',
  descriptionKo:
    '인터넷에서 받은 스크립트를 내용 확인 없이 바로 셸에 넘겨 실행합니다(curl | bash 등). 서버가 바뀌면 임의 코드가 실행됩니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => anyRe(PATTERNS, t)),
};
