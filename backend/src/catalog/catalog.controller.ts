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

  @Get('items')
  @PublicCacheable('list')
  @ApiOperation({ summary: '카탈로그 목록 (정렬 4종 × kind·level, keyset)' })
  items(@Query() q: ItemsQueryDto) {
    return this.catalog.listItems(q);
  }

  @Get('trending')
  @PublicCacheable('daily')
  @ApiOperation({ summary: '저장소 트렌딩 순위표' })
  trending(@Query() q: TrendingQueryDto) {
    return this.catalog.trending(q);
  }

  @Get('items/:id')
  @PublicCacheable('daily')
  @ApiOperation({ summary: '항목 상세 (요약·위험 신호·트렌드)' })
  item(@Param() p: ItemIdParamDto) {
    return this.detail.detail(p.id);
  }

  @Get('items/:id/stars')
  @PublicCacheable('series')
  @ApiOperation({ summary: '스타 일별 증가량 시계열 (모름 = null)' })
  stars(@Param() p: ItemIdParamDto, @Query() q: StarsQueryDto) {
    return this.detail.stars(p.id, q.days);
  }

  @Get('repos/:owner/:name')
  @PublicCacheable('daily')
  @ApiOperation({ summary: '저장소 상세' })
  repo(@Param() p: RepoParamDto) {
    return this.catalog.repoDetail(p.owner, p.name);
  }

  @Get('stats/overview')
  @PublicCacheable('static')
  @ApiOperation({ summary: '홈 통계' })
  stats() {
    return this.catalog.overview();
  }
}
