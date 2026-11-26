import { Module } from '@nestjs/common';
import { GithubModule } from '../github/github.module';
import { PrismaModule } from '../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { TrendingService } from '../trending/trending.service';
import { AiSyncClient } from './ai-sync.client';
import { CandidatesService } from './candidates.service';
import { CheckpointService } from './checkpoint.service';
import { ExternalStarSource } from './external-star-source';
import { INGEST_CONFIG, loadIngestConfig } from './ingest.config';
import { IngestionPipeline } from './pipeline';
import { RepoInspector } from './repo-inspector.service';
import { STAGES } from './stage';
import { AiSyncStage } from './stages/ai-sync.stage';
import { DiscoverStage } from './stages/discover.stage';
import { FetchContentStage } from './stages/fetch-content.stage';
import { QualifyStage } from './stages/qualify.stage';
import { QualityStage } from './stages/quality.stage';
import { SecurityScanStage } from './stages/security-scan.stage';
import { SnapshotStage } from './stages/snapshot.stage';
import { StarHistoryStage } from './stages/star-history.stage';
import { TrendingStage } from './stages/trending.stage';

const STAGE_CLASSES = [
  DiscoverStage,
  QualifyStage,
  SnapshotStage,
  StarHistoryStage,
  FetchContentStage,
  SecurityScanStage,
  AiSyncStage,
  TrendingStage,
  QualityStage,
];

/** 배치 전용 모듈(CLI가 import). HTTP 서버에는 올리지 않는다. */
@Module({
  imports: [PrismaModule, GithubModule, SecurityModule],
  providers: [
    { provide: INGEST_CONFIG, useFactory: () => loadIngestConfig() },
    CandidatesService,
    CheckpointService,
    ExternalStarSource,
    AiSyncClient,
    RepoInspector,
    TrendingService,
    ...STAGE_CLASSES,
    // 배열 순서 = 실행 순서(ARCHITECTURE 3장 다이어그램)
    {
      provide: STAGES,
      useFactory: (...stages: unknown[]) => stages,
      inject: STAGE_CLASSES,
    },
    IngestionPipeline,
  ],
  exports: [IngestionPipeline, CandidatesService],
})
export class IngestionModule {}
