/**
 * 파일 목록에서 규칙이 검사할 텍스트 조각(Target)을 뽑는다(ARCHITECTURE 6.2).
 * 훅·MCP·모니터·마켓플레이스 JSON, SKILL.md(프런트매터·코드블록·본문), bin/·스킬 스크립트,
 * `${CLAUDE_PLUGIN_ROOT}/…` 참조 스크립트(깊이 1)를 다룬다. IO 없음 — 내용은 호출 측이 준다.
 */
import type { ExtractNote, Region, ScanFile, ScanInput, Target } from './types';

const JSON_NAMES = new Set([
  'hooks.json',
  'plugin.json',
  'marketplace.json',
  '.mcp.json',
  'monitors.json',
]);
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * 검사 대상 설정 JSON인가. `settings.json`은 `.claude/` 루트(HOOK 항목)에서만 설정으로 본다 —
 * 그 밖의 settings.json은 훅 정의 파일이 아니다. scan-files(파일 선택)와 같은 기준을 쓰려고 공개한다.
 * @param rel 항목 루트 기준 상대 경로
 * @param root 항목 루트(저장소 기준 디렉터리)
 */
export function isConfigJson(rel: string, root: string): boolean {
  if (JSON_NAMES.has(baseName(rel))) return true;
  // 심층 방어: 호출부가 root를 '.claude'로 넘기지 않아도 경로 자체로 프로젝트 훅 설정을 알아본다(놓치면 SAFE로 샌다)
  if (rel === '.claude/settings.json' || rel.endsWith('/.claude/settings.json'))
    return true;
  return rel === 'settings.json' && baseName(root) === '.claude';
}
const SCRIPT_EXT = /\.(?:sh|bash|zsh|py|js|ts|mjs|cjs)$/;
const NUL_SCAN_BYTES = 8192;
const REF_RE = /\$\{?CLAUDE_PLUGIN_ROOT\}?\/([^\s"'`;|&)<>]+)/g;
// 프로젝트 훅(.claude/settings.json)은 `$CLAUDE_PROJECT_DIR/…` 또는 저장소 기준 `.claude/…`로 스크립트를 부른다
const PROJECT_REF_RE =
  /(?:\$\{?CLAUDE_PROJECT_DIR\}?\/|(?<![\w./-])(?:\.\/)?(?=\.claude\/))([^\s"'`;|&)<>]+)/g;

const SHELL_LANGS = new Set([
  '',
  'sh',
  'bash',
  'shell',
  'zsh',
  'console',
  'shell-session',
  'powershell',
  'pwsh',
]);
const SCRIPT_LANGS = new Set([
  'py',
  'python',
  'js',
  'javascript',
  'ts',
  'typescript',
  'node',
  'mjs',
]);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isOpaque = (f: ScanFile) =>
  !!f.truncated || f.content.slice(0, NUL_SCAN_BYTES).includes('\0');

/**
 * JSON 안 문자열의 줄 번호를 원문에서 순차 검색으로 찾는다(JSON 위치 파서 의존성 불필요).
 * 같은 문자열이 반복돼도 커서가 앞으로만 가므로 등장 순서대로 매핑된다. 못 찾으면 1행.
 */
function makeLocator(raw: string): (value: string) => number {
  let cursor = 0;
  return (value) => {
    const needle = JSON.stringify(value).slice(1, -1);
    let idx = raw.indexOf(needle, cursor);
    if (idx < 0) idx = raw.indexOf(needle);
    if (idx < 0) return 1;
    cursor = idx + needle.length;
    let line = 1;
    for (
      let i = raw.indexOf('\n');
      i >= 0 && i < idx;
      i = raw.indexOf('\n', i + 1)
    )
      line++;
    return line;
  };
}

export function extractTargets(input: ScanInput): {
  targets: Target[];
  notes: ExtractNote[];
} {
  const root = (input.root ?? '').replace(/^\/+|\/+$/g, '');
  const targets: Target[] = [];
  const notes: ExtractNote[] = [];
  const byRel = new Map<string, ScanFile>();
  for (const f of input.files) {
    if (!root) byRel.set(f.path, f);
    else if (f.path.startsWith(`${root}/`))
      byRel.set(f.path.slice(root.length + 1), f);
  }

  const scriptsAdded = new Set<string>();
  const addScript = (f: ScanFile) => {
    if (scriptsAdded.has(f.path)) return;
    scriptsAdded.add(f.path);
    targets.push({
      region: 'script',
      filePath: f.path,
      text: f.content,
      lineOffset: 0,
      opaque: isOpaque(f) || undefined,
    });
  };

  const addOpaque = (f: ScanFile) => {
    if (scriptsAdded.has(f.path)) return;
    scriptsAdded.add(f.path);
    targets.push({
      region: 'script',
      filePath: f.path,
      text: '',
      lineOffset: 0,
      opaque: true,
    });
  };

  /** 플러그인 루트 기준 상대 경로 정규화. 루트 탈출은 따라가지 않고 기록만. */
  const resolveRef = (ref: string, from: string): ScanFile | null => {
    const stack: string[] = [];
    for (const part of ref.split('/')) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (!stack.pop()) {
          notes.push({ path: from, reason: 'ESCAPES_ROOT', ref });
          return null;
        }
      } else stack.push(part);
    }
    const file = byRel.get(stack.join('/'));
    if (!file) notes.push({ path: from, reason: 'MISSING_FILE', ref });
    return file ?? null;
  };

  const followRefs = (command: string, from: string) => {
    for (const m of command.matchAll(REF_RE)) {
      const f = resolveRef(m[1], from);
      if (f) addScript(f);
    }
    for (const m of command.matchAll(PROJECT_REF_RE)) {
      // 저장소 기준 경로 → 항목 루트 기준. 루트 밖 참조는 이 항목의 파일이 아니라 따라가지 않는다
      if (root && !m[1].startsWith(`${root}/`)) continue;
      const rel = root ? m[1].slice(root.length + 1) : m[1];
      const f = resolveRef(rel, from);
      if (f) addScript(f);
    }
  };

  const jsonDone = new Set<string>();
  const processJson = (rel: string, file: ScanFile) => {
    if (jsonDone.has(file.path)) return;
    jsonDone.add(file.path);
    let doc: unknown;
    try {
      if (isOpaque(file)) throw new Error('opaque');
      // 선행 BOM은 JSON.parse가 거부한다 — 그대로 두면 파싱 실패가 우회 수단이 된다
      doc = JSON.parse(file.content.replace(/^\uFEFF/, ''));
    } catch {
      // fail-closed: 읽지 못한 설정 파일은 R16(분석 불가)으로 남겨 SAFE가 되지 못하게 한다
      notes.push({ path: file.path, reason: 'PARSE_ERROR' });
      addOpaque(file);
      return;
    }
    const locate = makeLocator(file.content);
    const filePath = file.path;
    const push = (region: Region, text: string, line: number) =>
      targets.push({ region, filePath, text, lineOffset: 0, fixedLine: line });
    const commandText = (o: Json) =>
      [o.command, ...(Array.isArray(o.args) ? (o.args as unknown[]) : [])]
        .filter((x): x is string => typeof x === 'string')
        .join(' ');
    const serverObjs = new WeakSet<object>();

    const emitServers = (servers: Json) => {
      for (const [name, srv] of Object.entries(servers)) {
        if (!isObj(srv)) continue;
        serverObjs.add(srv);
        const cmd = typeof srv.command === 'string' ? commandText(srv) : '';
        const url = typeof srv.url === 'string' ? srv.url : '';
        const line = locate(
          typeof srv.command === 'string' ? srv.command : url || name,
        );
        // 원격 서버는 URL(호스트)이 발췌에 그대로 드러나게 한다
        push('mcp', `${name}: ${url || cmd}`, line);
        if (cmd) {
          push('shell', cmd, line);
          followRefs(cmd, filePath);
        }
      }
    };

    const walk = (node: unknown, key?: string): void => {
      if (typeof node === 'string') {
        // plugin.json의 `hooks: "./hooks/custom.json"` 경로 참조
        if (key === 'hooks') {
          const f = resolveRef(node, filePath);
          if (f) processJson(node, f);
        }
        return;
      }
      if (Array.isArray(node)) return node.forEach((n) => walk(n, key));
      if (!isObj(node)) return;

      if (typeof node.command === 'string' && !serverObjs.has(node)) {
        const text = commandText(node);
        const line = locate(node.command);
        if (node.source === 'command')
          push('marketplace', `source:command ${text}`, line);
        push('shell', text, line);
        followRefs(text, filePath);
      }
      for (const [k, v] of Object.entries(node)) {
        if (k === 'mcpServers' && isObj(v)) emitServers(v);
        walk(v, k);
      }
    };

    // .mcp.json은 `{mcpServers:{…}}`와 서버 맵 직접 형태가 모두 쓰인다
    if (baseName(rel) === '.mcp.json' && isObj(doc) && !('mcpServers' in doc))
      emitServers(doc);
    else walk(doc);
  };

  const skillDirs: string[] = [];
  for (const [rel, file] of byRel) {
    const name = baseName(rel);
    if (isConfigJson(rel, root)) processJson(rel, file);
    else if (name === 'SKILL.md') {
      skillDirs.push(rel.slice(0, Math.max(rel.lastIndexOf('/'), 0)));
      if (isOpaque(file)) addOpaque(file);
      else extractSkillMd(file, targets);
    } else if (rel.startsWith('bin/')) addScript(file);
  }

  for (const [rel, file] of byRel) {
    if (!SCRIPT_EXT.test(rel)) continue;
    // 루트 SKILL.md는 저장소 전체가 아니라 scripts/ 아래만 스킬 스크립트로 본다
    // hooks/ 아래는 참조 여부와 무관하게 훅이 실행할 수 있는 코드라 항상 검사(scan-files 선택 기준과 동일)
    const inSkill =
      rel.startsWith('hooks/') ||
      skillDirs.some((d) =>
        d ? rel.startsWith(`${d}/`) : rel.startsWith('scripts/'),
      );
    if (inSkill) addScript(file);
  }
  return { targets, notes };
}

/** SKILL.md → 프런트매터(skill-meta) · 코드블록(언어별 shell/script) · 인라인 코드(shell) · 본문(prose). */
function extractSkillMd(file: ScanFile, targets: Target[]): void {
  const lines = file.content.split(/\r?\n/);
  const filePath = file.path;
  const prose: string[] = lines.map(() => '');

  let bodyStart = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (end > 0) {
      targets.push({
        region: 'skill-meta',
        filePath,
        text: lines.slice(1, end).join('\n'),
        lineOffset: 1,
      });
      bodyStart = end + 1;
    }
  }

  let fence: { start: number; lang: string; body: string[] } | null = null;
  const closeFence = () => {
    if (!fence) return;
    const lang = fence.lang.toLowerCase();
    const region: Region | null = SHELL_LANGS.has(lang)
      ? 'shell'
      : SCRIPT_LANGS.has(lang)
        ? 'script'
        : null;
    if (region)
      targets.push({
        region,
        filePath,
        text: fence.body.join('\n'),
        lineOffset: fence.start,
      });
    fence = null;
  };

  for (let i = bodyStart; i < lines.length; i++) {
    const open = /^\s*(?:```|~~~)\s*([\w-]*)/.exec(lines[i]);
    if (open && !fence) fence = { start: i + 1, lang: open[1], body: [] };
    else if (open && fence) closeFence();
    else if (fence) fence.body.push(lines[i]);
    else {
      prose[i] = lines[i];
      for (const m of lines[i].matchAll(/`([^`\n]+)`/g)) {
        targets.push({ region: 'shell', filePath, text: m[1], lineOffset: i });
      }
    }
  }
  closeFence();
  targets.push({
    region: 'prose',
    filePath,
    text: prose.join('\n'),
    lineOffset: 0,
  });
}
