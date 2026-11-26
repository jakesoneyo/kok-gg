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

  @Get()
  @ApiOperation({ summary: 'Override 목록' })
  list(@Query() q: OverridesQueryDto) {
    return this.security.listOverrides(q);
  }

  @Post()
  @ApiOperation({ summary: 'Override 생성(등급 즉시 재계산)' })
  create(@CurrentUser() u: AuthenticatedUser, @Body() body: CreateOverrideDto) {
    return this.security.createOverride(u.id, body);
  }

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
