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

  @Get()
  @ApiOperation({ summary: '내 북마크 (최근 저장순)' })
  list(@CurrentUser() u: AuthenticatedUser, @Query() q: BookmarksQueryDto) {
    return this.bookmarks.list(u.id, q);
  }

  @Get('ids')
  @ApiOperation({
    summary: '내 북마크 항목 id 목록(공개 목록의 북마크 표시용)',
  })
  ids(@CurrentUser() u: AuthenticatedUser) {
    return this.bookmarks.ids(u.id);
  }

  @Get('security-changes')
  @ApiOperation({ summary: '저장 후 보안 등급이 바뀐 북마크' })
  changes(@CurrentUser() u: AuthenticatedUser) {
    return this.bookmarks.securityChanges(u.id);
  }

  @Post('security-changes/ack')
  @HttpCode(204)
  @ApiOperation({ summary: '등급 변경 확인(seenLevel = currentLevel)' })
  async ack(@CurrentUser() u: AuthenticatedUser, @Body() body: AckDto) {
    await this.bookmarks.ack(u.id, body.itemIds);
  }

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

  @Delete(':itemId')
  @HttpCode(204)
  @ApiOperation({ summary: '북마크 삭제(없어도 204)' })
  async remove(
    @CurrentUser() u: AuthenticatedUser,
    @Param() p: BookmarkItemParamDto,
  ) {
    await this.bookmarks.remove(u.id, p.itemId);
  }
}
