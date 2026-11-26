// 관리자: 데이터 품질 요약·이슈 목록·처리. 이슈 생성은 배치(quality 단계)만 한다.
import { Injectable } from '@nestjs/common';
import { DataQualityKind, IssueStatus } from '@prisma/client';
import { z } from 'zod';
import { decodeCursor, encodeCursor } from '../common/cursor/cursor.codec';
import { PrismaService } from '../prisma/prisma.service';

const cursorSchema = z.object({
  c: z.iso.datetime(),
  id: z.number().int().positive(),
});
const statsSchema = z.object({
  ghCoreUsed: z.number().default(0),
  ghSearchUsed: z.number().default(0),
  ghCodeSearchUsed: z.number().default(0),
});
const MICROS = 1_000_000;

@Injectable()
export class DataQualityService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const [open, lastRun, usage] = await Promise.all([
      this.prisma.dataQualityIssue.groupBy({
        by: ['kind'],
        where: { status: 'OPEN' },
        _count: { _all: true },
      }),
      this.prisma.ingestionRun.findFirst({
        orderBy: { id: 'desc' },
        include: { stageRows: { select: { stats: true } } },
      }),
      // ai 스키마는 계약 뷰만 읽을 수 있다. 하루 경계는 UTC(FastAPI 예산 원장과 동일).
      this.prisma.$queryRaw<
        {
          pool: string;
          cap_micros: bigint;
          spent_micros: bigint;
          reserved_micros: bigint;
          calls: bigint;
        }[]
      >`SELECT pool, cap_micros, spent_micros, reserved_micros, calls
          FROM ai.v_ai_usage_daily
         WHERE day = (now() AT TIME ZONE 'utc')::date
         ORDER BY pool`,
    ]);

    const openByKind = Object.fromEntries(
      Object.values(DataQualityKind).map((k) => [k, 0]),
    );
    for (const o of open) openByKind[o.kind] = o._count._all;

    // 단계별 stats(JSON)에 흩어진 GitHub 사용량을 실행 단위로 합친다.
    const used = { ghCoreUsed: 0, ghSearchUsed: 0, ghCodeSearchUsed: 0 };
    for (const s of lastRun?.stageRows ?? []) {
      const st = statsSchema.safeParse(s.stats);
      if (!st.success) continue;
      used.ghCoreUsed += st.data.ghCoreUsed;
      used.ghSearchUsed += st.data.ghSearchUsed;
      used.ghCodeSearchUsed += st.data.ghCodeSearchUsed;
    }

    return {
      openByKind,
      lastRun: lastRun
        ? { id: lastRun.id, status: lastRun.status, ...used }
        : null,
      aiUsageToday: usage.map((u) => ({
        pool: u.pool,
        capUsd: Number(u.cap_micros) / MICROS,
        spentUsd: Number(u.spent_micros) / MICROS,
        reservedUsd: Number(u.reserved_micros) / MICROS,
        calls: Number(u.calls),
      })),
      externalSource: {
        name: process.env.EXTERNAL_STAR_SOURCE || 'none',
        activeUntil: process.env.EXTERNAL_STAR_SOURCE_UNTIL ?? null,
      },
    };
  }

  async listIssues(q: {
    status: IssueStatus;
    kind?: DataQualityKind;
    cursor?: string;
    limit: number;
  }) {
    const c = q.cursor ? decodeCursor(q.cursor, cursorSchema) : null;
    const rows = await this.prisma.dataQualityIssue.findMany({
      where: {
        status: q.status,
        kind: q.kind,
        ...(c && {
          OR: [
            { createdAt: { lt: new Date(c.c) } },
            { createdAt: new Date(c.c), id: { lt: c.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      include: { repo: { select: { id: true, owner: true, name: true } } },
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map((i) => ({
        id: i.id,
        kind: i.kind,
        repo: { id: i.repo.id, fullName: `${i.repo.owner}/${i.repo.name}` },
        windowStart: i.windowStart.toISOString().slice(0, 10),
        windowEnd: i.windowEnd.toISOString().slice(0, 10),
        values: i.values,
        diff: i.diff,
        status: i.status,
        note: i.note,
        createdAt: i.createdAt,
      })),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ c: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** 이슈 처리. 대상이 없으면 Prisma P2025 → 필터가 404로 변환한다. */
  async resolve(
    id: number,
    adminId: number,
    body: { status: 'RESOLVED' | 'IGNORED'; note: string },
  ) {
    const i = await this.prisma.dataQualityIssue.update({
      where: { id },
      data: {
        status: body.status,
        note: body.note,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });
    return {
      id: i.id,
      status: i.status,
      note: i.note,
      resolvedAt: i.resolvedAt,
    };
  }
}
