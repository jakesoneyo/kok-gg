/**
 * 보안 규칙 엔진 공용 타입. 엔진은 순수 모듈(IO 없음) — 파일 내용은 호출 측이 가져와 넘긴다.
 */
import type { RiskLevel } from '@prisma/client';

/** Finding이 가질 수 있는 등급(SAFE는 신호가 없다는 뜻이라 제외). */
export type Severity = Exclude<RiskLevel, 'SAFE'>;

export type Region =
  'shell' | 'script' | 'skill-meta' | 'prose' | 'mcp' | 'marketplace';

export interface ScanFile {
  /** 저장소 루트 기준 경로(퍼머링크에 그대로 쓰임). */
  path: string;
  content: string;
  /** 크기 상한 초과로 내용을 못 받은 파일 → 분석 불가(R16). */
  truncated?: boolean;
}

export interface ScanInput {
  files: readonly ScanFile[];
  /** 플러그인/스킬 루트(저장소 기준 디렉터리, 기본 ''). `${CLAUDE_PLUGIN_ROOT}` 해석 기준. */
  root?: string;
}

/** 규칙이 검사하는 텍스트 조각 하나. text의 k번째 줄(1-base)의 원문 줄 번호 = lineOffset + k. */
export interface Target {
  region: Region;
  filePath: string;
  text: string;
  lineOffset: number;
  /** JSON 이스케이프 문자열처럼 줄 매핑이 불가능하면 모든 히트를 이 줄로 보고. */
  fixedLine?: number;
  /** 바이너리·상한 초과 → R16만 적용. */
  opaque?: boolean;
}

/** 전처리된 논리 줄. line은 target.text 안의 시작 줄(1-base). */
export interface Line {
  line: number;
  text: string;
  /** 4000자 초과로 잘렸음(R06 초장문 줄 신호). */
  truncated: boolean;
}

export interface Hit {
  line: number;
  /** 지문·발췌의 원료가 되는 매칭 줄. */
  text: string;
  /** 규칙 기본 등급과 다를 때만(R03·R06·R15 등). */
  severity?: Severity;
}

export interface RuleMeta {
  id: string;
  /** 규칙이 낼 수 있는 최고 등급. */
  severity: Severity;
  titleKo: string;
  descriptionKo: string;
  regions: readonly Region[];
  /** 규칙이 낼 수 있는 등급 전부. 생략 시 [severity]. 입력에 따라 등급이 갈리는 규칙(R03·R06·R15)만 명시. */
  severities?: readonly Severity[];
}

export interface RuleContext {
  target: Target;
  lines: readonly Line[];
}

export interface Rule extends RuleMeta {
  match(ctx: RuleContext): Hit[];
}

/** 매칭 직후의 내부 표현(원문 줄 포함). 외부엔 Finding으로 변환해 노출. */
export interface RawFinding {
  ruleId: string;
  severity: Severity;
  filePath: string;
  line: number;
  text: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  filePath: string;
  line: number;
  excerpt: string;
  fingerprint: string;
  suppressed: boolean;
}

/** 추출 중 건너뛴 것의 기록("무시하되 기록"). */
export interface ExtractNote {
  path: string;
  reason: 'ESCAPES_ROOT' | 'MISSING_FILE' | 'PARSE_ERROR';
  ref?: string;
}

export interface ScanResult {
  ruleSetVersion: string;
  rawLevel: RiskLevel;
  level: RiskLevel;
  findings: Finding[];
  notes: ExtractNote[];
}
