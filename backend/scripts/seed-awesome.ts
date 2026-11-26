// awesome 목록 1회 시드: README의 GitHub 링크를 Candidate(AWESOME_SEED)로 등록한다. 이미 있는 저장소는 건드리지 않아 재실행해도 안전.
// 이후 판별은 평소 수집(qualify 단계)이 한다.
//
// 실행: GITHUB_TOKEN_INGEST=… DATABASE_URL=… npx ts-node scripts/seed-awesome.ts <raw README URL>
import { NestFactory } from '@nestjs/core';
import { CliModule } from '../src/cli.module';
import { GithubClient } from '../src/github/github.client';
import type { GhRepo } from '../src/github/github.types';
import { parseGithubRepoLinks } from '../src/ingestion/awesome-links';
import { CandidatesService } from '../src/ingestion/candidates.service';

async function main() {
  const url = process.argv[2];
  if (!url?.startsWith('https://')) {
    throw new Error('사용법: seed-awesome <https://…/README.md (raw)>');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`README 조회 실패 ${res.status}`);
  const links = parseGithubRepoLinks(await res.text());

  const app = await NestFactory.createApplicationContext(CliModule);
  try {
    const github = app.get(GithubClient, { strict: false });
    const candidates = app.get(CandidatesService);
    const repos: GhRepo[] = [];
    for (const l of links) {
      const r = await github.getRepo(`${l.owner}/${l.name}`).catch(() => null);
      if (r) repos.push(r);
    }
    const { created } = await candidates.upsertCandidates(
      repos,
      'AWESOME_SEED',
    );
    console.log(
      JSON.stringify({ links: links.length, fetched: repos.length, created }),
    );
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
