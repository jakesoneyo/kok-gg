// 6단계 security-scan: (item, headSha, ruleSetVersion) 검사가 없는 항목만 규칙 엔진으로 검사해 저장한다.
// 판정은 엔진만 한다(LLM 없음). 분석 불가 상태(UNSUPPORTED/TOO_LARGE/ERROR)는 엔진 밖에서 정한다 — 엔진은 파일을 받아 규칙만 돌리는 순수 함수라서.
import { Injectable, Logger } from '@nestjs/common';
import type { ScanStatus } from '@prisma/client';
import { GithubClient } from '../../github/github.client';
import type { GhTree, TreeEntry } from '../../github/github.types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  RULE_SET_VERSION,
  scan,
  type ScanFile,
  type ScanResult,
} from '../../security/engine';
import { SecurityService } from '../../security/security.service';
import {
  MAX_FILE_BYTES,
  MAX_ITEM_BYTES,
  refToRepoPath,
  selectScanFiles,
} from '../scan-files';
import type { Stage, StageContext } from '../stage';
import { errorMessage, isPause } from '../util';

const BATCH = 50;

interface ScanItem {
  id: number;
  path: string;
  sourceType: string;
}

@Injectable()
export class SecurityScanStage implements Stage {
  readonly name = 'SECURITY_SCAN' as const;
  private readonly logger = new Logger(SecurityScanStage.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubClient,
    private readonly security: SecurityService,
  ) {}

  async run(ctx: StageContext): Promise<void> {
    let after = Number(ctx.cursor?.lastRepoId ?? 0);
    for (;;) {
      // 규칙셋 버전이 바뀌면 이 조건이 자연스럽게 전 항목을 다시 집어 온다
      const repos = await this.prisma.$queryRaw<
        { id: number; owner: string; name: string; head_sha: string }[]
      >`
        SELECT DISTINCT r.id, r.owner, r.name, r.head_sha FROM repo r JOIN item i ON i.repo_id = r.id
         WHERE r.status = 'TRACKED' AND r.head_sha IS NOT NULL AND i.status = 'ACTIVE' AND r.id > ${after}
           AND NOT EXISTS (SELECT 1 FROM security_scan s WHERE s.item_id = i.id
                            AND s.head_sha = r.head_sha AND s.rule_set_version = ${RULE_SET_VERSION})
         ORDER BY r.id LIMIT ${BATCH}`;
      if (!repos.length) return;

      for (const repo of repos) {
        try {
          await this.scanRepo(ctx, repo);
        } catch (e) {
          if (isPause(e)) throw e;
          await ctx.failure('SCAN_FAILED', errorMessage(e), {
            repoId: repo.id,
          });
        }
        after = repo.id;
      }
      await ctx.commit({ lastRepoId: after });
    }
  }

  private async scanRepo(
    ctx: StageContext,
    repo: { id: number; owner: string; name: string; head_sha: string },
  ) {
    const items = await this.prisma.$queryRaw<ScanItem[]>`
      SELECT i.id, i.path, i.source_type AS "sourceType" FROM item i
       WHERE i.repo_id = ${repo.id} AND i.status = 'ACTIVE'
         AND NOT EXISTS (SELECT 1 FROM security_scan s WHERE s.item_id = i.id
                          AND s.head_sha = ${repo.head_sha} AND s.rule_set_version = ${RULE_SET_VERSION})`;
    if (!items.length) return;

    const entries = await this.prisma.marketplaceEntry.findMany({
      where: {
        itemId: { in: items.map((i) => i.id) },
        item: { sourceType: 'UNSUPPORTED' },
      },
      select: { itemId: true, entryName: true, rawSource: true },
    });
    const rawByItem = new Map(entries.map((e) => [e.itemId, e]));

    // UNSUPPORTED만 있으면 트리가 필요 없다 → 외부 호출 0
    const needsTree = items.some((i) => i.sourceType !== 'UNSUPPORTED');
    const tree = needsTree
      ? await this.github.getTree(repo.owner, repo.name, repo.head_sha)
      : null;

    for (const item of items) {
      try {
        const [status, result] =
          item.sourceType === 'UNSUPPORTED'
            ? this.scanUnsupported(rawByItem.get(item.id))
            : await this.scanFiles(repo, item, tree!);
        await this.security.saveScan(
          item.id,
          repo.head_sha,
          RULE_SET_VERSION,
          status,
          result,
        );
        ctx.add('processed');
      } catch (e) {
        if (isPause(e)) throw e;
        // 가져오기 실패는 저장하지 않는다 — 저장하면 같은 (sha, 버전)이라 다음 실행이 재시도하지 못한다
        await ctx.failure('SCAN_FETCH_FAILED', errorMessage(e), {
          repoId: repo.id,
          itemId: item.id,
        });
      }
    }
  }

