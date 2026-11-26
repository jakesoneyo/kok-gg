/** R16 분석 불가 실행파일(바이너리·크기 상한 초과). 내용을 못 보므로 신호로 노출. */
import type { Rule } from '../types';

export const R16: Rule = {
  id: 'R16_OPAQUE_BINARY',
  severity: 'CAUTION',
  titleKo: '분석 불가 실행파일',
  descriptionKo:
    '바이너리이거나 크기 상한을 넘어 내용을 검사하지 못한 실행 파일입니다. 안전하다는 뜻이 아니라 확인하지 못했다는 뜻입니다.',
  regions: ['script'],
  match: ({ target }) =>
    target.opaque
      ? [{ line: 1, text: `[분석 불가 파일] ${target.filePath}` }]
      : [],
};
