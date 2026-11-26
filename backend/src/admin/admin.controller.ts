// 관리자 조회·처리 엔드포인트(API.md 6.1·6.2). ADMIN 전용, 캐시 no-store, 운영 데모 관리자는 비-GET 403.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AdminGuard } from '../common/guards/admin.guard';
import { DemoReadOnlyGuard } from '../common/guards/demo-read-only.guard';
import { DataQualityService } from './data-quality.service';
import {
  CreateRunDto,
  IdParamDto,
  IssuesQueryDto,
  PatchIssueDto,
  RunsQueryDto,
} from './dto/admin.schema';
import { IngestionAdminService } from './ingestion-admin.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AdminGuard, DemoReadOnlyGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly ingestion: IngestionAdminService,
    private readonly quality: DataQualityService,
  ) {}

  @Post('ingestion/runs')
  @HttpCode(202)
  @ApiOperation({ summary: '수집 수동 실행 요청(workflow_dispatch)' })
  requestRun(@CurrentUser() u: AuthenticatedUser, @Body() body: CreateRunDto) {
    return this.ingestion.requestRun(u.id, body.stages);
  }

  @Get('ingestion/runs')
  @ApiOperation({ summary: '수집 실행 목록' })
  runs(@Query() q: RunsQueryDto) {
    return this.ingestion.listRuns(q);
  }

  @Get('ingestion/runs/:id')
  @ApiOperation({ summary: '수집 실행 상세(단계·실패)' })
  run(@Param() p: IdParamDto) {
    return this.ingestion.runDetail(p.id);
  }

  @Get('data-quality/summary')
  @ApiOperation({ summary: '데이터 품질 요약 + 오늘 AI 사용량' })
  summary() {
    return this.quality.summary();
  }

  @Get('data-quality/issues')
  @ApiOperation({ summary: '데이터 품질 이슈 목록' })
  issues(@Query() q: IssuesQueryDto) {
    return this.quality.listIssues(q);
  }

  @Patch('data-quality/issues/:id')
  @ApiOperation({ summary: '이슈 처리(RESOLVED/IGNORED + 메모)' })
  resolve(
    @Param() p: IdParamDto,
    @CurrentUser() u: AuthenticatedUser,
    @Body() body: PatchIssueDto,
  ) {
    return this.quality.resolve(p.id, u.id, body);
  }
}
