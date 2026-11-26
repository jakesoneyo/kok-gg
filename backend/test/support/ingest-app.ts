// 수집 파이프라인 통합 테스트용 앱: IngestionModule에 가짜 GitHub·AI를 끼운다(실제 DB는 Testcontainers).
import { Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GithubClient } from '../../src/github/github.client';
import {
  AiSyncClient,
  type SyncResult,
} from '../../src/ingestion/ai-sync.client';
import { IngestionModule } from '../../src/ingestion/ingestion.module';
import { IngestionPipeline } from '../../src/ingestion/pipeline';
import { PrismaService } from '../../src/prisma/prisma.service';
import { SecurityService } from '../../src/security/security.service';
import { FakeGithub } from './fake-github';

@Module({ imports: [IngestionModule] })
class TestIngestRoot {}

export interface IngestApp {
  pipeline: IngestionPipeline;
  prisma: PrismaService;
  security: SecurityService;
  github: FakeGithub;
  aiCalls: number[];
  close: () => Promise<void>;
}

export async function createIngestApp(
  github: FakeGithub,
  ai?: (n: number) => SyncResult,
): Promise<IngestApp> {
  const aiCalls: number[] = [];
  const idle: SyncResult = {
    processed: 0,
    insufficient: 0,
    failed: 0,
    remaining: 0,
    budgetExhausted: false,
    indexVersion: 1,
  };
  const mod = await Test.createTestingModule({ imports: [TestIngestRoot] })
    .overrideProvider(GithubClient)
    .useValue(github)
    .overrideProvider(AiSyncClient)
    .useValue({
      sync: (n: number) => {
        aiCalls.push(n);
        return Promise.resolve(ai ? ai(aiCalls.length) : idle);
      },
    })
    .compile();
  const app = await mod.init();
  return {
    pipeline: app.get(IngestionPipeline),
    prisma: app.get(PrismaService),
    security: app.get(SecurityService),
    github,
    aiCalls,
    close: () => app.close(),
  };
}
