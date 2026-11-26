/** R04 외부로 데이터를 보내는 네트워크 호출(POST·업로드·소켓). */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

const PATTERNS = [
  /\bcurl\b[^|;&\n]*\s(?:-d|--data(?:-[a-z]+)?|-F|--form|-T|--upload-file|-X\s*(?:POST|PUT|PATCH|DELETE)|--request\s+(?:POST|PUT|PATCH|DELETE))(?![\w-])/,
  /\bwget\b[^|;&\n]*\s--(?:post-data|post-file|method=(?:POST|PUT|PATCH))\b/,
  /\b(?:nc|ncat|netcat)\s+(?:-\S+\s+)*[\w.-]+\s+\d+\b/,
  /\/dev\/tcp\//,
  /\b(?:requests|httpx|session|axios|http)\.(?:post|put|patch)\s*\(/,
  /\bfetch\s*\([^)]*method\s*:\s*['"](?:POST|PUT|PATCH)['"]/i,
];

export const R04: Rule = {
  id: 'R04_NETWORK_SEND',
  severity: 'CAUTION',
  titleKo: '외부 데이터 전송',
  descriptionKo:
    '외부 서버로 데이터를 전송하는 호출(POST·업로드·소켓)이 있습니다. 어떤 데이터가 나가는지 확인이 필요합니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => anyRe(PATTERNS, t)),
};
