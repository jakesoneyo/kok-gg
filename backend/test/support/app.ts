// e2e 공용 앱 부트스트랩·DB 초기화·인증 헬퍼.
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import type { App } from 'supertest/types';
import { Client } from 'pg';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  http: () => App;
}

export async function createTestApp(): Promise<TestApp> {
  const mod = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = mod.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => app.getHttpServer(),
  };
}

/** public·ai 데이터를 모두 비운다. 테스트 사이 격리용(스키마는 유지). */
export async function resetDb(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  const ai = new Client({ connectionString: process.env.AI_DATABASE_URL });
  await ai.connect();
  await ai.query('TRUNCATE ai.item_summary, ai.budget_day, ai.usage_ledger');
  await ai.end();
}

export async function createUser(
  prisma: PrismaService,
  over: { email?: string; password?: string; role?: 'USER' | 'ADMIN' } = {},
) {
  const email = over.email ?? 'user@example.com';
  return prisma.user.create({
    data: {
      email,
      name: email.split('@')[0],
      role: over.role ?? 'USER',
      passwordHash: await bcrypt.hash(over.password ?? 'password1', 4),
    },
  });
}

/**
 * 액세스 토큰을 직접 서명한다. /auth/login은 10/분/IP로 제한돼(IT-15와 같은 방어) 스위트 전체가
 * 로그인 API를 부르면 테스트가 스스로 429에 걸린다 — 로그인 경로 자체는 IT-14가 따로 검증한다.
 */
export async function login(t: TestApp, email: string): Promise<string> {
  const user = await t.prisma.user.findUniqueOrThrow({ where: { email } });
  return t.app.get(JwtService).signAsync({
    sub: user.id,
    email: user.email,
    role: user.role,
    jti: randomUUID(),
  });
}
