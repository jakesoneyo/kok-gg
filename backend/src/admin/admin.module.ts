import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { DataQualityService } from './data-quality.service';
import { IngestionAdminService } from './ingestion-admin.service';

@Module({
  controllers: [AdminController],
  providers: [IngestionAdminService, DataQualityService],
})
export class AdminModule {}
