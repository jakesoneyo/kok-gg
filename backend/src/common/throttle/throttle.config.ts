// 레이트리밋 4종(ARCHITECTURE 9.1). 인메모리 저장소라 인스턴스 1대 전제 — 수평 확장 시 storage만 교체.
import { SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { ThrottlerOptions } from '@nestjs/throttler';

const MINUTE = 60_000;

const RATE_BUCKET = 'rateBucket';
type Bucket = 'search' | 'answer' | 'auth';

/**
 * 핸들러를 이름 있는 레이트리밋 버킷에 묶는다. 요청 URL 문자열로 고르면 끝 `/`·대소문자 변형으로
 * 우회되므로(Express는 같은 핸들러로 매칭), 라우터가 해석한 핸들러 메타데이터를 기준으로 삼는다.
 */
export const RateBucket = (bucket: Bucket) => SetMetadata(RATE_BUCKET, bucket);

/** 이름 있는 스로틀러는 모든 라우트에 적용되므로, 해당 버킷이 붙은 핸들러만 남기고 skip한다. */
const onlyBucket = (bucket: Bucket) => (ctx: ExecutionContext) =>
  Reflect.getMetadata(RATE_BUCKET, ctx.getHandler()) !== bucket;

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
    skipIf: onlyBucket('search'),
  },
  {
    name: 'answer',
    ttl: MINUTE,
    limit: 5,
    skipIf: onlyBucket('answer'),
  },
  {
    name: 'auth',
    ttl: MINUTE,
    limit: 10,
    skipIf: onlyBucket('auth'),
  },
];
