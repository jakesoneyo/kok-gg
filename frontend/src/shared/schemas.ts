// API.md 응답/입력의 Zod 스키마. 프론트 타입은 전부 여기서 z.infer로 파생한다(타입 사본 금지).
import { z } from "zod";

export const KINDS = ["PLUGIN", "SKILL", "HOOK"] as const;
export const LEVELS = ["SAFE", "CAUTION", "DANGER"] as const;
export const SORTS = ["trending", "stars", "updated", "new"] as const;
export const WINDOWS = ["D1", "D7", "D30"] as const;

export const kindSchema = z.enum(KINDS);
export const levelSchema = z.enum(LEVELS);
export const sortSchema = z.enum(SORTS);
export const windowSchema = z.enum(WINDOWS);
export type Kind = z.infer<typeof kindSchema>;
export type Level = z.infer<typeof levelSchema>;
export type Sort = z.infer<typeof sortSchema>;
export type TrendWindow = z.infer<typeof windowSchema>;

const date = z.string(); // ISO-8601 문자열 그대로 표시용으로만 씀
const sparkline = z.array(z.number().int().nullable()).length(7);

export const repoBriefSchema = z.object({
  id: z.number(),
  fullName: z.string(),
  stars: z.number(),
  pushedAt: date.nullable(),
  sparkline7d: sparkline,
});

export const itemCardSchema = z.object({
  id: z.number(),
  kind: kindSchema,
  name: z.string(),
  description: z.string().nullable(),
  repo: repoBriefSchema,
  trendRank7d: z.number().nullable(),
  rankDelta: z.number().nullable(),
  isNew: z.boolean(),
  currentLevel: levelSchema.nullable(),
  hasExternalMcp: z.boolean(),
  trendScore7d: z.number(),
  firstSeenAt: date,
});
export type ItemCard = z.infer<typeof itemCardSchema>;

const page = <T extends z.ZodType>(item: T) =>
  z.object({ asOf: z.string().optional(), items: z.array(item), nextCursor: z.string().nullable() });

export const itemsPageSchema = page(itemCardSchema);

export const trendRowSchema = z.object({
  rank: z.number(),
  prevRank: z.number().nullable(),
  isNew: z.boolean(),
  repo: repoBriefSchema.extend({ description: z.string().nullable() }),
  score: z.number(),
  gain: z.number().nullable(),
  kinds: z.record(z.string(), z.number()),
  worstLevel: levelSchema.nullable(),
  topItems: z.array(
    z.object({ id: z.number(), kind: kindSchema, name: z.string(), currentLevel: levelSchema.nullable() }),
  ),
});
export type TrendRow = z.infer<typeof trendRowSchema>;
export const trendingPageSchema = page(trendRowSchema);

export const findingSchema = z.object({
  ruleId: z.string(),
  titleKo: z.string(),
  severity: levelSchema,
  filePath: z.string(),
  line: z.number(),
  excerpt: z.string(),
  fingerprint: z.string(),
  suppressed: z.boolean(),
  override: z
    .object({ reason: z.string(), appealUrl: z.string().nullable(), createdAt: date })
    .nullable(),
});
export type Finding = z.infer<typeof findingSchema>;

export const itemDetailSchema = z.object({
  item: z.object({
    id: z.number(),
    kind: kindSchema,
    name: z.string(),
    path: z.string(),
    description: z.string().nullable(),
    hasExternalMcp: z.boolean(),
    firstSeenAt: date,
  }),
  repo: z.object({
    id: z.number(),
    fullName: z.string(),
    url: z.string(),
    stars: z.number(),
    pushedAt: date.nullable(),
    headSha: z.string().nullable(),
    archived: z.boolean(),
  }),
  security: z
    .object({
      status: z.enum(["ANALYZED", "UNSUPPORTED", "TOO_LARGE", "ERROR"]),
      level: levelSchema.nullable(),
      rawLevel: levelSchema.nullable().optional(),
      ruleSetVersion: z.string(),
      headSha: z.string().nullable(),
      scannedAt: date,
      findings: z.array(findingSchema),
      disclaimerKo: z.string(),
    })
    .nullable(),
  summary: z
    .object({
      status: z.enum(["OK", "INSUFFICIENT"]),
      summaryKo: z.string().nullable(),
      useCasesKo: z.array(z.string()).default([]),
      installCommands: z
        .array(z.object({ command: z.string(), warnings: z.array(z.string()).default([]) }))
        .default([]),
      requirementsKo: z.array(z.string()).default([]),
      model: z.string().nullable().optional(),
      generatedAt: date.nullable().optional(),
    })
    .nullable(),
  trend: z.object({
    D1: z.object({ score: z.number(), rank: z.number() }).nullable(),
    D7: z.object({ score: z.number(), rank: z.number() }).nullable(),
    D30: z.object({ score: z.number(), rank: z.number() }).nullable(),
  }),
});
export type ItemDetail = z.infer<typeof itemDetailSchema>;

export const starSeriesSchema = z.object({
  repoId: z.number(),
  series: z.array(
    z.object({
      day: z.string(),
      gain: z.number().nullable(),
      total: z.number().nullable(),
      source: z.enum(["SNAPSHOT", "OFFICIAL"]).nullable(),
    }),
  ),
});
export type StarSeries = z.infer<typeof starSeriesSchema>;

export const rulesSchema = z.object({
  ruleSetVersion: z.string(),
  disclaimerKo: z.string(),
  knownLimitsKo: z.array(z.string()),
  rules: z.array(
    z.object({
      id: z.string(),
      titleKo: z.string(),
      descriptionKo: z.string(),
      severities: z.array(levelSchema),
      regions: z.array(z.string()),
    }),
  ),
});

