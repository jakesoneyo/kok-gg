// 보안 Override 요청 스키마(API.md 6.3).
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOverrideSchema = z
  .object({
    itemId: z.number().int().positive(),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 hex 64자'),
    reason: z.string().trim().min(10).max(500),
    appealUrl: z
      .string()
      .max(300)
      .regex(/^https:\/\/github\.com\//, 'GitHub URL만 허용')
      .url()
      .optional(),
  })
  .strict();
export class CreateOverrideDto extends createZodDto(createOverrideSchema) {}

export const revokeOverrideSchema = z
  .object({ reason: z.string().trim().max(500).optional() })
  .strict();
export class RevokeOverrideDto extends createZodDto(revokeOverrideSchema) {}

export const overridesQuerySchema = z
  .object({
    itemId: z.coerce.number().int().positive().optional(),
    active: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
export class OverridesQueryDto extends createZodDto(overridesQuerySchema) {}
