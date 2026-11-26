// 관리자 보안 예외 처리(Override) 엔드포인트(API.md 6.3). 운영 데모 관리자는 DemoReadOnlyGuard가 비-GET을 403으로 막는다.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { DemoReadOnlyGuard } from '../common/guards/demo-read-only.guard';
import { SecurityService } from '../security/security.service';
import { IdParamDto } from './dto/admin.schema';
import {
  CreateOverrideDto,
  OverridesQueryDto,
  RevokeOverrideDto,
} from './dto/security.schema';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard, DemoReadOnlyGuard)
@Controller('admin/security/overrides')
export class SecurityOverridesController {
  constructor(private readonly security: SecurityService) {}

  /**
   * 보안 Override 목록(항목·활성 여부 필터, keyset).
   *
   * @param q itemId·active·limit·cursor
   */
  @Get()
  @ApiOperation({ summary: 'Override 목록' })
  list(@Query() q: OverridesQueryDto) {
    return this.security.listOverrides(q);
  }

  /**
   * 오탐으로 판단한 위험 신호에 Override를 걸고 항목 등급을 즉시 재계산한다. 사유 필수 — 판정 변경의 감사 근거.
   *
   * @param u 처리 관리자 · @param body itemId·fingerprint·reason(10자 이상)·appealUrl(github.com만)
   * @throws 404 NOT_FOUND/FINDING_NOT_FOUND · 409 OVERRIDE_EXISTS · 403 DEMO_READ_ONLY(공개 데모 관리자는 불가)
   */
  @Post()
  @ApiOperation({ summary: 'Override 생성(등급 즉시 재계산)' })
  create(@CurrentUser() u: AuthenticatedUser, @Body() body: CreateOverrideDto) {
    return this.security.createOverride(u.id, body);
  }

  /**
   * Override 철회. 행은 지우지 않고 revokedAt만 채워 이력을 남기며(멱등), reason은 로그로만 남는다.
   *
   * @param p Override id · @param body reason
   * @throws 404 NOT_FOUND · 403 DEMO_READ_ONLY
   */
  @Post(':id/revoke')
  @HttpCode(200)
  @ApiOperation({ summary: 'Override 철회(기록은 남김)' })
  revoke(
    @Param() p: IdParamDto,
    @CurrentUser() u: AuthenticatedUser,
    @Body() body: RevokeOverrideDto,
  ) {
    return this.security.revokeOverride(p.id, u.id, body.reason);
  }
}
