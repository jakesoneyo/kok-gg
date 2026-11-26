// 요약이 인용한 설치 명령에 같은 규칙 엔진(shell 영역)을 적용해 경고용 규칙 id를 얻는다.
import { matchTarget } from './engine';

/** 같은 규칙이 여러 번 걸려도 id는 한 번만. 명령 문자열은 신뢰할 수 없는 텍스트라 엔진은 정적 검사만 한다. */
export function commandWarnings(command: string): string[] {
  const hits = matchTarget({
    region: 'shell',
    filePath: 'install-command',
    text: command,
    lineOffset: 0,
  });
  return [...new Set(hits.map((h) => h.ruleId))];
}
