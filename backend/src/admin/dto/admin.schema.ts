// 관리자 조회·처리 스키마. StageName/DataQualityKind는 Prisma enum에서 파생해 손으로 재정의하지 않는다.
import { DataQualityKind, StageName } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const page = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

export const createRunSchema = z
  .object({
    stages: z
      .array(z.enum(StageName))
      .refine((a) => new Set(a).size === a.length, '단계는 중복될 수 없습니다.')
      .default([]),
  })
  .strict();
export class CreateRunDto extends createZodDto(createRunSchema) {}

export const runsQuerySchema = z.object(page).strict();
export class RunsQueryDto extends createZodDto(runsQuerySchema) {}

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
export class IdParamDto extends createZodDto(idParamSchema) {}

export const issuesQuerySchema = z
  .object({
    status: z.enum(['OPEN', 'RESOLVED', 'IGNORED']).default('OPEN'),
    kind: z.enum(DataQualityKind).optional(),
    ...page,
  })
  .strict();
export class IssuesQueryDto extends createZodDto(issuesQuerySchema) {}

export const patchIssueSchema = z
  .object({
    status: z.enum(['RESOLVED', 'IGNORED']),
    note: z.string().trim().min(1).max(500),
  })
  .strict();
export class PatchIssueDto extends createZodDto(patchIssueSchema) {}
