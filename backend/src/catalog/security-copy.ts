// 보안 화면 문구·규칙 이름 조회. 규칙 메타의 단일 원천은 C2의 security/engine이다 — 병합 후 이 파일은 그 메타를 import하도록 바꾼다.

export const DISCLAIMER_KO =
  '규칙 기반 위험 신호 탐지 결과이며 안전을 보증하지 않습니다. 자연어 지시의 의도 판단 등 규칙으로 잡히지 않는 위험이 있을 수 있으니 설치 전 원문을 직접 확인하세요.';

/** ponytail: C2 병합 전 임시 — 규칙 메타(titleKo)가 들어오면 id → titleKo 조회로 교체. */
export function ruleTitleKo(ruleId: string): string {
  return ruleId;
}
