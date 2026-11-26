// 저장소 1개 판별: 트리 1회 + 증거 JSON 읽기 → classify → Item·마켓플레이스 upsert. qualify(신규)와 fetch-content(변경분)가 공유한다.
import { Inject, Injectable } from '@nestjs/common';
import { GithubClient } from '../github/github.client';
import {
  MAX_FILE_BYTES,
  type GhRepo,
  type GhTree,
} from '../github/github.types';
import { PrismaService } from '../prisma/prisma.service';
import { CandidatesService } from './candidates.service';
import { classify, evidenceFiles, type ClassifyResult } from './classify';
import { INGEST_CONFIG, type IngestConfig } from './ingest.config';

export interface RepoRef {
  id: number;
  owner: string;
  name: string;
}

export type InspectResult =
  | { tooLarge: true }
  | { tooLarge: false; tree: GhTree; result: ClassifyResult };

const EVIDENCE_READ_CAP = 40;
const key = (owner: string, name: string) => `${owner}/${name}`.toLowerCase();

@Injectable()
export class RepoInspector {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubClient,
    private readonly candidates: CandidatesService,
    @Inject(INGEST_CONFIG) private readonly config: IngestConfig,
  ) {}

  /**
   * @param ref 트리를 읽을 커밋(신규 판별은 'HEAD', 변경 반영은 스냅샷의 headSha)
   * 트리가 잘렸으면(초대형 저장소) 아무것도 쓰지 않고 tooLarge를 돌려준다 — 호출 측이 상태를 TOO_LARGE로 바꾼다.
   * 마켓플레이스가 가리키는 다른 저장소는 Candidate로 등록하고 그 저장소에 Item을 귀속시킨다.
   */
  async inspect(repo: RepoRef, ref: string): Promise<InspectResult> {
    const tree = await this.github.getTree(repo.owner, repo.name, ref);
    if (tree.truncated) return { tooLarge: true };

    const paths = tree.entries.map((e) => e.path);
    const files: Record<string, string> = {};
    const sizeOf = new Map(tree.entries.map((e) => [e.path, e.size]));
    // 증거 JSON은 작아야 정상 — 상한 초과는 읽지 않는다(REVIEW Y9)
    const evidence = evidenceFiles(paths).filter(
      (p) => (sizeOf.get(p) ?? 0) <= MAX_FILE_BYTES,
    );
    for (const p of evidence.slice(0, EVIDENCE_READ_CAP)) {
      const text = await this.github.getFile(repo.owner, repo.name, ref, p);
      if (text !== null) files[p] = text;
    }
    const result = classify({
      repoName: repo.name,
      paths,
      files,
      maxItems: this.config.maxItemsPerRepo,
    });
    await this.persist(repo, result);
    return { tooLarge: false, tree, result };
  }

  private async persist(repo: RepoRef, result: ClassifyResult): Promise<void> {
    // 다른 저장소 참조: 이미 아는 저장소는 재조회하지 않고, 모르는 것만 getRepo로 Candidate 등록
    const known = await this.prisma.repo.findMany({
      where: {
        fullNameLower: { in: result.refs.map((r) => key(r.owner, r.name)) },
      },
      select: { id: true, fullNameLower: true },
    });
    const repoIds = new Map<string, number>(
      known.map((r) => [r.fullNameLower, r.id]),
    );
    const fresh: GhRepo[] = [];
    for (const r of result.refs) {
      if (repoIds.has(key(r.owner, r.name))) continue;
      const gh = await this.github.getRepo(`${r.owner}/${r.name}`);
      if (gh) fresh.push(gh);
    }
    for (const [k, id] of (
      await this.candidates.upsertCandidates(fresh, 'MARKETPLACE_REF')
    ).ids)
      repoIds.set(k, id);
    repoIds.set(key(repo.owner, repo.name), repo.id);

    const kept = result.items.filter((i) =>
      repoIds.has(
        key(i.target?.owner ?? repo.owner, i.target?.name ?? repo.name),
      ),
    );
    const itemIds = new Map<string, number>();
    const idKey = (i: {
      kind: string;
      path: string;
      target?: { owner: string; name: string };
    }) =>
      `${i.target ? key(i.target.owner, i.target.name) : key(repo.owner, repo.name)}|${i.kind}|${i.path}`;

    await this.prisma.$transaction(
      async (tx) => {
        for (const i of kept) {
          const repoId = repoIds.get(idKey(i).split('|')[0])!;
          const row = await tx.item.upsert({
            where: { repoId_kind_path: { repoId, kind: i.kind, path: i.path } },
            create: {
              repoId,
              kind: i.kind,
              path: i.path,
              name: i.name,
              description: i.description,
              sourceType: i.sourceType,
              components: { ...i.components },
            },
            // 다른 저장소가 마켓플레이스로 가리킨 항목은 그 저장소 자신의 트리 판별이 정본이다 —
            // 여기서 sourceType·이름을 덮어쓰면 두 저장소가 번갈아 상대 값을 되돌린다.
            update: i.target
              ? { status: 'ACTIVE' }
              : {
                  name: i.name,
                  sourceType: i.sourceType,
                  components: { ...i.components },
                  status: 'ACTIVE',
                  // fetch-content가 SKILL.md에서 채운 설명을 빈 값으로 덮어쓰지 않는다
                  ...(i.description ? { description: i.description } : {}),
                },
            select: { id: true },
          });
          itemIds.set(idKey(i), row.id);
        }

        // 이 저장소 안에서 사라진 IN_REPO 항목은 REMOVED(물리 삭제 없음 — 북마크·이력 보존)
        await tx.item.updateMany({
          where: {
            repoId: repo.id,
            sourceType: 'IN_REPO',
            status: 'ACTIVE',
            id: {
              notIn: [...itemIds.entries()]
                .filter(([k]) => k.startsWith(`${key(repo.owner, repo.name)}|`))
                .map(([, id]) => id),
            },
          },
          data: { status: 'REMOVED' },
        });
        await tx.repo.update({
          where: { id: repo.id },
          data: { truncated: result.truncated },
        });

        for (const m of result.marketplaces) {
          const entries = m.entries.flatMap((e) => {
            const itemId = itemIds.get(idKey(e.item));
            return itemId
              ? [{ entryName: e.entryName, itemId, rawSource: e.rawSource }]
              : [];
          });
          const mp = await tx.marketplace.upsert({
            where: { repoId_path: { repoId: repo.id, path: m.path } },
            create: {
              repoId: repo.id,
              path: m.path,
              name: m.name,
              ownerName: m.ownerName,
              pluginCount: m.entries.length,
            },
            update: {
              name: m.name,
              ownerName: m.ownerName,
              pluginCount: m.entries.length,
            },
          });
          for (const e of entries) {
            await tx.marketplaceEntry.upsert({
              where: {
                marketplaceId_entryName: {
                  marketplaceId: mp.id,
                  entryName: e.entryName,
                },
              },
              create: {
                marketplaceId: mp.id,
                ...e,
                rawSource: e.rawSource ?? {},
              },
              update: {
                itemId: e.itemId,
                rawSource: e.rawSource ?? {},
              },
            });
          }
        }
      },
      { timeout: 60_000 },
    );
  }
}