export const overviewSchema = z.object({
  asOf: z.string().nullable().optional(),
  counts: z.record(z.string(), z.number()),
  trackedRepos: z.number(),
  lastRun: z.object({ finishedAt: date.nullable(), status: z.string() }).nullable(),
});

export const searchSchema = z.object({
  query: z.string(),
  degraded: z.boolean(),
  indexVersion: z.union([z.string(), z.number()]).nullable().optional(),
  items: z.array(
    z.object({
      item: itemCardSchema,
      score: z.number(),
      ranks: z.object({ bm25: z.number().nullable(), vector: z.number().nullable() }),
      snippetKo: z.string().nullable(),
    }),
  ),
});
export const answerSchema = z.object({
  answerKo: z.string().nullable(),
  citedItemIds: z.array(z.number()),
  degraded: z.boolean(),
  reason: z.enum(["BUDGET_EXHAUSTED", "NO_RESULTS", "CITATION_INVALID"]).nullable(),
});

export const userSchema = z.object({
  id: z.number(),
  email: z.string(),
  name: z.string(),
  role: z.enum(["USER", "ADMIN"]),
});
export type User = z.infer<typeof userSchema>;
export const authResultSchema = z.object({
  user: userSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});
export const refreshResultSchema = z.object({ accessToken: z.string(), refreshToken: z.string() });

export const bookmarksPageSchema = z.object({
  items: z.array(z.object({ item: itemCardSchema, seenLevel: levelSchema.nullable(), createdAt: date })),
  nextCursor: z.string().nullable(),
});
export const bookmarkIdsSchema = z.object({ itemIds: z.array(z.number()) });
export const securityChangesSchema = z.object({
  items: z.array(
    z.object({
      item: itemCardSchema,
      seenLevel: levelSchema.nullable(),
      currentLevel: levelSchema.nullable(),
      levelChangedAt: date.nullable(),
      newFindings: z.array(z.object({ ruleId: z.string(), titleKo: z.string(), severity: levelSchema })),
    }),
  ),
});

const runBrief = z.object({
  id: z.number(),
  trigger: z.string(),
  asOf: z.string().nullable(),
  status: z.string(),
  stages: z.array(z.string()).nullable().optional(),
  startedAt: date.nullable(),
  finishedAt: date.nullable(),
});
export const runsPageSchema = z.object({
  items: z.array(runBrief.extend({ failureCount: z.number() })),
  nextCursor: z.string().nullable(),
});
export const runDetailSchema = z.object({
  run: runBrief,
  stages: z.array(
    z.object({
      stage: z.string(),
      status: z.string(),
      error: z.string().nullable(),
      startedAt: date.nullable(),
      finishedAt: date.nullable(),
    }),
  ),
  failures: z.array(
    z.object({
      stage: z.string(),
      repoFullName: z.string().nullable(),
      code: z.string(),
      message: z.string(),
      createdAt: date,
    }),
  ),
});
export const runRequestResultSchema = z.object({ runId: z.number(), dispatched: z.boolean() });

export const dqSummarySchema = z.object({
  openByKind: z.record(z.string(), z.number()),
  lastRun: z
    .object({
      id: z.number(),
      status: z.string(),
      ghCoreUsed: z.number(),
      ghSearchUsed: z.number(),
      ghCodeSearchUsed: z.number(),
    })
    .nullable(),
  aiUsageToday: z.array(
    z.object({ pool: z.string(), capUsd: z.number(), spentUsd: z.number(), reservedUsd: z.number(), calls: z.number() }),
  ),
  externalSource: z.object({ name: z.string(), activeUntil: z.string().nullable() }),
});
export const dqIssuesSchema = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      repo: z.object({ id: z.number(), fullName: z.string() }),
      windowStart: z.string(),
      windowEnd: z.string(),
      status: z.string(),
      note: z.string().nullable(),
      createdAt: date,
    }),
  ),
  nextCursor: z.string().nullable(),
});
export const overridesPageSchema = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      item: z.object({ id: z.number(), name: z.string() }),
      ruleId: z.string(),
      fingerprint: z.string(),
      reason: z.string(),
      appealUrl: z.string().nullable(),
      createdAt: date,
      revokedAt: date.nullable(),
    }),
  ),
  nextCursor: z.string().nullable().default(null),
});

export const healthSchema = z.object({
  status: z.string(),
  db: z.string(),
  ai: z.enum(["ok", "down", "unknown"]),
});

/** 로그인 입력: 'admin' 리터럴만 이메일 형식 예외(서버 스키마와 동일 규칙). */
export const loginInputSchema = z.object({
  email: z.union([z.literal("admin"), z.email("올바른 이메일 형식이 아닙니다.")]),
  password: z.string().min(1, "비밀번호를 입력해주세요."),
});
/** 회원가입 입력: 예외 없음 — 항상 진짜 이메일. */
export const registerInputSchema = z.object({
  email: z.email("올바른 이메일 형식이 아닙니다."),
  password: z.string().min(8, "비밀번호는 8자 이상").max(72, "비밀번호는 72자 이하"),
  name: z.string().trim().min(1, "이름을 입력해주세요.").max(40, "이름은 40자 이하"),
});
export const overrideInputSchema = z.object({
  itemId: z.coerce.number().int().positive(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/i, "64자리 hex 지문"),
  reason: z.string().trim().min(10, "사유는 10자 이상").max(500),
  appealUrl: z
    .string()
    .trim()
    .regex(/^https:\/\/github\.com\//, "https://github.com/ 로 시작하는 URL")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
