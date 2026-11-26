// 5단계 fetch-content: headSha가 바뀐 저장소만 트리를 다시 판별하고 항목별 요약 원문(Source Doc)을 받아 저장한다.
// 변경 없는 저장소는 외부 호출 0(IT-6). 원문은 신뢰할 수 없는 텍스트 — 여기서는 저장만 하고 해석하지 않는다.
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { GithubClient } from '../../github/github.client';
import {
  GithubError,
  MAX_FILE_BYTES,
  stripNul,
  type TreeEntry,
} from '../../github/github.types';
import { PrismaService } from '../../prisma/prisma.service';
import { skillMeta } from '../classify';
import { RepoInspector } from '../repo-inspector.service';
import type { Stage, StageContext } from '../stage';
import { errorMessage, forEachLimit, isPause } from '../util';

const DOC_MAX_CHARS = 64 * 1024; // DATA-MODEL: 64KB 절단
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** SKILL.md → 항목 디렉터리 README → 저장소 README 순(SPEC F5). 대소문자 무시, 트리에 있는 것만. */
export function docCandidates(
  kind: string,
  root: string,
  entries: readonly TreeEntry[],
): string[] {
  // 상한을 넘는 파일은 후보에서 빼 호출·메모리를 아낀다(REVIEW Y9)
  const byLower = new Map(
    entries
      .filter((e) => e.size <= MAX_FILE_BYTES)
      .map((e) => [e.path.toLowerCase(), e.path]),
  );
  const at = (dir: string, file: string) =>
    byLower.get((dir ? `${dir}/${file}` : file).toLowerCase());
  return [
    kind === 'SKILL' ? at(root, 'SKILL.md') : undefined,
    at(root, 'README.md'),
    at('', 'README.md'),
  ]
    .filter((p): p is string => !!p)
    .filter((p, i, a) => a.indexOf(p) === i);
}

@Injectable()
export class FetchContentStage implements Stage {
  readonly name = 'FETCH_CONTENT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubClient,
    private readonly inspector: RepoInspector,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    const skip = new Set<number>();
    for (;;) {
      const [repo] = await this.prisma.$queryRaw<
        { id: number; owner: string; name: string; head_sha: string }[]
      >`
        SELECT id, owner, name, head_sha FROM repo
         WHERE status = 'TRACKED' AND head_sha IS NOT NULL
           AND content_sha IS DISTINCT FROM head_sha AND id <> ALL(${[...skip]}::int[])
         ORDER BY id LIMIT 1`;
      if (!repo) return;
      try {
        await this.fetchRepo(ctx, repo);
        ctx.add('processed');
      } catch (e) {
        // 레이트리밋 PAUSED만 단계 수준. 그 외(GitHub·DB 거부 등)는 저장소 단위로 격리해야
        // 한 저장소가 매일 같은 지점에서 단계 전체를 멈추는 독 알약이 되지 않는다(REVIEW B4).
        // 진짜 치명 오류(DB 단절)는 실패율 규칙이 단계 FAILED로 올린다.
        if (isPause(e)) throw e;
        skip.add(repo.id);
        await ctx.failure(
          e instanceof GithubError ? e.code : 'FETCH_CONTENT_FAILED',
          errorMessage(e),
          { repoId: repo.id },
        );
      }
    }
  }

  private async fetchRepo(
    ctx: StageContext,
    repo: { id: number; owner: string; name: string; head_sha: string },
  ) {
    const out = await this.inspector.inspect(repo, repo.head_sha);
    if (out.tooLarge) {
      await this.prisma.repo.update({
        where: { id: repo.id },
        data: { status: 'TOO_LARGE' },
      });
      return;
    }
    const items = await this.prisma.item.findMany({
      where: {
        repoId: repo.id,
        status: 'ACTIVE',
        sourceType: { not: 'UNSUPPORTED' },
      },
      select: { id: true, kind: true, path: true },
    });
    const writes: {
      itemId: number;
      path: string;
      content: string;
      name: string | null;
      description: string | null;
    }[] = [];

    await forEachLimit(items, 4, async (item) => {
      for (const path of docCandidates(
        item.kind,
        item.path,
        out.tree.entries,
      )) {
        const raw = await this.github.getFile(
          repo.owner,
          repo.name,
          repo.head_sha,
          path,
        );
        if (raw === null) continue;
        const text = stripNul(raw); // 클라이언트 구현과 무관하게 DB 쓰기 직전에도 보장
        const meta =
          path.toLowerCase().endsWith('/skill.md') || path === 'SKILL.md'
            ? skillMeta(text)
            : { name: null, description: null };
        writes.push({
          itemId: item.id,
          path,
          content: text.slice(0, DOC_MAX_CHARS),
          ...meta,
        });
        return;
      }
    });

    await ctx.commit({ lastRepoId: repo.id }, async (tx) => {
      for (const w of writes) {
        await tx.itemSourceDoc.upsert({
          where: { itemId: w.itemId },
          create: {
            itemId: w.itemId,
            path: w.path,
            content: w.content,
            contentSha256: sha256(w.content),
          },
          update: {
            path: w.path,
            content: w.content,
            contentSha256: sha256(w.content),
            fetchedAt: new Date(),
          },
        });
        if (w.name || w.description)
          await tx.item.update({
            where: { id: w.itemId },
            data: {
              ...(w.name ? { name: w.name } : {}),
              ...(w.description ? { description: w.description } : {}),
            },
          });
      }
      await tx.repo.update({
        where: { id: repo.id },
        data: { contentSha: repo.head_sha },
      });
    });
  }
}
