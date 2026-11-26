// 내 북마크와 "보안 등급 변경" 탭. 북마크는 NestJS만 쓴다(ai 롤은 읽지도 못함).
import { Injectable } from '@nestjs/common';
import { RiskLevel } from '@prisma/client';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/cursor/cursor.codec';
import { DomainException } from '../common/errors/domain-exception';
import { ITEM_CARD_SELECT, toItemCard } from '../catalog/item-card';
import { ruleTitleKo } from '../catalog/security-copy';
import { PrismaService } from '../prisma/prisma.service';

const CHANGES_LIMIT = 100;

@Injectable()
export class BookmarksService {
  constructor(private readonly prisma: PrismaService) {}

  /** 최근 저장순 keyset. (created_at, item_id) 복합 키 — 같은 ms에 저장된 북마크도 안정적으로 이어진다. */
  async list(userId: number, q: { cursor?: string; limit: number }) {
    const c = q.cursor
      ? decodeCursor(
          q.cursor,
          z.object({ c: z.iso.datetime(), id: z.number().int().positive() }),
        )
      : null;
    const rows = await this.prisma.bookmark.findMany({
      where: {
        userId,
        ...(c && {
          OR: [
            { createdAt: { lt: new Date(c.c) } },
            { createdAt: new Date(c.c), itemId: { lt: c.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { itemId: 'desc' }],
      take: q.limit + 1,
      select: {
        seenLevel: true,
        createdAt: true,
        itemId: true,
        item: { select: ITEM_CARD_SELECT },
      },
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((b) => ({
        item: toItemCard(b.item),
        seenLevel: b.seenLevel,
        createdAt: b.createdAt,
      })),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ c: last.createdAt.toISOString(), id: last.itemId })
          : null,
    };
  }

  async ids(userId: number) {
    const rows = await this.prisma.bookmark.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      select: { itemId: true },
    });
    return { itemIds: rows.map((r) => r.itemId) };
  }

  /**
   * 멱등 저장. `createMany(skipDuplicates)`의 생성 건수로 201/200을 가른다 —
   * 존재 확인 후 insert하면 동시 PUT 두 개가 모두 "없음"으로 보고 한쪽이 유니크 오류로 500이 된다.
   * seenLevel은 저장 시점의 등급(이후 변경을 "변경 탭"이 감지하는 기준점).
   */
  async put(userId: number, itemId: number) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, status: 'ACTIVE' },
      select: { currentLevel: true },
    });
    if (!item) {
      throw new DomainException(404, 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    }
    const { count } = await this.prisma.bookmark.createMany({
      data: [{ userId, itemId, seenLevel: item.currentLevel }],
      skipDuplicates: true,
    });
    return { created: count === 1, itemId, seenLevel: item.currentLevel };
  }

  async remove(userId: number, itemId: number): Promise<void> {
    await this.prisma.bookmark.deleteMany({ where: { userId, itemId } });
  }

  /**
   * 저장 시점과 현재 등급이 다른 북마크. `IS DISTINCT FROM`이라 null(미분석) ↔ 등급 변화도 잡는다
   * (`<>`는 null 비교가 UNKNOWN이라 놓친다). newFindings는 현재 검사에서 억제되지 않은 Finding(규칙별 1건).
   */
  async securityChanges(userId: number) {
    const changed = await this.prisma.$queryRaw<
      { item_id: number; seen_level: RiskLevel | null }[]
    >`SELECT b.item_id, b.seen_level
        FROM bookmark b JOIN item i ON i.id = b.item_id
       WHERE b.user_id = ${userId} AND i.current_level IS DISTINCT FROM b.seen_level
       ORDER BY i.level_changed_at DESC NULLS LAST, b.item_id DESC
       LIMIT ${CHANGES_LIMIT}`;
    if (changed.length === 0) return { items: [] };

    const items = await this.prisma.item.findMany({
      where: { id: { in: changed.map((c) => c.item_id) } },
      select: {
        ...ITEM_CARD_SELECT,
        levelChangedAt: true,
        currentScan: {
          select: {
            findings: {
              where: { suppressed: false },
              select: { ruleId: true, severity: true },
              orderBy: { id: 'asc' },
            },
          },
        },
      },
    });
    const byId = new Map(items.map((i) => [i.id, i]));

    return {
      items: changed.flatMap((c) => {
        const i = byId.get(c.item_id);
        if (!i) return [];
        const seen = new Set<string>();
        const newFindings = (i.currentScan?.findings ?? []).filter((f) =>
          seen.has(f.ruleId) ? false : !!seen.add(f.ruleId),
        );
        return [
          {
            item: toItemCard(i),
            seenLevel: c.seen_level,
            currentLevel: i.currentLevel,
            levelChangedAt: i.levelChangedAt,
            newFindings: newFindings.map((f) => ({
              ruleId: f.ruleId,
              titleKo: ruleTitleKo(f.ruleId),
              severity: f.severity,
            })),
          },
        ];
      }),
    };
  }

  /** 확인 처리: seenLevel을 현재 등급으로 맞춘다. itemIds 생략 = 내 북마크 전부. */
  async ack(userId: number, itemIds?: number[]): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE bookmark b SET seen_level = i.current_level
        FROM item i
       WHERE b.item_id = i.id AND b.user_id = ${userId}
         AND (${itemIds ?? null}::int[] IS NULL OR b.item_id = ANY(${itemIds ?? null}::int[]))`;
  }
}
