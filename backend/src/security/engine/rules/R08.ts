/** R08 권한 상승·영속화(sudo, setuid, cron, launchd, systemd). */
import type { Rule } from '../types';
import { anyRe, matchLines } from './util';

const PATTERNS = [
  /\bsudo\s+\S/,
  /\bchmod\s+(?:-\S+\s+)*(?:0?777|[ugoa]*\+s|[ugoa]*\+rwx)(?![\w-])/,
  />>?\s*\/etc\//,
  /\btee\s+(?:-a\s+)?\/etc\//,
  /\bcrontab\s+(?:-\s|-$|-e\b)/,
  /\blaunchctl\s+(?:load|bootstrap|enable)\b/,
  /\/Library\/Launch(?:Agents|Daemons)\b/,
  /\bsystemctl\s+(?:--user\s+)?enable\b/,
];

export const R08: Rule = {
  id: 'R08_PRIVILEGE_PERSIST',
  severity: 'DANGER',
  titleKo: '권한 상승·상시 실행 등록',
  descriptionKo:
    '관리자 권한(sudo)·setuid 설정, 시스템 설정 파일 쓰기, cron·launchd·systemd 등록으로 컴퓨터에 상시 실행 코드를 남깁니다.',
  regions: ['shell', 'script'],
  match: (ctx) => matchLines(ctx, (t) => anyRe(PATTERNS, t)),
};
