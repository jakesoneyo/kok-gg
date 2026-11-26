/** R03 비밀 파일(SSH 키·클라우드 자격증명·.env 등) 읽기. */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

const HOME = String.raw`(?:~|\$\{?HOME\}?|\/(?:Users|home)\/[^/\s]+|%USERPROFILE%)`;
const DANGER = [
  new RegExp(
    String.raw`${HOME}[\\/]\.(?:ssh(?:[\\/]|\b)|aws[\\/](?:credentials|config)|netrc\b|config[\\/]gh[\\/]hosts\.yml|kube[\\/]config|docker[\\/]config\.json|claude[\\/]\.credentials\.json|gnupg\b)`,
  ),
  /\bid_(?:rsa|ed25519|ecdsa)\b(?!\.pub)/,
  /\bsecurity\s+find-(?:generic|internet)-password\b/,
  /\/etc\/shadow\b/,
];
// .env 자체를 읽는 명령. `.env.example` 같은 견본은 뒤따르는 `.`/단어 문자로 걸러낸다.
const CAUTION = [
  /(?:\b(?:cat|source|less|more|head|tail|cp|grep|dotenv)\s+|^\s*\.\s+|<\s*)(?:\S*\/)?\.env(?:\.(?:local|production|prod|development|dev))?(?![\w.-])/,
];

export const R03: Rule = {
  id: 'R03_SECRET_READ',
  severity: 'DANGER',
  severities: ['CAUTION', 'DANGER'],
  titleKo: '비밀 파일 읽기',
  descriptionKo:
    'SSH 키, 클라우드 자격증명, 토큰 저장소 같은 비밀 파일(주의: .env)을 읽습니다. 단독으로는 정상 용도일 수 있으나 외부 전송과 결합되면 유출입니다.',
  regions: ['shell', 'script', 'prose'],
  match: (ctx) =>
    matchLines(ctx, (t) => {
      // 본문(prose)의 언급은 실행이 아니므로 최대 주의
      if (anyRe(DANGER, t))
        return ctx.target.region === 'prose' ? 'CAUTION' : 'DANGER';
      return anyRe(CAUTION, t) ? 'CAUTION' : false;
    }),
};
