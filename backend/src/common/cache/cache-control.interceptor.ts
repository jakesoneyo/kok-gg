// 전역 인터셉터: 성공 응답에 캐시 프로필 헤더를 붙인다. 오류 응답은 필터가 no-store로 덮는다.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import {
  CACHE_PROFILE_KEY,
  CACHE_PROFILES,
  type CacheProfile,
} from './public-cacheable.decorator';

const DEFAULT_CACHE_CONTROL = 'private, no-store';
// 예산 소진으로 BM25만 쓴 응답은 짧게만 캐시해 예산 회복 후 정상 결과로 빨리 돌아오게 한다(API.md 1.1).
const SEARCH_DEGRADED = CACHE_PROFILES.search.replace(
  's-maxage=300',
  's-maxage=60',
);

@Injectable()
export class CacheControlInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const profile = this.reflector.get<CacheProfile | undefined>(
      CACHE_PROFILE_KEY,
      ctx.getHandler(),
    );
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      tap((body: unknown) => {
        const degraded =
          profile === 'search' &&
          typeof body === 'object' &&
          body !== null &&
          (body as { degraded?: unknown }).degraded === true;
        res.setHeader(
          'Cache-Control',
          !profile
            ? DEFAULT_CACHE_CONTROL
            : degraded
              ? SEARCH_DEGRADED
              : CACHE_PROFILES[profile],
        );
      }),
    );
  }
}
