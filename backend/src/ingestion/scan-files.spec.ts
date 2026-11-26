import {
  MAX_FILES_PER_ITEM,
  refToRepoPath,
  selectScanFiles,
} from './scan-files';

const e = (...paths: string[]) => paths.map((path) => ({ path, size: 10 }));

describe('selectScanFiles', () => {
  it('설정 JSON·SKILL.md·bin·스킬/훅/scripts 아래 스크립트만, 루트 밖은 제외', () => {
    const { files } = selectScanFiles(
      e(
        'p/.claude-plugin/plugin.json',
        'p/hooks/hooks.json',
        'p/skills/a/SKILL.md',
        'p/skills/a/run.py',
        'p/bin/tool',
        'p/scripts/x.sh',
        'p/src/app.ts',
        'p/README.md',
        'other/hooks/hooks.json',
      ),
      'p',
    );
    expect(files.map((f) => f.path)).toEqual([
      'p/.claude-plugin/plugin.json',
      'p/hooks/hooks.json',
      'p/skills/a/SKILL.md',
      'p/skills/a/run.py',
      'p/bin/tool',
      'p/scripts/x.sh',
    ]);
  });
  it('상한 초과는 tooMany', () => {
    const many = e(
      ...Array.from({ length: MAX_FILES_PER_ITEM + 1 }, (_, i) => `bin/f${i}`),
    );
    expect(selectScanFiles(many, '')).toMatchObject({ tooMany: true });
    expect(selectScanFiles(many, '').files).toHaveLength(MAX_FILES_PER_ITEM);
  });
});

describe('refToRepoPath', () => {
  it('플러그인 루트 기준 경로 정규화, 루트 탈출은 null', () => {
    expect(refToRepoPath('./a/../b/c.sh', 'plug')).toBe('plug/b/c.sh');
    expect(refToRepoPath('x.sh', '')).toBe('x.sh');
    expect(refToRepoPath('../../etc/passwd', 'plug')).toBeNull();
  });
});
