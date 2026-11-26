/**
 * 등급 집계. 위험 신호 1개라도 있으면 DANGER, 아니면 주의 신호 있으면 CAUTION, 아니면 SAFE.
 * 억제(Override)된 Finding은 level에서만 제외 — rawLevel은 엔진 판정 그대로 보존.
 */
import type { RiskLevel } from '@prisma/client';
import type { Finding } from './types';

const level = (fs: readonly Pick<Finding, 'severity'>[]): RiskLevel =>
  fs.some((f) => f.severity === 'DANGER')
    ? 'DANGER'
    : fs.some((f) => f.severity === 'CAUTION')
      ? 'CAUTION'
      : 'SAFE';

export function aggregate(findings: readonly Finding[]): {
  rawLevel: RiskLevel;
  level: RiskLevel;
} {
  return {
    rawLevel: level(findings),
    level: level(findings.filter((f) => !f.suppressed)),
  };
}
