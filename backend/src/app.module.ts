import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { BookmarksModule } from './bookmarks/bookmarks.module';
import { CatalogModule } from './catalog/catalog.module';
import { CacheControlInterceptor } from './common/cache/cache-control.interceptor';
import { AppThrottlerGuard } from './common/throttle/app-throttler.guard';
import { THROTTLERS } from './common/throttle/throttle.config';
import { SearchModule } from './search/search.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        // requestId를 헤더로 받아 전파하고 없으면 새로 발급한다.
        genReqId: (req, res) => {
          const existing = req.headers['x-request-id'];
          const id =
            (Array.isArray(existing) ? existing[0] : existing) ?? randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: ['req.headers.authorization'],
        autoLogging: process.env.NODE_ENV !== 'test',
        // 테스트의 pretty transport 워커 스레드가 Jest 종료를 지연시킬 수 있어 끈다.
        transport:
          process.env.NODE_ENV === 'production' ||
          process.env.NODE_ENV === 'test'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    ThrottlerModule.forRoot({ throttlers: THROTTLERS }),
    PrismaModule,
    AuthModule,
    CatalogModule,
    BookmarksModule,
    SearchModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: CacheControlInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
