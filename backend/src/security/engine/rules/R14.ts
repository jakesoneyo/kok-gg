/** R14 마켓플레이스 `command` 소스(임의 명령으로 플러그인을 가져옴). */
import type { Rule } from '../types';
import { matchLines } from './util';

export const R14: Rule = {
  id: 'R14_MARKETPLACE_COMMAND_SOURCE',
  severity: 'CAUTION',
  titleKo: '마켓플레이스 command 소스',
  descriptionKo:
    '플러그인을 임의 명령 실행으로 설치하도록 선언한 마켓플레이스 항목입니다. 설치 시 해당 명령이 사용자 환경에서 실행됩니다.',
  regions: ['marketplace'],
  match: (ctx) => matchLines(ctx, (t) => /^source:command\b/.test(t)),
};
