import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RateBucket } from '../common/throttle/throttle.config';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.schema';
import { RefreshDto } from './dto/refresh.schema';
import { RegisterDto } from './dto/register.schema';

/** API.md 2장 — 회원가입/로그인/refresh 회전/로그아웃/내 정보. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * 회원가입. 일반 사용자는 항상 실이메일로만 가입한다('admin' 형식 우회는 로그인에만 존재).
   *
   * @param dto 이메일·비밀번호·이름
   * @returns 공개 사용자 정보 + access/refresh 토큰
   * @throws 409 AUTH_EMAIL_TAKEN 이미 가입된 이메일 · 400 VALIDATION_FAILED · 429 RATE_LIMITED(10/분/IP)
   */
  @Public()
  @Post('register')
  @RateBucket('auth')
  @ApiOperation({ summary: '회원가입 (실이메일만 허용)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  /**
   * 로그인. 데모 admin 계정도 일반 계정과 똑같이 bcrypt 비교를 통과해야 한다(우회 경로 없음).
   *
   * @param dto email('admin' 리터럴 또는 이메일)·password
   * @returns 공개 사용자 정보 + access/refresh 토큰
   * @throws 401 AUTH_INVALID_CREDENTIALS 계정 없음/비밀번호 불일치(구분 안 함) · 429 RATE_LIMITED(10/분/IP)
   */
  @Public()
  @Post('login')
  @RateBucket('auth')
  @HttpCode(200)
  @ApiOperation({ summary: "로그인 (email==='admin' 리터럴만 형식 검증 우회)" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * 리프레시 토큰 회전. 한 번 쓴 토큰은 즉시 폐기되고 새 쌍이 발급된다.
   *
   * @param dto refreshToken 원문
   * @returns 새 access/refresh 토큰
   * @throws 401 AUTH_REFRESH_INVALID 없음/만료 · 401 AUTH_REFRESH_REUSE 이미 사용된 토큰(탈취 의심, 같은 계열 전체 폐기)
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: '리프레시 토큰 회전 (재사용 시 계열 전체 폐기)' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * 로그아웃. 해당 refresh 토큰만 폐기하며, 없거나 이미 폐기됐어도 204(정보 노출 없음).
   *
   * @param user 인증된 사용자 · @param dto 폐기할 refreshToken
   * @throws 401 UNAUTHORIZED 액세스 토큰 없음/무효
   */
  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃 (해당 refreshToken 폐기)' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RefreshDto,
  ): Promise<void> {
    await this.authService.logout(user.id, dto.refreshToken);
  }

  /**
   * 내 정보. 프론트가 데모 계정 여부(isDemo)로 읽기 전용 안내를 띄우는 근거.
   *
   * @returns 공개 사용자 정보 + isDemo
   * @throws 401 UNAUTHORIZED
   */
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보 (+ 데모 계정 여부)' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.id);
  }
}
