/** R11 SKILL.md allowed-tools에 범위 제한 없는 Bash(또는 전체 허용). */
import type { Hit, Rule } from '../types';

const UNRESTRICTED = /^(?:\*|Bash(?:\((?:\*|:\*|\*:\*)?\))?)$/;

/** 쉼표·공백으로 나누되 괄호 안(`Bash(git status:*)`)은 쪼개지 않는다. */
export function splitTools(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value.replace(/[[\]"']/g, '')) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export const R11: Rule = {
  id: 'R11_SKILL_UNRESTRICTED_TOOLS',
  severity: 'CAUTION',
  titleKo: '제한 없는 도구 권한',
  descriptionKo:
    '스킬이 범위 지정 없이 Bash(모든 셸 명령) 또는 모든 도구를 사용하도록 선언합니다. Bash(git status:*)처럼 명령을 좁히는 것이 안전합니다.',
  regions: ['skill-meta'],
  match({ lines }) {
    const hits: Hit[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^allowed-tools\s*:(.*)$/.exec(lines[i].text);
      if (!m) continue;
      let value = m[1];
      // YAML 리스트 형태(`- Bash`) 이어붙이기
      let j = i + 1;
      while (j < lines.length && /^\s*-\s+/.test(lines[j].text)) {
        value += ` ${lines[j].text.replace(/^\s*-\s+/, '')}`;
        j++;
      }
      if (splitTools(value).some((t) => UNRESTRICTED.test(t)))
        hits.push({ line: lines[i].line, text: lines[i].text });
    }
    return hits;
  },
};
