// 공개 카탈로그 엔드포인트(API.md 3장). 전부 Public — Authorization 헤더를 읽지 않아 공유 캐시에 안전하다.
import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicCacheable } from '../common/cache/public-cacheable.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import {
  ItemIdParamDto,
  ItemsQueryDto,
  RepoParamDto,
  StarsQueryDto,
  TrendingQueryDto,
} from './dto/catalog.schema';
import { ItemDetailService } from './item-detail.service';

@ApiTags('catalog')
@Public()
@Controller()
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly detail: ItemDetailService,
  ) {}

  /**
   * 카탈로그 목록. keyset 커서라 깊은 페이지도 일정 비용이고, 쿼리는 strict라 알 수 없는 파라미터(캐시 버스팅)는 거절한다.
   *
   * @param q sort·kind·level·limit·cursor
   * @returns asOf·정렬·ItemCard 목록·nextCursor
   * @throws 400 VALIDATION_FAILED · 400 INVALID_CURSOR(정렬과 맞지 않는 커서)
   */
  @Get('items')
  @PublicCacheable('list')
  @ApiOperation({ summary: '카탈로그 목록 (정렬 4종 × kind·level, keyset)' })
  items(@Query() q: ItemsQueryDto) {
    return this.catalog.listItems(q);
  }

  /**
   * 저장소 단위 트렌딩 순위표(기간 D1/D7/D30). 점수는 배치가 미리 계산해 둔 값을 읽기만 한다.
   *
   * @param q window·kind·limit·cursor
   * @returns 기준일·순위 목록·nextCursor
   * @throws 400 VALIDATION_FAILED · 400 INVALID_CURSOR
   */
  @Get('trending')
  @PublicCacheable('daily')
  @ApiOperation({ summary: '저장소 트렌딩 순위표' })
  trending(@Query() q: TrendingQueryDto) {
    return this.catalog.trending(q);
  }

  /**
   * 항목 상세(요약·위험 신호·트렌드). 보안 판정은 규칙 엔진 결과이며 AI 요약과 분리돼 있다.
   *
   * @param p 항목 id
   * @throws 404 NOT_FOUND 없거나 비활성 항목
   */
  @Get('items/:id')
  @PublicCacheable('daily')
  @ApiOperation({ summary: '항목 상세 (요약·위험 신호·트렌드)' })
  item(@Param() p: ItemIdParamDto) {
    return this.detail.detail(p.id);
  }

  /**
   * 스타 일별 증가량 시계열. 수집하지 못한 날은 0이 아니라 null로 내려 "모름"과 "증가 없음"을 구분한다.
   *
   * @param p 항목 id · @param q days(30/90/180)
   * @throws 404 NOT_FOUND
   */
  @Get('items/:id/stars')
  @PublicCacheable('series')
  @ApiOperation({ summary: '스타 일별 증가량 시계열 (모름 = null)' })
  stars(@Param() p: ItemIdParamDto, @Query() q: StarsQueryDto) {
    return this.detail.stars(p.id, q.days);
  }

  /**
   * 저장소 상세(소속 항목·기간별 트렌드·마켓플레이스).
   *
   * @param p owner/name
   * @throws 404 NOT_FOUND
   */
  @Get('repos/:owner/:name')
  @PublicCacheable('daily')
  @ApiOperation({ summary: '저장소 상세' })
  repo(@Param() p: RepoParamDto) {
    return this.catalog.repoDetail(p.owner, p.name);
  }

  /**
   * 홈 화면 통계(종류별 항목 수·추적 저장소 수·마지막 수집 실행). 거의 안 변해 길게 캐시한다.
   *
   * @returns 집계 요약
   */
  @Get('stats/overview')
  @PublicCacheable('static')
  @ApiOperation({ summary: '홈 통계' })
  stats() {
    return this.catalog.overview();
  }
}
