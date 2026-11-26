// 공개 GET 응답의 캐시 프로필(API.md 1.1)을 핸들러에 표시한다. 표시 없는 핸들러는 인터셉터가 no-store로 둔다.
import { SetMetadata } from '@nestjs/common';

export const CACHE_PROFILES = {
  daily: 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400',
  list: 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400',
  series: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  search: 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
  static: 'public, max-age=3600, s-maxage=86400',
} as const;

export type CacheProfile = keyof typeof CACHE_PROFILES;

export const CACHE_PROFILE_KEY = 'cacheProfile';

export const PublicCacheable = (profile: CacheProfile) =>
  SetMetadata(CACHE_PROFILE_KEY, profile);