  /**
   * 지원하지 않는 source는 분석 불가가 원칙이지만, `command` 소스는 선언 자체가 위험 신호(R14)이므로
   * 그 항목 하나만 합성 marketplace.json으로 엔진을 돌려 ANALYZED로 남긴다.
   */
  private scanUnsupported(entry?: {
    entryName: string;
    rawSource: unknown;
  }): [ScanStatus, ScanResult?] {
    const raw = entry?.rawSource as { source?: string } | null | undefined;
    if (raw?.source !== 'command') return ['UNSUPPORTED'];
    const content = JSON.stringify(
      { plugins: [{ name: entry!.entryName, source: raw }] },
      null,
      2,
    );
    return [
      'ANALYZED',
      scan({ files: [{ path: '.claude-plugin/marketplace.json', content }] }),
    ];
  }

  private async scanFiles(
    repo: { owner: string; name: string; head_sha: string },
    item: ScanItem,
    tree: GhTree,
  ): Promise<[ScanStatus, ScanResult?]> {
    if (tree.truncated) return ['TOO_LARGE'];
    const { files: picked, tooMany } = selectScanFiles(tree.entries, item.path);
    if (tooMany) return ['TOO_LARGE'];

    const loaded = new Map<string, ScanFile>();
    let bytes = 0;
    const load = async (e: TreeEntry) => {
      if (loaded.has(e.path)) return;
      // 상한 초과 파일은 받지 않고 truncated로 표시 → 엔진이 R16(분석 불가 실행파일)로 처리
      if (e.size > MAX_FILE_BYTES || bytes + e.size > MAX_ITEM_BYTES) {
        loaded.set(e.path, { path: e.path, content: '', truncated: true });
        return;
      }
      const text = await this.github.getFile(
        repo.owner,
        repo.name,
        repo.head_sha,
        e.path,
      );
      if (text === null) return;
      bytes += e.size;
      loaded.set(e.path, { path: e.path, content: text });
    };
    for (const e of picked) await load(e);

    const input = () => ({ files: [...loaded.values()], root: item.path });
    const active = await this.security.activeFingerprints(item.id);
    try {
      let result = scan(input(), active);
      // 훅이 참조하는 스크립트 중 1차 선택에서 빠진 것을 가져와 한 번 더(참조 깊이 1)
      const byPath = new Map(tree.entries.map((e) => [e.path, e]));
      const extra = result.notes
        .filter((n) => n.reason === 'MISSING_FILE' && n.ref)
        .map((n) => refToRepoPath(n.ref!, item.path))
        .flatMap((p) =>
          p && byPath.has(p) && !loaded.has(p) ? [byPath.get(p)!] : [],
        );
      if (extra.length) {
        for (const e of extra.slice(0, 20)) await load(e);
        result = scan(input(), active);
      }
      return ['ANALYZED', result];
    } catch (e) {
      this.logger.error(`엔진 예외 item=${item.id}: ${errorMessage(e)}`);
      return ['ERROR'];
    }
  }
}
