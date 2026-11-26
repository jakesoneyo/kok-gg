// 레이트리밋 4종(ARCHITECTURE 9.1). 인메모리 저장소라 인스턴스 1대 전제 — 수평 확장 시 storage만 교체.
import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Request } from 'express';

const MINUTE = 60_000;

/** 이름 있는 스로틀러는 모든 라우트에 적용되므로, 경로로 해당 라우트만 남기고 나머지는 skip한다. */
const onlyPaths =
  (...paths: string[]) =>
  (ctx: ExecutionContext) =>
    !paths.includes(ctx.switchToHttp().getRequest<Request>().path);

export const THROTTLERS: ThrottlerOptions[] = [
  {
    name: 'default',
    ttl: MINUTE,
    // 요청 시점에 읽는다 — 대량 요청을 보내는 통합 테스트가 전역 한도에 걸리지 않게 조정할 수 있다.
    limit: () => Number(process.env.THROTTLE_DEFAULT_LIMIT ?? 120),
  },
  {
    name: 'search',
    ttl: MINUTE,
    limit: 20,
    skipIf: onlyPaths('/api/search'),
  },
  {
    name: 'answer',
    ttl: MINUTE,
    limit: 5,
    skipIf: onlyPaths('/api/search/answer'),
  },
  {
    name: 'auth',
    ttl: MINUTE,
    limit: 10,
    skipIf: onlyPaths('/api/auth/login', '/api/auth/register'),
  },
];
