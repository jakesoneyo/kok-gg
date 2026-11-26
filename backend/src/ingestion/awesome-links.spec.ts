import { parseGithubRepoLinks } from './awesome-links';

describe('parseGithubRepoLinks', () => {
  it('저장소 링크만 뽑고 대소문자 무시 중복·.git·예약 경로를 걸러낸다', () => {
    const md = `
- [a](https://github.com/Foo/bar) 설명
- [a again](https://github.com/foo/BAR/blob/main/README.md)
- [b](https://github.com/baz/qux.git)
- [t](https://github.com/topics/claude-code)
- [s](https://github.com/sponsors/someone)
- [user](https://github.com/onlyuser)
- (https://github.com/x/y.)`;
    expect(parseGithubRepoLinks(md)).toEqual([
      { owner: 'Foo', name: 'bar' },
      { owner: 'baz', name: 'qux' },
      { owner: 'x', name: 'y' },
    ]);
  });
});
