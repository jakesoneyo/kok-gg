// 검색 프록시: NestJS가 브라우저가 아는 유일한 서버다. FastAPI 호출 → 에러 매핑 → itemId를 ItemCard로 채움(1쿼리).
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ITEM_CARD_SELECT, toItemCard } from '../catalog/item-card';
import { DomainException } from '../common/errors/domain-exception';
import { PrismaService } from '../prisma/prisma.service';
import { AiStatusService } from './ai-status.service';
import {
  aiAnswerResponseSchema,
  aiSearchResponseSchema,
  type AnswerQuery,
  type SearchQuery,
} from './dto/search.schema';

const AI_TIMEOUT_MS = 8_000;

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiStatus: AiStatusService,
  ) {}

  async search(body: SearchQuery) {
    const res = await this.callAi(
      '/internal/search',
      body,
      aiSearchResponseSchema,
    );
    const rows = await this.prisma.item.findMany({
      where: { id: { in: res.items.map((i) => i.itemId) }, status: 'ACTIVE' },
      select: ITEM_CARD_SELECT,
    });
    const cards = new Map(rows.map((r) => [r.id, toItemCard(r)]));
    return {
      query: res.query,
      degraded: res.degraded,
      indexVersion: res.indexVersion,
      // 그 사이 사라진 항목은 조용히 뺀다(AI 인덱스가 하루 지연될 수 있음).
      items: res.items.flatMap(({ itemId, ...rest }) => {
        const item = cards.get(itemId);
        return item ? [{ item, ...rest }] : [];
      }),
    };
  }

  answer(body: AnswerQuery) {
    return this.callAi('/internal/search/answer', body, aiAnswerResponseSchema);
  }

  /**
   * 타임아웃·연결 실패 = 슬립 중인 무료 티어 기상 대기로 보고 503 SEARCH_WARMING(Retry-After 30).
   * FastAPI가 응답했지만 4xx/5xx(내부 토큰 불일치 포함)면 SEARCH_UNAVAILABLE — 상세는 로그에만 남겨 내부 구조를 숨긴다.
   */
  private async callAi<T>(
    path: string,
    body: object,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${process.env.AI_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-token': process.env.INTERNAL_API_TOKEN ?? '',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
    } catch (err) {
      this.aiStatus.set('down');
      this.logger.warn(`AI 서비스 응답 없음: ${(err as Error).message}`);
      throw new DomainException(
        503,
        'SEARCH_WARMING',
        '검색 서비스를 깨우는 중입니다. 잠시 후 다시 시도해 주세요.',
        null,
        { 'Retry-After': '30' },
      );
    }

    if (!res.ok) {
      this.aiStatus.set('down');
      this.logger.error(`AI 서비스 오류 ${res.status} ${path}`);
      throw unavailable();
    }
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) {
      this.logger.error({ err: parsed.error }, 'AI 응답이 계약과 다름');
      throw unavailable();
    }
    this.aiStatus.set('ok');
    return parsed.data;
  }
}

const unavailable = () =>
  new DomainException(
    503,
    'SEARCH_UNAVAILABLE',
    '검색 서비스를 일시적으로 사용할 수 없습니다.',
  );
