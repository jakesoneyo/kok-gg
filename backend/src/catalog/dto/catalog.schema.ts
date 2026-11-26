// 카탈로그 공개 엔드포인트의 쿼리·경로 스키마. enum은 Prisma 생성 타입에서 파생(SSOT). 쿼리는 .strict() — 알 수 없는 파라미터는 400(캐시 버스팅 차단, API.md 1장).
import { ItemKind, RiskLevel, TrendWindow } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const itemKindSchema = z.enum(ItemKind);
export const riskLevelSchema = z.enum(RiskLevel);
export const itemSortSchema = z.enum(['trending', 'stars', 'updated', 'new']);
export type ItemSort = z.infer<typeof itemSortSchema>;

const cursorSchema = z.string().max(200);
const limit = (def: number) =>
  z.coerce.number().int().min(1).max(50).default(def);

export const itemsQuerySchema = z
  .object({
    sort: itemSortSchema.default('trending'),
    kind: itemKindSchema.optional(),
    level: riskLevelSchema.optional(),
    limit: limit(24),
    cursor: cursorSchema.optional(),
  })
  .strict();
export type ItemsQuery = z.infer<typeof itemsQuerySchema>;
export class ItemsQueryDto extends createZodDto(itemsQuerySchema) {}

export const trendingQuerySchema = z
  .object({
    window: z.enum(TrendWindow).default('D7'),
    kind: itemKindSchema.optional(),
    limit: limit(20),
    cursor: cursorSchema.optional(),
  })
  .strict();
export type TrendingQuery = z.infer<typeof trendingQuerySchema>;
export class TrendingQueryDto extends createZodDto(trendingQuerySchema) {}

export const itemIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export class ItemIdParamDto extends createZodDto(itemIdParamSchema) {}

export const starsQuerySchema = z
  .object({
    days: z.enum(['30', '90', '180']).default('90').transform(Number),
  })
  .strict();
export class StarsQueryDto extends createZodDto(starsQuerySchema) {}

const githubName = z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/);
export const repoParamSchema = z.object({
  owner: githubName,
  name: githubName,
});
export class RepoParamDto extends createZodDto(repoParamSchema) {}
