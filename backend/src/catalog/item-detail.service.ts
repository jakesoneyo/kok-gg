// 항목 상세(쿼리 고정)와 스타 시계열.
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';
import { toTrendMap } from './catalog.service';
import { DISCLAIMER_KO, ruleTitleKo } from './security-copy';

/** 계약 뷰 ai.v_item_summary_public 행. NestJS는 이 뷰만 읽을 수 있다(DB 권한). */
const summaryRowSchema = z.object({
  status: z.enum(['OK', 'INSUFFICIENT', 'FAILED']),
  summary_ko: z.string().nullable(),
  use_cases_ko: z.array(z.string()),
  install_commands: z.array(
    z.union([z.string(), z.object({ command: z.string() }).loose()]),
  ),
  requirements_ko: z.array(z.string()),
  model: z.string(),
  generated_at: z.date(),
});

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

@Injectable()
export class ItemDetailService {
  private readonly logger = new Logger(ItemDetailService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 상세 화면 쿼리: ① item+repo+현재 검사+Finding+트렌드(join 1회) ② 활성 Override ③ 마켓플레이스 + 요약 뷰 raw 1회.
   * 개수는 IT-16이 단언한다.
   */
  async detail(id: number) {
    const item = await this.prisma.item.findFirst({
      relationLoadStrategy: 'join', // 관계를 별도 왕복이 아닌 JOIN 1회로(쿼리 수 단언 대상)
      where: { id, status: 'ACTIVE' },
      include: {
        repo: {
          include: {
            trendScores: {
              orderBy: [{ asOf: 'desc' }, { window: 'asc' }],
              take: 3,
            },
          },
        },
        currentScan: { include: { findings: { orderBy: { id: 'asc' } } } },
      },
    });
    if (!item) {
      throw new DomainException(404, 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    }

    const [overrides, entries, summaryRows] = await Promise.all([
      this.prisma.securityOverride.findMany({
        where: { itemId: id, revokedAt: null },
      }),
      this.prisma.marketplaceEntry.findMany({
        relationLoadStrategy: 'join',
        where: { itemId: id },
        select: { marketplace: { select: { name: true, repo: true } } },
      }),
      this.prisma.$queryRaw<unknown[]>`
        SELECT status, summary_ko, use_cases_ko, install_commands, requirements_ko, model, generated_at
          FROM ai.v_item_summary_public WHERE item_id = ${id}`,
    ]);

    const byFingerprint = new Map(overrides.map((o) => [o.fingerprint, o]));
    const scan = item.currentScan;
    const analyzed = scan?.status === 'ANALYZED';

    return {
      item: {
        id: item.id,
        kind: item.kind,
        name: item.name,
        path: item.path,
        description: item.description,
        sourceType: item.sourceType,
        components: item.components,
        hasExternalMcp: item.hasExternalMcp,
        firstSeenAt: item.firstSeenAt,
      },
      repo: {
        id: item.repo.id,
        fullName: `${item.repo.owner}/${item.repo.name}`,
        url: `https://github.com/${item.repo.owner}/${item.repo.name}`,
        stars: item.repo.stars,
        pushedAt: item.repo.pushedAt,
        defaultBranch: item.repo.defaultBranch,
        headSha: item.repo.headSha,
        archived: item.repo.archived,
      },
      marketplaces: entries.map(({ marketplace: m }) => ({
        repoFullName: `${m.repo.owner}/${m.repo.name}`,
        name: m.name,
      })),
      security: scan
        ? {
            status: scan.status,
            level: analyzed ? item.currentLevel : null,
            rawLevel: analyzed ? scan.rawLevel : null,
            ruleSetVersion: scan.ruleSetVersion,
            headSha: scan.headSha,
            scannedAt: scan.scannedAt,
            findings: analyzed
              ? scan.findings.map((f) => {
                  const o = byFingerprint.get(f.fingerprint);
                  return {
                    ruleId: f.ruleId,
                    titleKo: ruleTitleKo(f.ruleId),
                    severity: f.severity,
                    filePath: f.filePath,
                    line: f.line,
                    excerpt: f.excerpt,
                    fingerprint: f.fingerprint,
                    suppressed: f.suppressed,
                    override: o
                      ? {
                          reason: o.reason,
                          appealUrl: o.appealUrl,
                          createdAt: o.createdAt,
                        }
                      : null,
                  };
                })
              : [],
            disclaimerKo: DISCLAIMER_KO,
          }
        : null,
      summary: this.toSummary(summaryRows[0]),
      trend: toTrendMap(item.repo.trendScores),
    };
  }

  private toSummary(row: unknown) {
    if (!row) return null;
    const parsed = summaryRowSchema.safeParse(row);
    if (!parsed.success) {
      // 계약 뷰가 어긋나도 상세 화면 전체를 죽이지 않고 요약만 비운다.
      this.logger.error({ err: parsed.error }, '요약 뷰 행이 계약과 다름');
      return null;
    }
    const r = parsed.data;
    return {
      status: r.status,
      summaryKo: r.summary_ko,
      useCasesKo: r.use_cases_ko,
      // warnings(설치 명령 위험 신호)는 보안 엔진 연동(C4)에서 채운다.
      installCommands: r.install_commands.map((c) => ({
        command: typeof c === 'string' ? c : c.command,
        warnings: [] as string[],
      })),
      requirementsKo: r.requirements_ko,
      model: r.model,
      generatedAt: r.generated_at,
    };
  }

  /**
   * 일별 스타 증가량 시계열. 규칙(ARCHITECTURE 4.2): 전일·당일 스냅샷이 모두 있으면 차분,
   * 아니면 공식 기록, 둘 다 없으면 null(모름 — 0이나 누적 차분으로 메우지 않는다).
   *
   * ponytail: C2 `dailyGains()`가 병합되면 이 계산을 그 함수 호출로 교체한다(같은 규칙의 3줄 복제).
   */
  async stars(id: number, days: number) {
    const item = await this.prisma.item.findFirst({
      where: { id, status: 'ACTIVE' },
      select: { repoId: true },
    });
    if (!item) {
      throw new DomainException(404, 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    }
    const today = new Date(isoDay(new Date()));
    const from = new Date(today.getTime() - (days - 1) * DAY_MS);
    const rows = await this.prisma.repoStarDay.findMany({
      where: {
        repoId: item.repoId,
        day: { gte: new Date(from.getTime() - DAY_MS) }, // 첫날 차분용 전일 포함
      },
    });
    const byDay = new Map(rows.map((r) => [isoDay(r.day), r]));

    const series = Array.from({ length: days }, (_, i) => {
      const d = new Date(from.getTime() + i * DAY_MS);
      const cur = byDay.get(isoDay(d));
      const prev = byDay.get(isoDay(new Date(d.getTime() - DAY_MS)));
      const total = cur?.snapshotTotal ?? null;
      if (total !== null && prev?.snapshotTotal != null) {
        return {
          day: isoDay(d),
          gain: total - prev.snapshotTotal,
          total,
          source: 'SNAPSHOT' as const,
        };
      }
      if (cur?.officialAdded != null) {
        return {
          day: isoDay(d),
          gain: cur.officialAdded,
          total,
          source: 'OFFICIAL' as const,
        };
      }
      return { day: isoDay(d), gain: null, total, source: null };
    });
    return { repoId: item.repoId, series };
  }
}
