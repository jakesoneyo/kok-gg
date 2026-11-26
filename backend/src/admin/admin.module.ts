import { Module } from '@nestjs/common';
import { SecurityModule } from '../security/security.module';
import { AdminController } from './admin.controller';
import { DataQualityService } from './data-quality.service';
import { IngestionAdminService } from './ingestion-admin.service';
import { SecurityOverridesController } from './security-overrides.controller';

@Module({
  imports: [SecurityModule],
  controllers: [AdminController, SecurityOverridesController],
  providers: [IngestionAdminService, DataQualityService],
})
export class AdminModule {}
