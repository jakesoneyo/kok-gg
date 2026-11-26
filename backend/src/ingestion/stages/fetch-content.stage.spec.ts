import { docCandidates } from './fetch-content.stage';

const e = (...paths: string[]) => paths.map((path) => ({ path, size: 1 }));

describe('docCandidates', () => {
  it('SKILL은 SKILL.md → 디렉터리 README → 저장소 README, 대소문자 무시·트리에 있는 것만', () => {
    const tree = e('skills/a/SKILL.md', 'skills/a/Readme.md', 'README.md');
    expect(docCandidates('SKILL', 'skills/a', tree)).toEqual([
      'skills/a/SKILL.md',
      'skills/a/Readme.md',
      'README.md',
    ]);
    expect(docCandidates('PLUGIN', 'skills/a', tree)).toEqual([
      'skills/a/Readme.md',
      'README.md',
    ]);
    expect(docCandidates('HOOK', 'x', e('x/other.md'))).toEqual([]);
  });

  it('REVIEW Y9: 트리 크기가 상한(256KB)을 넘는 문서는 받지 않는다', () => {
    const tree = [
      { path: 'README.md', size: 300 * 1024 },
      { path: 'skills/a/SKILL.md', size: 10 },
    ];
    expect(docCandidates('SKILL', 'skills/a', tree)).toEqual([
      'skills/a/SKILL.md',
    ]);
  });
});
