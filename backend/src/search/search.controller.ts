// 검색 프록시 엔드포인트(API.md 4장). GET이라 엣지 캐시가 가능하고, 캐시 히트는 레이트리밋·AI 예산을 쓰지 않는다.
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCacheable } from '../common/cache/public-cacheable.decorator';
import { RateBucket } from '../common/throttle/throttle.config';
import { Public } from '../common/decorators/public.decorator';
import { AnswerQueryDto, SearchQueryDto } from './dto/search.schema';
import { SearchService } from './search.service';

@ApiTags('search')
@Public()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  /**
   * 자연어 검색. GET이라 엣지 캐시가 가능하고 캐시 히트는 레이트리밋·AI 예산을 쓰지 않는다.
   *
   * @param q 질의(q)·kind·level·limit
   * @returns 질의·degraded(예산 소진 시 BM25만)·ItemCard가 채워진 결과
   * @throws 400 VALIDATION_FAILED · 429 RATE_LIMITED(20/분/IP) · 503 SEARCH_WARMING/SEARCH_UNAVAILABLE
   */
  @Get()
  @RateBucket('search')
  @PublicCacheable('search')
  @ApiOperation({
    summary: '자연어 검색(하이브리드, FastAPI 프록시) — 20/분/IP',
  })
  find(@Query() q: SearchQueryDto) {
    return this.search.search(q);
  }

  /**
   * 검색 결과에 근거한 인용 답변. LLM 비용이 드니 검색보다 엄격히 5/분/IP로 제한한다.
   *
   * @param q 질의·kind·level
   * @returns 답변(없으면 null)·인용 itemId·degraded·reason
   * @throws 400 VALIDATION_FAILED · 429 RATE_LIMITED(5/분/IP) · 503 SEARCH_WARMING/SEARCH_UNAVAILABLE
   */
  @Get('answer')
  @RateBucket('answer')
  @PublicCacheable('search')
  @ApiOperation({ summary: '검색 결과 기반 근거 인용 답변 — 5/분/IP' })
  answer(@Query() q: AnswerQueryDto) {
    return this.search.answer(q);
  }
}
