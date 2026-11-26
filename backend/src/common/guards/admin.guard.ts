// ADMIN 전용 라우트 가드. JwtAuthGuard(전역) 뒤에 실행된다.
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { DomainException } from '../errors/domain-exception';

/**
 * 토큰의 role 대신 DB의 현재 role을 본다 — 강등된 관리자가 15분 만료 전까지 권한을 유지하지 못하게(JwtStrategy 주석 참고).
 * 관리자 호출은 드물어 요청당 1쿼리 비용이 문제 되지 않는다.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const user = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>().user;
    const row = user
      ? await this.prisma.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        })
      : null;
    if (row?.role !== 'ADMIN') {
      throw new DomainException(403, 'FORBIDDEN', '관리자 권한이 필요합니다.');
    }
    return true;
  }
}
