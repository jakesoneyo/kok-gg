/** R06 난독화된 실행(base64 → sh/eval) 및 거대 base64·초장문 줄. */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

const DANGER = [
  /\bbase64\s+(?:-d|--decode|-D)\b[^|\n]*\|\s*(?:sudo\s+)?(?:(?:ba|z|da)?sh|python3?|node|perl)\b/,
  /\beval\b[^\n]*\bbase64\s+(?:-d|--decode|-D)\b/,
  /\b(?:eval|Function)\s*\(\s*(?:atob|Buffer\.from)\s*\(/,
  /\b(?:exec|eval)\s*\(\s*(?:__import__\(['"]base64['"]\)\.|base64\.)?b64decode\s*\(/,
];
const BASE64_BLOB = /[A-Za-z0-9+/]{200,}={0,2}/;

export const R06: Rule = {
  id: 'R06_OBFUSCATED_EXEC',
  severity: 'DANGER',
  severities: ['CAUTION', 'DANGER'],
  titleKo: '난독화된 코드 실행',
  descriptionKo:
    '인코딩(base64 등)한 코드를 풀어 곧바로 실행합니다. 읽는 사람에게 내용을 숨기려는 전형적 패턴입니다(주의: 200자 이상 인코딩 덩어리·4000자 이상 줄).',
  regions: ['shell', 'script'],
  match: (ctx) =>
    matchLines(ctx, (t, l) => {
      if (anyRe(DANGER, t)) return 'DANGER';
      return l.truncated || BASE64_BLOB.test(t) ? 'CAUTION' : false;
    }),
};
