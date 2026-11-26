/** 규칙 레지스트리. 메타(제목·설명·영역)의 단일 원천 — API /security/rules가 그대로 노출한다. */
import type { Rule, RuleMeta } from '../types';
import { R01 } from './R01';
import { R02 } from './R02';
import { R03 } from './R03';
import { R04 } from './R04';
import { R05 } from './R05';
import { R06 } from './R06';
import { R07 } from './R07';
import { R08 } from './R08';
import { R09 } from './R09';
import { R10 } from './R10';
import { R11 } from './R11';
import { R12 } from './R12';
import { R13 } from './R13';
import { R14 } from './R14';
import { R15 } from './R15';
import { R16 } from './R16';

export { R05, R16 };
export const RULES: readonly Rule[] = [
  R01,
  R02,
  R03,
  R04,
  R05,
  R06,
  R07,
  R08,
  R09,
  R10,
  R11,
  R12,
  R13,
  R14,
  R15,
  R16,
];

/** 함수(match)를 뺀 직렬화 가능한 메타. */
export const RULE_METAS: readonly RuleMeta[] = RULES.map(
  ({ id, severity, titleKo, descriptionKo, regions, severities }) => ({
    id,
    severity,
    titleKo,
    descriptionKo,
    regions,
    severities: severities ?? [severity],
  }),
);
