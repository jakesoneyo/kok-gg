import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { resolveCorsOrigin } from './common/config/cors.config';
import { configureApp, setupSwagger } from './app.setup';

/**
 * 부트스트랩: Pino 로거 → 공통 설정(app.setup) → Swagger(/api/docs) → CORS.
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));

  configureApp(app);

  setupSwagger(app);

  // 프로덕션에서 CORS_ORIGINS 미설정이면 throw(fail-fast).
  app.enableCors({ origin: resolveCorsOrigin() });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
