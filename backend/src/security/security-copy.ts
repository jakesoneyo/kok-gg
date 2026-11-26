// 보안 화면 문구와 규칙 이름 조회. 규칙 메타(titleKo 등)의 원천은 engine의 RULE_METAS — 문구를 두 곳에 두지 않는다.
import { RULE_METAS } from './engine';

export const DISCLAIMER_KO =
  '규칙 기반 위험 신호 탐지 결과이며 안전을 보증하지 않습니다. 자연어 지시의 의도 판단 등 규칙으로 잡히지 않는 위험이 있을 수 있으니 설치 전 원문을 직접 확인하세요.';

/** 방법론 페이지에 공개하는 알려진 상한(ARCHITECTURE 6.3). */
export const KNOWN_LIMITS_KO = [
  '참조 깊이는 1단계입니다. 스크립트가 다시 불러오는 파일은 추적하지 않습니다.',
  '.claude/settings.json 훅이 .claude 폴더 밖의 스크립트를 부르면 그 스크립트는 검사하지 않습니다.',
  '크기 상한을 넘었거나 형식이 깨져 읽지 못한 설정·스킬 파일은 안전으로 표시하지 않고 "분석 불가 파일" 주의 신호로 남깁니다.',
  '문자열 조립이나 변수 간접 참조로 만든 명령은 탐지하지 못합니다.',
  'SKILL.md 본문의 자연어 지시(예: "~를 업로드하라")의 의도는 판단하지 않습니다.',
];

const TITLES = new Map(RULE_METAS.map((m) => [m.id, m.titleKo]));

/** 모르는 id(규칙이 삭제된 옛 검사)는 id 그대로 보여 화면이 깨지지 않게 한다. */
export const ruleTitleKo = (ruleId: string): string =>
  TITLES.get(ruleId) ?? ruleId;
