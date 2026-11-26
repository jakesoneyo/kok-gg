// 검색 프록시 엔드포인트(API.md 4장). GET이라 엣지 캐시가 가능하고, 캐시 히트는 레이트리밋·AI 예산을 쓰지 않는다.
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCacheable } from '../common/cache/public-cacheable.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AnswerQueryDto, SearchQueryDto } from './dto/search.schema';
import { SearchService } from './search.service';

@ApiTags('search')
@Public()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @PublicCacheable('search')
  @ApiOperation({
    summary: '자연어 검색(하이브리드, FastAPI 프록시) — 20/분/IP',
  })
  find(@Query() q: SearchQueryDto) {
    return this.search.search(q);
  }

  @Get('answer')
  @PublicCacheable('search')
  @ApiOperation({ summary: '검색 결과 기반 근거 인용 답변 — 5/분/IP' })
  answer(@Query() q: AnswerQueryDto) {
    return this.search.answer(q);
  }
}
