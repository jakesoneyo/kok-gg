// 1단계 discover: 토픽 검색(저장소)과 파일명 코드 검색으로 후보 저장소(Candidate)를 모은다.
// 코드 검색은 결과 1000건 상한이 있어 `size:` 구간을 하루 하나씩 순환해 넘는다.
import { Inject, Injectable } from '@nestjs/common';
import { GithubClient } from '../../github/github.client';
import type { GhSearchPage } from '../../github/github.types';
import { CandidatesService } from '../candidates.service';
import { INGEST_CONFIG, type IngestConfig } from '../ingest.config';
import type { Stage, StageContext } from '../stage';

const CODE_FILES = [
  'filename:marketplace.json path:.claude-plugin',
  'filename:plugin.json path:.claude-plugin',
  'filename:SKILL.md',
  'filename:hooks.json path:hooks',
];
const SIZE_SLICES = [
  'size:<1000',
  'size:1000..3000',
  'size:3001..8000',
  'size:8001..20000',
  'size:>20000',
];
/** GitHub 검색은 쿼리당 최대 1000건(= 100건 × 10페이지). */
const MAX_PAGES = 10;

const dayNumber = (asOf: string) => Math.floor(Date.parse(asOf) / 86_400_000);

@Injectable()
export class DiscoverStage implements Stage {
  readonly name = 'DISCOVER' as const;

  constructor(
    private readonly github: GithubClient,
    private readonly candidates: CandidatesService,
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    const slice = SIZE_SLICES[dayNumber(ctx.asOf) % SIZE_SLICES.length];
    const tasks: { run: (page: number) => Promise<GhSearchPage> }[] = [
      ...this.config.topics.map((t) => ({
        run: (page: number) =>
          this.github.searchRepositories(
            `topic:${t} fork:false archived:false`,
            page,
          ),
      })),
      ...CODE_FILES.map((f) => ({
        run: (page: number) => this.github.searchCode(`${f} ${slice}`, page),
      })),
    ];

    // 커서 = 다음에 처리할 (작업 번호, 페이지). 페이지마다 커밋해 재개 지점이 촘촘하다.
    let task = Number(ctx.cursor?.task ?? 0);
    let page = Number(ctx.cursor?.page ?? 1);
    for (; task < tasks.length; task++, page = 1) {
      const isCode = task >= this.config.topics.length;
      for (; page <= MAX_PAGES; page++) {
        const res = await tasks[task].run(page);
        const { created } = await this.candidates.upsertCandidates(
          res.items,
          isCode ? 'CODE_SEARCH' : 'TOPIC_SEARCH',
        );
        ctx.add('processed', res.items.length);
        ctx.add('discovered', created);
        const last = !res.hasMore || page === MAX_PAGES;
        await ctx.commit(
          last ? { task: task + 1, page: 1 } : { task, page: page + 1 },
        );
        if (last) break;
      }
    }
  }
}
