/**
 * 규칙 적용 전 텍스트 정규화: 역슬래시 줄 잇기(시작 줄 보존), 전체 줄 주석 제거(셔뱅 제외),
 * 줄 4000자 겹침 창 분할(ReDoS 상한).
 */
import type { Line, Region } from './types';

export const MAX_LINE_LENGTH = 4000;
// 창 사이를 겹쳐서 경계에 걸친 패턴(최대 500자)도 한 창 안에 온전히 들어오게 한다
const WINDOW_STEP = 3500;

const SHELLISH: ReadonlySet<Region> = new Set(['shell', 'script']);

/**
 * 왜 줄 잇기 먼저: `curl x \` + `| bash` 처럼 쪼갠 명령을 한 줄로 합쳐야 R01이 걸린다.
 * 주석 줄의 끝 `\`는 셸에서 이어지지 않으므로 주석 판정이 먼저다.
 * 4000자를 넘는 줄은 앞부분만 보면 공백 패딩 뒤의 명령이 숨으므로 겹치는 창으로 나눠 모두 반환한다
 * (같은 줄 번호, 첫 창만 truncated=true → R06 초장문 신호는 유지). 규칙은 창 단위라 ReDoS 상한은 그대로.
 * @returns 논리 줄 목록(긴 줄은 창마다 한 항목)
 */
export function preprocess(text: string, region: Region): Line[] {
  const physical = text.split(/\r?\n/);
  const shellish = SHELLISH.has(region);
  const out: Line[] = [];
  for (let i = 0; i < physical.length; i++) {
    const cur = physical[i];
    if (shellish && isComment(cur)) continue;
    const start = i + 1;
    // 조각 배열로 모아 한 번에 합친다(역슬래시 폭탄에서 O(n²) 문자열 복사 방지)
    const parts = [cur];
    let last = cur;
    while (shellish && last.endsWith('\\') && i + 1 < physical.length) {
      i++;
      last = physical[i];
      parts[parts.length - 1] = parts[parts.length - 1].slice(0, -1);
      parts.push(last.trimStart());
    }
    const joined =
      parts.length === 1
        ? cur
        : parts.map((p, k) => (k ? ` ${p}` : p)).join('');
    for (let at = 0; ; at += WINDOW_STEP) {
      out.push({
        line: start,
        text: joined.slice(at, at + MAX_LINE_LENGTH),
        truncated: at === 0 && joined.length > MAX_LINE_LENGTH,
      });
      if (at + MAX_LINE_LENGTH >= joined.length) break;
    }
  }
  return out;
}

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('#') && !t.startsWith('#!');
}
