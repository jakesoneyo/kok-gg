import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * 전역 가드(app.module.ts). @Public()이 없는 라우트만 Bearer 액세스 토큰을 요구한다.
 * 공개 읽기 엔드포인트는 Authorization 헤더를 아예 읽지 않는다(API.md 1장 — 공유 캐시 안전).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /**
   * @Public()이면 passport를 건너뛰고(토큰을 읽지 않음), 아니면 Bearer JWT를 검증한다.
   *
   * @throws UnauthorizedException 401 토큰 없음/무효/만료
   */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}
