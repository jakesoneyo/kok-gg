// 운영에서 공개 데모 관리자(admin)가 관리자 데이터를 바꾸지 못하게 막는다.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { DomainException } from '../errors/domain-exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 면접관이 누구나 최고 권한으로 로그인할 수 있으므로, `DEMO_ADMIN_READONLY=true`이면
 * email==='admin' 계정의 비-GET 요청은 서버에서 403으로 거절한다(프론트의 버튼 비활성화는 UX일 뿐).
 * 같은 ADMIN이라도 다른 계정은 통과 — 데모 계정만 좁게 막는다. 환경변수는 요청 시점에 읽어 테스트가 토글할 수 있다.
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (process.env.DEMO_ADMIN_READONLY !== 'true') return true;
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    if (req.user?.email === 'admin' && !SAFE_METHODS.has(req.method)) {
      throw new DomainException(
        403,
        'DEMO_READ_ONLY',
        '데모 관리자 계정은 조회만 가능합니다.',
      );
    }
    return true;
  }
}
