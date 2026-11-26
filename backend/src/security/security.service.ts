// 검사 결과 저장·Override 트랜잭션·등급 재계산. 등급 판정은 항상 engine의 aggregate()를 거친다(판정 경로에 LLM 없음).
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, RiskLevel, ScanStatus } from '@prisma/client';
import { decodeCursor, encodeCursor } from '../common/cursor/cursor.codec';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';
import { aggregate, type ScanResult, type Severity } from './engine';
import { z } from 'zod';

type Tx = Prisma.TransactionClient;

const cursorSchema = z.object({ id: z.number().int().positive() });

/** 항목의 현재 등급을 바꾼다. 등급이 실제로 달라질 때만 levelChangedAt을 갱신 → 북마크 "등급 변경" 탭의 기준. */
async function applyItemLevel(
  tx: Tx,
  itemId: number,
  level: RiskLevel | null,
): Promise<{ currentLevel: RiskLevel | null; levelChangedAt: Date | null }> {
  const cur = await tx.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { currentLevel: true, levelChangedAt: true },
  });
  if (cur.currentLevel === level) return { ...cur };
  const item = await tx.item.update({
    where: { id: itemId },
    data: { currentLevel: level, levelChangedAt: new Date() },
    select: { currentLevel: true, levelChangedAt: true },
  });
  return item;
}

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 항목의 활성 Override 지문들. 새 검사에서 같은 지문의 Finding을 억제하는 데 쓴다. */
  async activeFingerprints(itemId: number): Promise<string[]> {
    const rows = await this.prisma.securityOverride.findMany({
      where: { itemId, revokedAt: null },
      select: { fingerprint: true },
    });
    return rows.map((r) => r.fingerprint);
  }

  /**
   * 검사 결과를 저장하고 항목의 현재 검사·등급을 갱신한다(한 트랜잭션).
   * (item, headSha, ruleSetVersion)이 자연키 — 이미 있으면 아무것도 쓰지 않는다(멱등).
   * 분석 불가 상태(UNSUPPORTED/TOO_LARGE/ERROR)는 result 없이 호출하며 level은 null.
   */
  async saveScan(
    itemId: number,
    headSha: string,
    ruleSetVersion: string,
    status: ScanStatus,
    result?: ScanResult,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const exists = await tx.securityScan.findUnique({
        where: {
          itemId_headSha_ruleSetVersion: { itemId, headSha, ruleSetVersion },
        },
        select: { id: true },
      });
      if (exists) return;
      const scan = await tx.securityScan.create({
        data: {
          itemId,
          headSha,
          ruleSetVersion,
          status,
          rawLevel: result?.rawLevel ?? null,
          level: result?.level ?? null,
          findingCount: result?.findings.length ?? 0,
          findings: {
            create: (result?.findings ?? []).map((f) => ({
              ruleId: f.ruleId,
              severity: f.severity,
              filePath: f.filePath,
              line: f.line,
              excerpt: f.excerpt,
              fingerprint: f.fingerprint,
              suppressed: f.suppressed,
            })),
          },
        },
      });
      const { currentLevel } = await tx.item.findUniqueOrThrow({
        where: { id: itemId },
        select: { currentLevel: true },
      });
      const level = result?.level ?? null;
      await tx.item.update({
        where: { id: itemId },
        data: {
          currentScanId: scan.id,
          hasExternalMcp:
            result?.findings.some(
              (f) => f.ruleId === 'R12_MCP_EXTERNAL_SERVER',
            ) ?? false,
          ...(currentLevel !== level
            ? { currentLevel: level, levelChangedAt: new Date() }
            : {}),
        },
      });
    });
  }

  /** 현재 검사의 Finding을 다시 집계해 검사·항목 등급까지 반영(Override 생성/철회 공용). */
  private async recompute(tx: Tx, itemId: number) {
    const item = await tx.item.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        currentScanId: true,
        currentScan: { select: { status: true } },
      },
    });
    if (!item.currentScanId || item.currentScan?.status !== 'ANALYZED') {
      return applyItemLevel(tx, itemId, null);
    }
    const findings = await tx.securityFinding.findMany({
      where: { scanId: item.currentScanId },
      select: { severity: true, suppressed: true },
    });
    // DB 컬럼은 RiskLevel이지만 Finding 등급은 CAUTION|DANGER만 저장된다(엔진 불변식)
    const { level } = aggregate(
      findings as { severity: Severity; suppressed: boolean }[],
    );
    await tx.securityScan.update({
      where: { id: item.currentScanId },
      data: { level },
    });
    return applyItemLevel(tx, itemId, level);
  }

  /**
   * Override 생성. 한 트랜잭션: override 행 → Finding.suppressed → 검사 level → 항목 currentLevel.
   * 활성 중복은 activeKey 유니크가 막는다(check-then-insert 경합 없음).
   * @throws DomainException 404 NOT_FOUND / FINDING_NOT_FOUND, 409 OVERRIDE_EXISTS
   */
  async createOverride(
    userId: number,
    body: {
      itemId: number;
      fingerprint: string;
      reason: string;
      appealUrl?: string;
    },
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.item.findUnique({
          where: { id: body.itemId },
          select: { currentScanId: true },
        });
        if (!item) {
          throw new DomainException(
            404,
            'NOT_FOUND',
            '항목을 찾을 수 없습니다.',
          );
        }
        const finding = item.currentScanId
          ? await tx.securityFinding.findFirst({
              where: {
                scanId: item.currentScanId,
                fingerprint: body.fingerprint,
              },
              select: { ruleId: true },
            })
          : null;
        if (!finding) {
          throw new DomainException(
            404,
            'FINDING_NOT_FOUND',
            '현재 검사에 없는 지문입니다.',
          );
        }
        const override = await tx.securityOverride.create({
          data: {
            itemId: body.itemId,
            fingerprint: body.fingerprint,
            ruleId: finding.ruleId,
            reason: body.reason,
            appealUrl: body.appealUrl ?? null,
            activeKey: `${body.itemId}:${body.fingerprint}`,
            createdById: userId,
          },
        });
        await tx.securityFinding.updateMany({
          where: { scanId: item.currentScanId!, fingerprint: body.fingerprint },
          data: { suppressed: true },
        });
        return { override, item: await this.recompute(tx, body.itemId) };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new DomainException(
          409,
          'OVERRIDE_EXISTS',
          '이미 활성 Override가 있습니다.',
        );
      }
      throw e;
    }
  }

  /**
   * Override 철회(행은 남긴다 — 감사 기록). activeKey를 비워 같은 지문에 다시 Override를 만들 수 있게 한다.
   * 이미 철회된 것은 그대로 200(멱등). reason은 저장 컬럼이 없어 로그로만 남긴다.
   */
  async revokeOverride(id: number, userId: number, reason?: string) {
    return this.prisma.$transaction(async (tx) => {
      const found = await tx.securityOverride.findUnique({ where: { id } });
      if (!found) {
        throw new DomainException(
          404,
          'NOT_FOUND',
          'Override를 찾을 수 없습니다.',
        );
      }
      if (found.revokedAt) {
        const { currentLevel } = await tx.item.findUniqueOrThrow({
          where: { id: found.itemId },
          select: { currentLevel: true },
        });
        return { override: found, item: { currentLevel } };
      }
      const override = await tx.securityOverride.update({
        where: { id },
        data: { revokedAt: new Date(), revokedById: userId, activeKey: null },
      });
      const { currentScanId } = await tx.item.findUniqueOrThrow({
        where: { id: found.itemId },
        select: { currentScanId: true },
      });
      if (currentScanId) {
        await tx.securityFinding.updateMany({
          where: { scanId: currentScanId, fingerprint: found.fingerprint },
          data: { suppressed: false },
        });
      }
      if (reason) this.logger.log(`override ${id} 철회 사유: ${reason}`);
      const { currentLevel } = await this.recompute(tx, found.itemId);
      return { override, item: { currentLevel } };
    });
  }

  async listOverrides(q: {
    itemId?: number;
    active?: boolean;
    cursor?: string;
    limit: number;
  }) {
    const c = q.cursor ? decodeCursor(q.cursor, cursorSchema) : null;
    const rows = await this.prisma.securityOverride.findMany({
      where: {
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.active === undefined
          ? {}
          : { revokedAt: q.active ? null : { not: null } }),
        ...(c ? { id: { lt: c.id } } : {}),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
      include: {
        item: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((o) => ({
        id: o.id,
        item: o.item,
        ruleId: o.ruleId,
        fingerprint: o.fingerprint,
        reason: o.reason,
        appealUrl: o.appealUrl,
        createdBy: o.createdBy,
        createdAt: o.createdAt,
        revokedAt: o.revokedAt,
      })),
      nextCursor:
        rows.length > q.limit
          ? encodeCursor({ id: page[page.length - 1].id })
          : null,
    };
  }
}
