import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { resolveCorsOrigin } from './common/config/cors.config';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';

/**
 * 부트스트랩: Pino 로거 → 전역 prefix(/api, health 제외 — 컨테이너 헬스체크 경로 고정) →
 * Zod 검증 파이프 → Swagger(/api/docs) → CORS.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(new ZodValidationPipe());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('kok.gg API')
    .setDescription(
      'Claude Code 플러그인·스킬·훅 트렌드 — 카탈로그·트렌딩·위험 신호·검색',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  // 프로덕션에서 CORS_ORIGINS 미설정이면 throw(fail-fast).
  app.enableCors({ origin: resolveCorsOrigin() });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
