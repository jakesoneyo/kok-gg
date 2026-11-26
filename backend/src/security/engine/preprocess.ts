/**
 * 규칙 적용 전 텍스트 정규화: 역슬래시 줄 잇기(시작 줄 보존), 전체 줄 주석 제거(셔뱅 제외),
 * 줄 4000자 절단(ReDoS 상한).
 */
import type { Line, Region } from './types';

export const MAX_LINE_LENGTH = 4000;

const SHELLISH: ReadonlySet<Region> = new Set(['shell', 'script']);

/**
 * 왜 줄 잇기 먼저: `curl x \` + `| bash` 처럼 쪼갠 명령을 한 줄로 합쳐야 R01이 걸린다.
 * 주석 줄의 끝 `\`는 셸에서 이어지지 않으므로 주석 판정이 먼저다.
 */
export function preprocess(text: string, region: Region): Line[] {
  const physical = text.split(/\r?\n/);
  const shellish = SHELLISH.has(region);
  const out: Line[] = [];
  for (let i = 0; i < physical.length; i++) {
    let cur = physical[i];
    if (shellish && isComment(cur)) continue;
    const start = i + 1;
    let last = cur;
    let overflow = false;
    while (shellish && last.endsWith('\\') && i + 1 < physical.length) {
      i++;
      last = physical[i];
      // 상한을 넘으면 더 붙이지 않고 줄만 소비(역슬래시 폭탄에서 O(n²) 문자열 복사 방지)
      if (cur.length <= MAX_LINE_LENGTH)
        cur = `${cur.slice(0, -1)} ${last.trimStart()}`;
      else overflow = true;
    }
    out.push({
      line: start,
      text: cur.slice(0, MAX_LINE_LENGTH),
      truncated: overflow || cur.length > MAX_LINE_LENGTH,
    });
  }
  return out;
}

function isComment(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('#') && !t.startsWith('#!');
}
