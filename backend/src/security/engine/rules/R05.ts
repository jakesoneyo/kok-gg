/** R05 비밀 읽기 + 외부 전송 결합(유출). 줄 단위 토큰 전송 + 같은 파일 R03·R04 복합. */
import type { RawFinding, Rule } from '../types';
import { matchLines } from './util';

const TOKEN_IN_CURL =
  /\b(?:curl|wget)\b[^\n]*\$\{?(?:GITHUB_TOKEN|GH_TOKEN|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|ANTHROPIC_API_KEY|OPENAI_API_KEY|NPM_TOKEN)\b/;

export const R05: Rule & {
  /** 같은 파일의 Finding 목록 → 복합 Finding(R03·R04가 모두 있어야, 없으면 null). */
  composite(fileFindings: readonly RawFinding[]): RawFinding | null;
} = {
  id: 'R05_SECRET_EXFIL',
  severity: 'DANGER',
  titleKo: '비밀 정보 유출 의심',
  descriptionKo:
    '같은 파일에서 비밀을 읽고 외부로 전송하거나, 전송 명령의 인자에 토큰 환경변수를 실어 보냅니다. 자격증명 유출 패턴입니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => TOKEN_IN_CURL.test(t)),
  composite(fileFindings) {
    const secret = fileFindings.find((f) => f.ruleId === 'R03_SECRET_READ');
    const send = fileFindings.find((f) => f.ruleId === 'R04_NETWORK_SEND');
    if (!secret || !send) return null;
    // ponytail: 지문 기준 줄은 첫 R03 히트. 파일에 R03가 여러 개면 가장 앞 줄이 바뀔 때 지문이 바뀜
    return { ...secret, ruleId: 'R05_SECRET_EXFIL', severity: 'DANGER' };
  },
};
