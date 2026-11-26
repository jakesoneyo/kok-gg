import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  itemKindSchema,
  riskLevelSchema,
} from '../../catalog/dto/catalog.schema';

// trim 후 빈 문자열은 400. FastAPI에도 같은 제약이 있어(API.md 7장) 여기서 먼저 걸러 불필요한 호출을 막는다.
const q = z.string().trim().min(1).max(200);

export const searchQuerySchema = z
  .object({
    q,
    kind: itemKindSchema.optional(),
    level: riskLevelSchema.optional(),
    limit: z.coerce.number().int().min(1).max(10).default(10),
  })
  .strict();
export class SearchQueryDto extends createZodDto(searchQuerySchema) {}

export const answerQuerySchema = z
  .object({
    q,
    kind: itemKindSchema.optional(),
    level: riskLevelSchema.optional(),
  })
  .strict();
export class AnswerQueryDto extends createZodDto(answerQuerySchema) {}

/** FastAPI /internal/search 응답. */
export const aiSearchResponseSchema = z.object({
  query: z.string(),
  degraded: z.boolean(),
  indexVersion: z.number(),
  items: z.array(
    z.object({
      itemId: z.number().int(),
      score: z.number(),
      ranks: z.object({
        bm25: z.number().nullable(),
        vector: z.number().nullable(),
      }),
      snippetKo: z.string().nullable(),
    }),
  ),
});

/** FastAPI /internal/search/answer 응답. */
export const aiAnswerResponseSchema = z.object({
  answerKo: z.string().nullable(),
  citedItemIds: z.array(z.number().int()),
  degraded: z.boolean(),
  reason: z
    .enum(['BUDGET_EXHAUSTED', 'NO_RESULTS', 'CITATION_INVALID'])
    .nullable(),
});
