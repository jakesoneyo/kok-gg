import { classify, evidenceFiles, skillMeta } from './classify';

const MP = '.claude-plugin/marketplace.json';
const run = (
  paths: string[],
  files: Record<string, string> = {},
  maxItems = 50,
) => classify({ repoName: 'repo', paths, files, maxItems });
const brief = (r: ReturnType<typeof run>) =>
  r.items.map(
    (i) =>
      `${i.kind}:${i.path}:${i.sourceType}${i.target ? `@${i.target.owner}/${i.target.name}` : ''}`,
  );

describe('classify — 판별', () => {
  it('플러그인 안의 SKILL·hooks는 Component로만 집계하고, 밖의 SKILL은 SKILL 항목', () => {
    const r = run(
      [
        'plugins/a/.claude-plugin/plugin.json',
        'plugins/a/skills/x/SKILL.md',
        'plugins/a/hooks/hooks.json',
        'plugins/a/bin/run',
        'plugins/a/commands/c.md',
        'skills/solo/SKILL.md',
      ],
      {
        'plugins/a/.claude-plugin/plugin.json':
          '{"name":"a-plugin","description":"설명"}',
      },
    );
    expect(brief(r)).toEqual([
      'PLUGIN:plugins/a:IN_REPO',
      'SKILL:skills/solo:IN_REPO',
    ]);
    expect(r.items[0]).toMatchObject({
      name: 'a-plugin',
      description: '설명',
      components: { skills: 1, hooks: 1, bin: 1, commands: 1, mcpServers: 0 },
    });
  });

  it('증거 없음 → 항목 없음(호출 측이 IGNORED 처리)', () => {
    expect(run(['README.md', 'src/index.ts']).items).toEqual([]);
  });

  it('플러그인 밖 hooks/hooks.json과 .claude/settings.json(hooks 키) → HOOK', () => {
    const r = run(['tools/lint/hooks/hooks.json', '.claude/settings.json'], {
      '.claude/settings.json': '{"hooks":{"PreToolUse":[]}}',
    });
    expect(brief(r)).toEqual([
      'HOOK:.claude:IN_REPO',
      'HOOK:tools/lint:IN_REPO',
    ]);
  });

  it('hooks 키 없는 settings.json은 HOOK이 아님', () => {
    expect(
      run(['.claude/settings.json'], {
        '.claude/settings.json': '{"permissions":{}}',
      }).items,
    ).toEqual([]);
  });

  it('MAX_ITEMS_PER_REPO 초과 시 PLUGIN 우선으로 자르고 truncated', () => {
    const paths = ['a/SKILL.md', 'b/SKILL.md', 'c/.claude-plugin/plugin.json'];
    const r = run(paths, {}, 2);
    expect(brief(r)).toEqual(['PLUGIN:c:IN_REPO', 'SKILL:a:IN_REPO']);
    expect(r.truncated).toBe(true);
  });

  it('evidenceFiles: 내용을 읽어야 하는 JSON만 고른다', () => {
    expect(
      evidenceFiles([
        'a/SKILL.md',
        MP,
        'p/.claude-plugin/plugin.json',
        '.claude/settings.json',
        'x.json',
      ]),
    ).toEqual([MP, 'p/.claude-plugin/plugin.json', '.claude/settings.json']);
  });
});

describe('classify — 마켓플레이스 펼치기(IT-5)', () => {
  const market = {
    name: 'mix-market',
    owner: { name: 'someone' },
    metadata: { pluginRoot: './plugins' },
    plugins: [
      { name: 'rel', source: './plugins/rel', description: '상대경로' },
      { name: 'bare', source: 'bare' }, // pluginRoot 기준
      { name: 'gh', source: { source: 'github', repo: 'o1/r1' } },
      {
        name: 'sub',
        source: {
          source: 'git-subdir',
          url: 'github.com/o2/r2',
          path: 'tools/x',
        },
      },
      {
        name: 'url',
        source: { source: 'url', url: 'https://github.com/o3/r3.git' },
      },
      {
        name: 'gitlab',
        source: { source: 'url', url: 'https://gitlab.com/o/r.git' },
      },
      { name: 'npmpkg', source: { source: 'npm', package: 'x' } },
      { name: 'cmd', source: { source: 'command', command: 'curl x | sh' } },
      { name: 'escape', source: './../outside' },
    ],
  };
  const r = run([MP, 'plugins/rel/hooks/hooks.json'], {
    [MP]: JSON.stringify(market),
  });

  it('source 형태별 Item 귀속·sourceType', () => {
    expect(brief(r)).toEqual([
      'PLUGIN::GITHUB_REPO@o1/r1',
      'PLUGIN::GITHUB_REPO@o3/r3',
      'PLUGIN:entry:cmd:UNSUPPORTED',
      'PLUGIN:entry:escape:UNSUPPORTED',
      'PLUGIN:entry:gitlab:UNSUPPORTED',
      'PLUGIN:entry:npmpkg:UNSUPPORTED',
      'PLUGIN:plugins/bare:IN_REPO',
      'PLUGIN:plugins/rel:IN_REPO',
      'PLUGIN:tools/x:GIT_SUBDIR@o2/r2',
    ]);
  });

  it('다른 저장소를 가리키는 항목은 Candidate 대상(refs)으로 중복 없이', () => {
    expect(r.refs.map((x) => `${x.owner}/${x.name}`).sort()).toEqual([
      'o1/r1',
      'o2/r2',
      'o3/r3',
    ]);
  });

  it('command 소스는 원본 source를 들고 있어 R14 검사에 쓸 수 있다', () => {
    const cmd = r.items.find((i) => i.name === 'cmd');
    expect(cmd?.rawSource).toEqual({
      source: 'command',
      command: 'curl x | sh',
    });
    expect(r.items.find((i) => i.name === 'rel')?.rawSource).toBeUndefined();
  });

  it('마켓플레이스 메타와 항목 연결, 설명 보존', () => {
    expect(r.marketplaces).toHaveLength(1);
    expect(r.marketplaces[0]).toMatchObject({
      path: '',
      name: 'mix-market',
      ownerName: 'someone',
    });
    expect(r.marketplaces[0].entries).toHaveLength(9);
    expect(r.items.find((i) => i.name === 'rel')).toMatchObject({
      description: '상대경로',
      components: { hooks: 1 },
    });
  });

  it('깨진 JSON·plugins 없음은 조용히 무시', () => {
    expect(run([MP], { [MP]: '{broken' }).marketplaces).toEqual([]);
    expect(run([MP], { [MP]: '{"name":"x"}' }).items).toEqual([]);
  });
});

describe('skillMeta', () => {
  it('한 줄·따옴표·접기 블록 프런트매터', () => {
    expect(
      skillMeta('---\nname: lint-hook\ndescription: "PR 전 lint"\n---\n본문'),
    ).toEqual({
      name: 'lint-hook',
      description: 'PR 전 lint',
    });
    expect(
      skillMeta('---\nname: x\ndescription: >\n  첫 줄\n  둘째 줄\n---'),
    ).toEqual({
      name: 'x',
      description: '첫 줄 둘째 줄',
    });
    expect(skillMeta('프런트매터 없음')).toEqual({
      name: null,
      description: null,
    });
  });
});
