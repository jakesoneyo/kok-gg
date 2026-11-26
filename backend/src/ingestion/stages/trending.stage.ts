// 8단계 trending: 3개 기간 점수·순위를 계산해 trend_score와 item·repo 비정규화 컬럼에 쓴다.
import { Injectable } from '@nestjs/common';
import { TrendingService } from '../../trending/trending.service';
import type { Stage, StageContext } from '../stage';

@Injectable()
export class TrendingStage implements Stage {
  readonly name = 'TRENDING' as const;

  constructor(private readonly trending: TrendingService) {}

  async run(ctx: StageContext): Promise<void> {
    const counts = await this.trending.compute(ctx.asOf);
    ctx.add('processed', counts.D7);
    ctx.stats.qualifiedD1 = counts.D1;
    ctx.stats.qualifiedD7 = counts.D7;
    ctx.stats.qualifiedD30 = counts.D30;
    await ctx.commit(null);
  }
}
