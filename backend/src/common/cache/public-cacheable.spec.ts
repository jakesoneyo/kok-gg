import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CacheControlInterceptor } from './cache-control.interceptor';
import { PublicCacheable } from './public-cacheable.decorator';

@Controller()
class DemoController {
  @PublicCacheable('daily')
  @Get('daily')
  daily() {
    return { ok: true };
  }

  @PublicCacheable('search')
  @Get('search-ok')
  searchOk() {
    return { degraded: false };
  }

  @PublicCacheable('search')
  @Get('search-degraded')
  searchDegraded() {
    return { degraded: true };
  }

  @Get('private')
  priv() {
    return { ok: true };
  }
}

describe('@PublicCacheable', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
      ],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());

  const get = (p: string) => request(app.getHttpServer() as App).get(p);

  it('프로필 헤더를 붙인다', async () => {
    const res = await get('/daily').expect(200);
    expect(res.headers['cache-control']).toBe(
      'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400',
    );
  });

  it('데코레이터 없는 핸들러는 private, no-store', async () => {
    const res = await get('/private').expect(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('검색이 degraded면 s-maxage=60으로 낮춘다', async () => {
    expect((await get('/search-ok')).headers['cache-control']).toContain(
      's-maxage=300',
    );
    expect((await get('/search-degraded')).headers['cache-control']).toBe(
      'public, max-age=0, s-maxage=60, stale-while-revalidate=3600',
    );
  });
});
