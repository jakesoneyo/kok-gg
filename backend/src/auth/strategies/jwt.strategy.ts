import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import type { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface AccessTokenPayload {
  sub: number;
  email: string;
  role: Role;
  jti: string;
}

/**
 * 전역 Role이 2종뿐이라 토큰에 role을 싣는다(ARCHITECTURE.md 10장).
 * 강등을 15분 만료 전에 반영하는 책임은 ADMIN 엔드포인트의 RolesGuard가 DB 재조회로 진다(C1).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET as string,
    });
  }

  /**
   * 서명·만료 검증을 통과한 페이로드를 req.user로 바꾼다.
   *
   * @param payload 액세스 토큰 페이로드 · @returns 요청 사용자
   */
  validate(payload: AccessTokenPayload): AuthenticatedUser {
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
