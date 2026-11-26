// 내 북마크(API.md 5장). 전부 Bearer, 캐시 no-store(인터셉터 기본값).
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { DEMO_EMAIL } from '../common/demo-account';
import { BookmarksService } from './bookmarks.service';
import {
  AckDto,
  BookmarkItemParamDto,
  BookmarksQueryDto,
} from './dto/bookmarks.schema';

@ApiTags('bookmarks')
@ApiBearerAuth()
@Controller('me/bookmarks')
export class BookmarksController {
  constructor(private readonly bookmarks: BookmarksService) {}

  /**
   * 내 북마크를 최근 저장순으로 돌려준다.
   *
   * @param q limit·cursor
   * @throws 401 UNAUTHORIZED · 400 INVALID_CURSOR
   */
  @Get()
  @ApiOperation({ summary: '내 북마크 (최근 저장순)' })
  list(@CurrentUser() u: AuthenticatedUser, @Query() q: BookmarksQueryDto) {
    return this.bookmarks.list(u.id, q);
  }

  /**
   * 공개 목록에서 북마크 별표를 그리기 위한 id 목록(최대 1000).
   */
  @Get('ids')
  @ApiOperation({
    summary: '내 북마크 항목 id 목록(공개 목록의 북마크 표시용)',
  })
  ids(@CurrentUser() u: AuthenticatedUser) {
    return this.bookmarks.ids(u.id);
  }

  /**
   * 저장 시점과 현재 보안 등급이 달라진 북마크와 새 위험 신호("등급 변경" 탭).
   */
  @Get('security-changes')
  @ApiOperation({ summary: '저장 후 보안 등급이 바뀐 북마크' })
  changes(@CurrentUser() u: AuthenticatedUser) {
    return this.bookmarks.securityChanges(u.id);
  }

  /**
   * 등급 변경 확인 처리. 공유 데모 계정은 시드 상태를 보존하려고 no-op(204)으로 처리한다.
   *
   * @param body itemIds 생략 시 내 북마크 전부
   * @throws 400 VALIDATION_FAILED
   */
  @Post('security-changes/ack')
  @HttpCode(204)
  @ApiOperation({ summary: '등급 변경 확인(seenLevel = currentLevel)' })
  async ack(@CurrentUser() u: AuthenticatedUser, @Body() body: AckDto) {
    if (u.email === DEMO_EMAIL) return; // 공유 데모 계정: 시드된 "등급 변경" 탭을 보존(REVIEW Y6)
    await this.bookmarks.ack(u.id, body.itemIds);
  }

  /**
   * 북마크 저장(멱등). 새로 저장되면 201, 이미 있으면 200.
   *
   * @param p 항목 id
   * @throws 404 NOT_FOUND 없거나 비활성 항목
   */
  @Put(':itemId')
  @ApiOperation({ summary: '북마크 저장(멱등: 생성 201 / 이미 있음 200)' })
  async put(
    @CurrentUser() u: AuthenticatedUser,
    @Param() p: BookmarkItemParamDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, ...body } = await this.bookmarks.put(u.id, p.itemId);
    res.status(created ? 201 : 200);
    return body;
  }

  /**
   * 북마크 삭제(없어도 204). 공유 데모 계정은 시드 북마크 보존을 위해 no-op.
   */
  @Delete(':itemId')
  @HttpCode(204)
  @ApiOperation({ summary: '북마크 삭제(없어도 204)' })
  async remove(
    @CurrentUser() u: AuthenticatedUser,
    @Param() p: BookmarkItemParamDto,
  ) {
    if (u.email === DEMO_EMAIL) return; // 공유 데모 계정: 시드된 북마크를 보존(REVIEW Y6)
    await this.bookmarks.remove(u.id, p.itemId);
  }
}
