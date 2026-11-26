import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const bookmarksQuerySchema = z
  .object({
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(24),
  })
  .strict();
export class BookmarksQueryDto extends createZodDto(bookmarksQuerySchema) {}

export const itemIdParamSchema = z.object({
  itemId: z.coerce.number().int().positive(),
});
export class BookmarkItemParamDto extends createZodDto(itemIdParamSchema) {}

// 본문 생략 = 전부 확인(API.md 5장) — 본문이 아예 없는 POST도 받도록 기본값 {}.
export const ackSchema = z
  .object({
    itemIds: z.array(z.number().int().positive()).max(1000).optional(),
  })
  .strict()
  .default({});
export class AckDto extends createZodDto(ackSchema) {}
