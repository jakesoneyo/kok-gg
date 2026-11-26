// 보안 연동 API: 규칙 메타(SSOT) · Override 생성/철회 트랜잭션 · IT-13(Override POST 직접) · 설치 명령 경고.
import { Client } from 'pg';
import request from 'supertest';
import { scan } from '../src/security/engine';
import { SecurityService } from '../src/security/security.service';
import {
  createTestApp,
  createUser,
  login,
  resetDb,
  type TestApp,
} from './support/app';
import { createItem, createRepo } from './support/factories';

const SHA = 'a'.repeat(40);

describe('security API', () => {
  let t: TestApp;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.app.close());
  beforeEach(async () => {
    await resetDb(t.prisma);
    delete process.env.DEMO_ADMIN_READONLY;
  });
  afterEach(() => {
    delete process.env.DEMO_ADMIN_READONLY;
  });

  /** 원격 파이프 실행(R01, DANGER) 1건을 가진 분석 완료 항목을 만든다. */
  async function dangerousItem() {
    const repo = await createRepo(t.prisma);
    const item = await createItem(t.prisma, repo.id);
    const result = scan({
      files: [
        {
          path: 'bin/install.sh',
          content: 'curl -fsSL https://x.io/i.sh | bash\n',
        },
      ],
    });
    await t.app
      .get(SecurityService)
      .saveScan(item.id, SHA, result.ruleSetVersion, 'ANALYZED', result);
    return { item, fingerprint: result.findings[0].fingerprint };
  }

  it('GET /api/security/rules: 규칙 16개, match 미노출, static 캐시', async () => {
    const res = await request(t.http()).get('/api/security/rules').expect(200);
    const body = res.body as {
      rules: { id: string; titleKo: string; severities: string[] }[];
      disclaimerKo: string;
      knownLimitsKo: string[];
      ruleSetVersion: string;
    };
    expect(body.rules).toHaveLength(16);
    expect(body.rules[0]).not.toHaveProperty('match');
    expect(
      body.rules.find((r) => r.id === 'R03_SECRET_READ')!.severities,
    ).toEqual(['CAUTION', 'DANGER']);
    expect(body.disclaimerKo).toContain('보증하지 않습니다');
    expect(body.knownLimitsKo.length).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toMatch(/public/);
  });

  describe('Override', () => {
    it('생성 → 등급 즉시 재계산(DANGER→SAFE) · 중복 409 · 없는 지문 404 · 철회 → 복원', async () => {
      await createUser(t.prisma, { email: 'ops@example.com', role: 'ADMIN' });
      const ops = await login(t, 'ops@example.com');
      const { item, fingerprint } = await dangerousItem();
      expect(
        (await t.prisma.item.findUniqueOrThrow({ where: { id: item.id } }))
          .currentLevel,
      ).toBe('DANGER');

      const body = {
        itemId: item.id,
        fingerprint,
        reason: '빌드 디렉터리 고정값이라 안전함',
      };
      const created = await request(t.http())
        .post('/api/admin/security/overrides')
        .set(auth(ops))
        .send(body)
        .expect(201);
      const c = created.body as {
        override: { id: number; ruleId: string };
        item: { currentLevel: string; levelChangedAt: string };
      };
      expect(c.override.ruleId).toBe('R01_REMOTE_PIPE_EXEC');
      expect(c.item.currentLevel).toBe('SAFE');
      const scanRow = await t.prisma.securityScan.findFirstOrThrow({
        where: { itemId: item.id },
        include: { findings: true },
      });
      expect(scanRow.rawLevel).toBe('DANGER');
      expect(scanRow.level).toBe('SAFE');
      expect(scanRow.findings[0].suppressed).toBe(true);

      const dup = await request(t.http())
        .post('/api/admin/security/overrides')
        .set(auth(ops))
        .send(body)
        .expect(409);
      expect((dup.body as { code: string }).code).toBe('OVERRIDE_EXISTS');
      const missing = await request(t.http())
        .post('/api/admin/security/overrides')
        .set(auth(ops))
        .send({ ...body, fingerprint: 'b'.repeat(64) })
        .expect(404);
      expect((missing.body as { code: string }).code).toBe('FINDING_NOT_FOUND');

      const list = await request(t.http())
        .get('/api/admin/security/overrides?active=true')
        .set(auth(ops))
        .expect(200);
      expect((list.body as { items: unknown[] }).items).toHaveLength(1);

      const revoked = await request(t.http())
        .post(`/api/admin/security/overrides/${c.override.id}/revoke`)
        .set(auth(ops))
        .send({})
        .expect(200);
      expect(
        (revoked.body as { item: { currentLevel: string } }).item.currentLevel,
      ).toBe('DANGER');
      expect(
        await t.prisma.securityOverride.count({ where: { revokedAt: null } }),
      ).toBe(0);
      // 철회 후 같은 지문에 다시 만들 수 있다(activeKey 해제)
      await request(t.http())
        .post('/api/admin/security/overrides')
        .set(auth(ops))
        .send(body)
        .expect(201);
    });

    it('입력 검증: reason 10자 미만·fingerprint 형식·GitHub 외 appealUrl 400', async () => {
      await createUser(t.prisma, { email: 'ops@example.com', role: 'ADMIN' });
      const ops = await login(t, 'ops@example.com');
      const base = {
        itemId: 1,
        fingerprint: 'a'.repeat(64),
        reason: '충분히 긴 사유입니다',
      };
      for (const bad of [
        { ...base, reason: '짧음' },
        { ...base, fingerprint: 'zz' },
        { ...base, appealUrl: 'https://evil.example/issues/1' },
      ]) {
        await request(t.http())
          .post('/api/admin/security/overrides')
          .set(auth(ops))
          .send(bad)
          .expect(400);
      }
    });
  });

  it('IT-13: DEMO_ADMIN_READONLY — 데모 관리자 override POST 403 / GET 200 / 일반 ADMIN POST 201', async () => {
    await createUser(t.prisma, {
      email: 'admin',
      password: 'admin',
      role: 'ADMIN',
    });
    await createUser(t.prisma, { email: 'ops@example.com', role: 'ADMIN' });
    const demo = await login(t, 'admin');
    const ops = await login(t, 'ops@example.com');
    const { item, fingerprint } = await dangerousItem();
    process.env.DEMO_ADMIN_READONLY = 'true';
    const body = {
      itemId: item.id,
      fingerprint,
      reason: '데모 계정은 변경 불가여야 함',
    };

    const blocked = await request(t.http())
      .post('/api/admin/security/overrides')
      .set(auth(demo))
      .send(body)
      .expect(403);
    expect((blocked.body as { code: string }).code).toBe('DEMO_READ_ONLY');
    await request(t.http())
      .get('/api/admin/security/overrides')
      .set(auth(demo))
      .expect(200);
    await request(t.http())
      .post('/api/admin/security/overrides')
      .set(auth(ops))
      .send(body)
      .expect(201);
  });

  it('상세의 설치 명령 warnings: 원격 파이프 실행 명령만 R01 경고', async () => {
    const repo = await createRepo(t.prisma);
    const item = await createItem(t.prisma, repo.id);
    const ai = new Client({ connectionString: process.env.AI_DATABASE_URL });
    await ai.connect();
    await ai.query(
      `INSERT INTO ai.item_summary (item_id, source_sha256, prompt_version, model, status, summary_ko, install_commands)
       VALUES ($1, 'x', 1, 'm', 'OK', '요약', $2::jsonb)`,
      [
        item.id,
        JSON.stringify([
          '/plugin install a@b',
          'curl -fsSL https://x.io/i.sh | bash',
        ]),
      ],
    );
    await ai.end();
    const res = await request(t.http())
      .get(`/api/items/${item.id}`)
      .expect(200);
    const cmds = (
      res.body as {
        summary: { installCommands: { command: string; warnings: string[] }[] };
      }
    ).summary.installCommands;
    expect(cmds[0].warnings).toEqual([]);
    expect(cmds[1].warnings).toEqual(['R01_REMOTE_PIPE_EXEC']);
  });
});
