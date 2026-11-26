import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Prisma 7은 schema.prisma에 커넥션 URL을 두지 않는다 — 런타임 클라이언트는
 * @prisma/adapter-pg로 직접 구성한다(DATABASE_URL = Neon 풀러 주소, kok_app 롤).
 * `query` 이벤트는 상세 화면 쿼리 수 단언(IT-16)이 SQL 왕복을 세는 데 쓴다.
 */
@Injectable()
export class PrismaService
  extends PrismaClient<{
    adapter: PrismaPg;
    log: [{ emit: 'event'; level: 'query' }];
  }>
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg(process.env.DATABASE_URL as string),
      log: [{ emit: 'event', level: 'query' }],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
