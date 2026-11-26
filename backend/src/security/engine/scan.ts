/**
 * 검사 오케스트레이터: 추출 → 전처리 → 규칙 매칭 → 복합 규칙 → 지문·집계.
 * 순수 함수(같은 입력 → 같은 결과). LLM은 판정 경로에 없다(프롬프트 인젝션 방어).
 */
import { aggregate } from './aggregate';
import { extractTargets } from './extract';
import { fingerprint } from './fingerprint';
import { preprocess } from './preprocess';
import { R05, R16, RULES } from './rules';
import type {
  Finding,
  RawFinding,
  ScanInput,
  ScanResult,
  Severity,
  Target,
} from './types';
import { RULE_SET_VERSION } from './version';

const EXCERPT_MAX = 200;
// 제어·양방향·제로폭·Tag 문자 제거(표시용). UI는 항상 텍스트 노드로 렌더한다.
const UNSAFE_DISPLAY = new RegExp(
  String.raw`[\u0000-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]`,
  'gu',
);

/** 한 Target에 해당 영역의 규칙을 모두 적용. 바이너리·초과 파일은 R16만. */
export function matchTarget(target: Target): RawFinding[] {
  const lines = preprocess(target.text, target.region);
  const applicable = target.opaque
    ? [R16]
    : RULES.filter((r) => r.regions.includes(target.region));
  const out: RawFinding[] = [];
  for (const rule of applicable) {
    for (const hit of rule.match({ target, lines })) {
      out.push({
        ruleId: rule.id,
        severity: hit.severity ?? rule.severity,
        filePath: target.filePath,
        line: target.fixedLine ?? target.lineOffset + hit.line,
        text: hit.text,
      });
    }
  }
  return out;
}

const RANK: Record<Severity, number> = { CAUTION: 1, DANGER: 2 };

/** 같은 (규칙, 파일, 줄)이 여러 영역(예: shell+mcp, prose+인라인 코드)에서 잡히면 높은 등급 하나로. */
function dedupe(raws: RawFinding[]): RawFinding[] {
  const best = new Map<string, RawFinding>();
  for (const r of raws) {
    const key = `${r.ruleId}\0${r.filePath}\0${r.line}`;
    const prev = best.get(key);
    if (!prev || RANK[r.severity] > RANK[prev.severity]) best.set(key, r);
  }
  return [...best.values()];
}

const sanitize = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .replace(UNSAFE_DISPLAY, '')
    .trim()
    .slice(0, EXCERPT_MAX);

/**
 * @param suppressed 활성 Override의 지문 목록. 해당 Finding은 level 집계에서만 빠진다.
 */
export function scan(
  input: ScanInput,
  suppressed: Iterable<string> = [],
): ScanResult {
  const { targets, notes } = extractTargets(input);
  let raws = dedupe(targets.flatMap(matchTarget));

  // 복합 규칙은 파일 단위로: 서로 다른 파일의 R03·R04는 결합으로 보지 않는다
  const byFile = new Map<string, RawFinding[]>();
  for (const r of raws)
    byFile.set(r.filePath, [...(byFile.get(r.filePath) ?? []), r]);
  const composites = [...byFile.values()]
    .map((fs) => R05.composite(fs))
    .filter((f): f is RawFinding => f !== null);
  raws = dedupe([...raws, ...composites]);

  const skip = new Set(suppressed);
  const findings: Finding[] = raws
    .sort(
      (a, b) =>
        a.filePath.localeCompare(b.filePath) ||
        a.line - b.line ||
        a.ruleId.localeCompare(b.ruleId),
    )
    .map((r) => {
      const fp = fingerprint(r.ruleId, r.filePath, r.text);
      return {
        ruleId: r.ruleId,
        severity: r.severity,
        filePath: r.filePath,
        line: r.line,
        excerpt: sanitize(r.text),
        fingerprint: fp,
        suppressed: skip.has(fp),
      };
    });

  return {
    ruleSetVersion: RULE_SET_VERSION,
    ...aggregate(findings),
    findings,
    notes,
  };
}
