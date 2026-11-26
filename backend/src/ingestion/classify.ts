// 저장소 트리 → Item 초안 판별(순수 함수, IO 없음). 증거 파일 규칙과 마켓플레이스 source 매핑은 ARCHITECTURE 3.4.
// 호출 측(RepoInspector)이 트리와 증거 JSON 내용을 가져다 넘기고, 결과를 DB에 upsert한다.
import type { ItemKind, ItemSourceType } from '@prisma/client';
import { deepStripNul } from './util';

export interface ItemDraft {
  kind: ItemKind;
  /** 저장소 내 디렉터리('' = 루트). UNSUPPORTED는 'entry:{name}'. */
  path: string;
  name: string;
  description: string | null;
  sourceType: ItemSourceType;
  components: Components;
  /** 귀속 저장소. 생략 = 지금 판별 중인 저장소. */
  target?: { owner: string; name: string };
  /** UNSUPPORTED command 소스처럼 원본 source를 보안 검사에 넘겨야 할 때. */
  rawSource?: unknown;
}

export interface Components {
  skills: number;
  hooks: number;
  mcpServers: number;
  commands: number;
  agents: number;
  monitors: number;
  bin: number;
}

export interface MarketplaceDraft {
  path: string;
  name: string;
  ownerName: string | null;
  entries: {
    entryName: string;
    item: Pick<ItemDraft, 'kind' | 'path' | 'target'>;
    rawSource: unknown;
  }[];
}

export interface ClassifyResult {
  items: ItemDraft[];
  marketplaces: MarketplaceDraft[];
  /** 다른 저장소를 가리키는 마켓플레이스 항목 → Candidate로 등록할 대상. */
  refs: { owner: string; name: string }[];
  /** MAX_ITEMS_PER_REPO 초과로 잘렸음. */
  truncated: boolean;
}

type Json = Record<string, any>;
const isObj = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

const dirname = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), 0));
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const under = (p: string, root: string) => !root || p.startsWith(`${root}/`);

/** `.`·`..` 정규화. 루트 탈출이면 null. */
function normalize(p: string): string | null {
  const stack: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!stack.pop()) return null;
    } else stack.push(part);
  }
  return stack.join('/');
}

const MARKETPLACE_SUFFIX = '.claude-plugin/marketplace.json';
const PLUGIN_SUFFIX = '.claude-plugin/plugin.json';
const stripSuffix = (path: string, suffix: string) =>
  path === suffix ? '' : path.slice(0, -suffix.length - 1);

/** 내용을 읽어야 판별할 수 있는 파일들(작은 JSON만). */
export function evidenceFiles(paths: readonly string[]): string[] {
  return paths.filter(
    (p) =>
      p.endsWith(MARKETPLACE_SUFFIX) ||
      p.endsWith(PLUGIN_SUFFIX) ||
      p === '.claude/settings.json',
  );
}

