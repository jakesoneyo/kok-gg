// 429를 API.md 공통 에러 포맷(RATE_LIMITED + Retry-After)으로 내보내는 ThrottlerGuard.
import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { DomainException } from '../errors/domain-exception';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _ctx: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const retryAfter = Math.max(
      detail.timeToBlockExpire,
      detail.timeToExpire,
      1,
    );
    throw new DomainException(
      429,
      'RATE_LIMITED',
      '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      null,
      { 'Retry-After': String(retryAfter) },
    );
  }
}
