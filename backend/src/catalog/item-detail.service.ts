// 항목 상세(쿼리 고정)와 스타 시계열.
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';
import { commandWarnings } from '../security/command-warnings';
import { DISCLAIMER_KO, ruleTitleKo } from '../security/security-copy';
import { addDays } from '../trending/algo/dates';
import { dailyGains } from '../trending/algo/gains';
import { toTrendMap } from './catalog.service';

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
      // 요약이 인용한 설치 명령도 같은 규칙 엔진(shell 영역)으로 검사해 경고를 붙인다.
      installCommands: r.install_commands.map((c) => {
        const command = typeof c === 'string' ? c : c.command;
        return { command, warnings: commandWarnings(command) };
      }),
      requirementsKo: r.requirements_ko,
      model: r.model,
      generatedAt: r.generated_at,
    };
  }

  /**
   * 일별 스타 증가량 시계열. 증가량 규칙(스냅샷 차분 > 공식 기록 > 모름 null)은 C2 `dailyGains()`가 단일 원천이다.
   * 여기서는 출처 라벨(source)과 총합만 덧붙인다.
   */
  async stars(id: number, days: number) {
    const item = await this.prisma.item.findFirst({
      where: { id, status: 'ACTIVE' },
      select: { repoId: true },
    });
    if (!item) {
      throw new DomainException(404, 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    }
    const to = isoDay(new Date());
    const from = addDays(to, -(days - 1));
    const found = await this.prisma.repoStarDay.findMany({
      where: {
        repoId: item.repoId,
        day: { gte: new Date(addDays(from, -1)) }, // 첫날 차분용 전일 포함
      },
    });
    const rows = found.map((r) => ({
      day: isoDay(r.day),
      snapshotTotal: r.snapshotTotal,
      officialAdded: r.officialAdded,
    }));
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const series = dailyGains(rows, from, to).map((gain, i) => {
      const day = addDays(from, i);
      const cur = byDay.get(day);
      const bothSnapshots =
        cur?.snapshotTotal != null &&
        byDay.get(addDays(day, -1))?.snapshotTotal != null;
      return {
        day,
        gain,
        total: cur?.snapshotTotal ?? null,
        source:
          gain === null
            ? null
            : bothSnapshots
              ? ('SNAPSHOT' as const)
              : ('OFFICIAL' as const),
      };
    });
    return { repoId: item.repoId, series };
  }
}