/** SKILL.md 프런트매터의 name/description(한 줄·접기 `>`/`|` 블록까지). */
export function skillMeta(content: string): {
  name: string | null;
  description: string | null;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return { name: null, description: null };
  const lines = m[1].split(/\r?\n/);
  const field = (key: string): string | null => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i < 0) return null;
    let v = lines[i].slice(key.length + 1).trim();
    if (/^[>|][+-]?$/.test(v)) {
      const rest: string[] = [];
      for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++)
        rest.push(lines[j].trim());
      v = rest.join(' ');
    }
    return v.replace(/^(["'])(.*)\1$/, '$2').trim() || null;
  };
  return { name: field('name'), description: field('description') };
}

function parseJson(text: string | undefined): Json | null {
  if (!text) return null;
  try {
    const v: unknown = deepStripNul(JSON.parse(text));
    return isObj(v) ? v : null;
  } catch {
    return null;
  }
}

const GITHUB_URL =
  /^(?:https:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/;

/** 마켓플레이스 source 한 개 → Item 귀속(ARCHITECTURE 3.4 표). */
function resolveSource(
  name: string,
  source: unknown,
  marketplaceDir: string,
  pluginRootDir: string,
): Pick<ItemDraft, 'path' | 'sourceType' | 'target'> {
  const unsupported = {
    path: `entry:${name}`,
    sourceType: 'UNSUPPORTED' as const,
  };
  if (typeof source === 'string') {
    const rel =
      source.startsWith('./') || source === '.'
        ? source
        : pluginRootDir && !/[:/]/.test(source)
          ? `${pluginRootDir}/${source}`
          : null;
    if (rel === null) return unsupported;
    const path = normalize(`${marketplaceDir}/${rel}`);
    return path === null ? unsupported : { path, sourceType: 'IN_REPO' };
  }
  if (!isObj(source)) return unsupported;
  const sub = (p: string) =>
    /^[\w.-]+\/[\w.-]+$/.test(p) ? p.split('/') : null;
  const gh = (url: string) => GITHUB_URL.exec(url);

  if (source.source === 'github' && typeof source.repo === 'string') {
    const t = sub(source.repo.replace(/\.git$/, ''));
    return t
      ? {
          path: '',
          sourceType: 'GITHUB_REPO',
          target: { owner: t[0], name: t[1] },
        }
      : unsupported;
  }
  if (source.source === 'url' && typeof source.url === 'string') {
    const m = gh(source.url);
    return m
      ? {
          path: '',
          sourceType: 'GITHUB_REPO',
          target: { owner: m[1], name: m[2] },
        }
      : unsupported;
  }
  if (source.source === 'git-subdir' && typeof source.url === 'string') {
    const m = gh(source.url);
    const path =
      typeof source.path === 'string' ? normalize(source.path) : null;
    return m && path !== null
      ? { path, sourceType: 'GIT_SUBDIR', target: { owner: m[1], name: m[2] } }
      : unsupported;
  }
  return unsupported; // npm · archive · command · 알 수 없는 소스
}

function countComponents(
  paths: readonly string[],
  root: string,
  pluginJson: Json | null,
): Components {
  const rel = paths
    .filter((p) => under(p, root))
    .map((p) => (root ? p.slice(root.length + 1) : p));
  return {
    skills: rel.filter((p) => basename(p) === 'SKILL.md').length,
    hooks:
      (rel.includes('hooks/hooks.json') ? 1 : 0) + (pluginJson?.hooks ? 1 : 0),
    mcpServers: rel.includes('.mcp.json') || pluginJson?.mcpServers ? 1 : 0,
    commands: rel.filter((p) => /^commands\/[^/]+\.md$/.test(p)).length,
    agents: rel.filter((p) => /^agents\/[^/]+\.md$/.test(p)).length,
    monitors: rel.includes('monitors/monitors.json') ? 1 : 0,
    bin: rel.filter((p) => p.startsWith('bin/')).length,
  };
}

/**
 * @param files evidenceFiles()가 고른 경로 → 내용(없거나 못 읽은 파일은 키 없음)
 * @param repoName 루트 항목의 기본 이름
 */
export function classify(input: {
  repoName: string;
  paths: readonly string[];
  files: Readonly<Record<string, string>>;
  maxItems: number;
}): ClassifyResult {
  const { paths, files, repoName } = input;
  const drafts = new Map<string, ItemDraft>();
  const keyOf = (d: Pick<ItemDraft, 'kind' | 'path' | 'target'>) =>
    `${d.target ? `${d.target.owner}/${d.target.name}`.toLowerCase() : ''}|${d.kind}|${d.path}`;
  const put = (d: ItemDraft) => {
    const prev = drafts.get(keyOf(d));
    // 같은 항목이 마켓플레이스와 트리 양쪽에서 잡히면 마켓플레이스 이름(설치 이름)·설명을 우선
    drafts.set(
      keyOf(d),
      prev
        ? {
            ...d,
            ...prev,
            description: prev.description ?? d.description,
            components: d.components,
          }
        : d,
    );
  };

  const pluginJsons = new Map<string, Json | null>();
  for (const p of paths.filter((p) => p.endsWith(PLUGIN_SUFFIX)))
    pluginJsons.set(stripSuffix(p, PLUGIN_SUFFIX), parseJson(files[p]));

  // ── 마켓플레이스 ──
  const marketplaces: MarketplaceDraft[] = [];
  const inRepoPluginRoots = new Set<string>();
  for (const mp of paths.filter((p) => p.endsWith(MARKETPLACE_SUFFIX))) {
    const doc = parseJson(files[mp]);
    if (!doc || !Array.isArray(doc.plugins)) continue;
    const dir = stripSuffix(mp, MARKETPLACE_SUFFIX);
    const pluginRootDir =
      str(isObj(doc.metadata) ? doc.metadata.pluginRoot : null) ?? '';
    const draft: MarketplaceDraft = {
      path: dir,
      name: str(doc.name) ?? repoName,
      ownerName: str(isObj(doc.owner) ? doc.owner.name : null),
      entries: [],
    };
    for (const entry of doc.plugins as unknown[]) {
      const name = isObj(entry) ? str(entry.name) : null;
      if (!isObj(entry) || !name) continue;
      const where = resolveSource(name, entry.source, dir, pluginRootDir);
      const item: ItemDraft = {
        kind: 'PLUGIN',
        name,
        description: str(entry.description),
        components: countComponents(
          paths,
          where.target ? '\0' : where.path,
          null,
        ),
        rawSource:
          where.sourceType === 'UNSUPPORTED' ? entry.source : undefined,
        ...where,
      };
      if (where.sourceType === 'IN_REPO') inRepoPluginRoots.add(where.path);
      put(item);
      draft.entries.push({
        entryName: name,
        item,
        rawSource: entry.source ?? null,
      });
    }
    marketplaces.push(draft);
  }

  // ── 플러그인 루트(plugin.json 디렉터리 + 마켓플레이스 상대경로 대상) ──
  const roots = new Set([...pluginJsons.keys(), ...inRepoPluginRoots]);
  for (const root of roots) {
    const pj = pluginJsons.get(root) ?? null;
    put({
      kind: 'PLUGIN',
      path: root,
      name: str(pj?.name) ?? (basename(root) || repoName),
      description: str(pj?.description),
      sourceType: 'IN_REPO',
      components: countComponents(paths, root, pj),
    });
  }
  const insidePlugin = (p: string) => [...roots].some((r) => under(p, r));

  // ── 플러그인 밖 SKILL · HOOK ──
  for (const p of paths) {
    if (insidePlugin(p)) continue;
    if (basename(p) === 'SKILL.md') {
      const dir = dirname(p);
      put({
        kind: 'SKILL',
        path: dir,
        name: basename(dir) || repoName,
        description: null,
        sourceType: 'IN_REPO',
        components: countComponents(paths, dir, null),
      });
    } else if (p.endsWith('hooks/hooks.json')) {
      const dir = stripSuffix(p, 'hooks/hooks.json');
      put({
        kind: 'HOOK',
        path: dir,
        name: basename(dir) || repoName,
        description: null,
        sourceType: 'IN_REPO',
        components: { ...countComponents(paths, dir, null), hooks: 1 },
      });
    }
  }
  if (
    paths.includes('.claude/settings.json') &&
    !insidePlugin('.claude/settings.json')
  ) {
    if (parseJson(files['.claude/settings.json'])?.hooks)
      put({
        kind: 'HOOK',
        path: '.claude',
        name: `${repoName} hooks`,
        description: null,
        sourceType: 'IN_REPO',
        components: {
          skills: 0,
          hooks: 1,
          mcpServers: 0,
          commands: 0,
          agents: 0,
          monitors: 0,
          bin: 0,
        },
      });
  }

  // ── 상한: PLUGIN 우선 → 경로 순(결정적) ──
  const kindRank = { PLUGIN: 0, SKILL: 1, HOOK: 2 } as const;
  const all = [...drafts.values()].sort(
    (a, b) =>
      kindRank[a.kind] - kindRank[b.kind] || a.path.localeCompare(b.path),
  );
  const items = all.slice(0, input.maxItems);
  const seen = new Set<string>();
  const refs = items.flatMap((i) => {
    if (!i.target) return [];
    const k = `${i.target.owner}/${i.target.name}`.toLowerCase();
    if (seen.has(k)) return [];
    seen.add(k);
    return [i.target];
  });
  return { items, marketplaces, refs, truncated: all.length > items.length };
}
