import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AiStatusService } from '../search/ai-status.service';

/**
 * Render/compose 헬스체크 대상. DB ping까지 확인하되 실패해도 200으로 상태를 보고한다(API.md 3.4).
 * ai는 FastAPI를 깨우지 않도록 직접 호출하지 않는다 — 검색 프록시가 기록한 마지막 상태만 보고한다(호출 전엔 'unknown').
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiStatus: AiStatusService,
  ) {}

  /**
   * DB ping 결과와 AI 마지막 상태를 보고한다. DB가 죽어도 200으로 상태를 알려 배포 플랫폼이 원인을 볼 수 있게 한다.
   *
   * @returns {status, db: ok|down, ai: ok|down|unknown}
   */
  @Public()
  @Get()
  @ApiOperation({ summary: '헬스체크 (DB ping 포함)' })
  async check() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(
      () => 'ok' as const,
      () => 'down' as const,
    );
    return { status: 'ok', db, ai: this.aiStatus.get() };
  }
}
