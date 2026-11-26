import { Global, Module } from '@nestjs/common';
import { AiStatusService } from './ai-status.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

// AiStatusService는 /health가 읽으므로 전역으로 노출한다.
@Global()
@Module({
  controllers: [SearchController],
  providers: [SearchService, AiStatusService],
  exports: [AiStatusService],
})
export class SearchModule {}
