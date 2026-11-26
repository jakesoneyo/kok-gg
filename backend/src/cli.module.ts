import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { IngestionModule } from './ingestion/ingestion.module';

/** 배치 CLI 전용 루트 모듈. HTTP 컨트롤러·가드·throttler 없이 수집 파이프라인만 올린다. */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), IngestionModule],
})
export class CliModule {}
