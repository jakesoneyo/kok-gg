// main.ts와 e2e 테스트가 같은 전역 설정을 쓰도록 모은 곳(설정이 갈라지면 테스트가 운영을 증명하지 못한다).
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { ZodValidationPipe } from './common/pipes/zod-validation.pipe';

/**
 * 전역 prefix(/api, health 제외 — 컨테이너 헬스체크 경로 고정) · Zod 검증 파이프 · trust proxy.
 * TRUST_PROXY(홉 수)는 레이트리밋이 보는 req.ip의 신뢰 경계다 — 기본 0이면 X-Forwarded-For를 무시해
 * 헤더 위조로 한도를 우회할 수 없다.
 */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api', { exclude: ['health'] });
  app.useGlobalPipes(new ZodValidationPipe());
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 0));
}

/** Swagger(/api/docs). cleanupOpenApiDoc은 nestjs-zod의 Zod DTO를 OpenAPI 스키마로 후처리하는 데 필요하다. */
export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('kok.gg API')
    .setDescription(
      'Claude Code 플러그인·스킬·훅 트렌드 — 카탈로그·트렌딩·위험 신호·검색',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}

export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}
