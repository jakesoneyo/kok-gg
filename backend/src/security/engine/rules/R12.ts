/** R12 MCP 서버 연결 선언(외부 서버·프로세스를 에이전트에 연결). */
import type { Rule } from '../types';
import { matchLines } from './util';

export const R12: Rule = {
  id: 'R12_MCP_EXTERNAL_SERVER',
  severity: 'CAUTION',
  titleKo: '외부 MCP 서버 연결',
  descriptionKo:
    'MCP 서버를 연결합니다. 서버가 에이전트의 도구·컨텍스트를 제공하므로 출처 확인이 필요합니다(원격 URL이면 발췌에 호스트가 표시됩니다).',
  regions: ['mcp'],
  // ponytail: 서버 존재 자체가 신호. 비루프백 호스트 구분은 추출기가 발췌 텍스트에 URL을 그대로 넣는 것으로 대체
  match: (ctx) => matchLines(ctx, (t) => t.trim().length > 0),
};
