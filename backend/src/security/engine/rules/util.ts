/**
 * 규칙 공용 헬퍼. 규칙은 "줄 → 히트" 변환이 대부분이라 그 보일러플레이트만 모은다.
 */
import type { Hit, Line, RuleContext, Severity } from '../types';

/** 줄마다 test를 돌려 true(기본 등급) 또는 Severity(등급 지정)이면 히트. */
export function matchLines(
  ctx: RuleContext,
  test: (text: string, line: Line) => boolean | Severity,
): Hit[] {
  const hits: Hit[] = [];
  for (const l of ctx.lines) {
    const r = test(l.text, l);
    if (r)
      hits.push({
        line: l.line,
        text: l.text,
        severity: r === true ? undefined : r,
      });
  }
  return hits;
}

export const anyRe = (res: readonly RegExp[], text: string): boolean =>
  res.some((re) => re.test(text));

/** 파이프·`;`·`&&`·`||`로 나눈 명령 조각별 토큰(따옴표·괄호 껍질 제거). */
export function commandTokens(line: string): string[][] {
  return line
    .split(/\s*(?:&&|\|\||[;|])\s*/)
    .map((seg) =>
      seg
        .split(/\s+/)
        .map((t) => t.replace(/^["'`(]+|["'`);]+$/g, ''))
        .filter(Boolean),
    )
    .filter((t) => t.length > 0);
}
