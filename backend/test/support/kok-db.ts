// 통합 테스트용 DB: 운영과 같은 권한 모델을 만든다(bootstrap → Prisma 마이그레이션 → ai 계약 SQL).
// 컨테이너 시작이 느려 스위트당 1회만 띄우고 테스트 사이에는 truncate로 격리한다(C1).
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const INFRA_DB = join(__dirname, '../../../infra/db');
const BACKEND_ROOT = join(__dirname, '../..');
const PASSWORDS = { kok_app: 'app-pw', kok_ai: 'ai-pw' } as const;

export interface KokDb {
  /** 롤별 접속 URL. kok_app = NestJS·배치, kok_ai = FastAPI. */
  url(role: keyof typeof PASSWORDS): string;
  /** 롤로 접속한 pg 클라이언트(호출자가 end()). */
  client(role: keyof typeof PASSWORDS): Promise<Client>;
  stop(): Promise<void>;
}

/**
 * pgvector 컨테이너를 띄우고 운영 순서 그대로 구성한다:
 * bootstrap.sql(init.sh) → `prisma migrate deploy`(kok_app) → ai-contract.sql(kok_ai).
 * ai-contract.sql은 Alembic이 생성한 파일이라 FastAPI 코드 없이도 Nest 테스트가 ai 스키마를 갖는다.
 */
export async function startKokDb(): Promise<KokDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'pgvector/pgvector:pg17',
  )
    .withDatabase('kok')
    .withUsername('postgres')
    .withPassword('postgres')
    .withEnvironment({
      KOK_APP_PASSWORD: PASSWORDS.kok_app,
      KOK_AI_PASSWORD: PASSWORDS.kok_ai,
    })
    .withCopyFilesToContainer([
      {
        source: join(INFRA_DB, 'init.sh'),
        target: '/docker-entrypoint-initdb.d/00-bootstrap.sh',
        mode: 0o755,
      },
      {
        source: join(INFRA_DB, 'bootstrap.sql'),
        target: '/bootstrap/bootstrap.sql',
      },
    ])
    .start();

  const url = (role: keyof typeof PASSWORDS) =>
    `postgresql://${role}:${PASSWORDS[role]}@${container.getHost()}:${container.getMappedPort(5432)}/kok`;
  const client = async (role: keyof typeof PASSWORDS) => {
    const c = new Client({ connectionString: url(role) });
    await c.connect();
    return c;
  };

  execSync('npx prisma migrate deploy', {
    cwd: BACKEND_ROOT,
    env: { ...process.env, DIRECT_URL: url('kok_app') },
    stdio: 'pipe',
  });

  const ai = await client('kok_ai');
  await ai.query(
    readFileSync(join(__dirname, '../fixtures/ai-contract.sql'), 'utf8'),
  );
  await ai.end();

  return { url, client, stop: () => container.stop().then(() => undefined) };
}
