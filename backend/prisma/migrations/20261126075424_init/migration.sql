-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "RepoStatus" AS ENUM ('CANDIDATE', 'TRACKED', 'IGNORED', 'GONE', 'TOO_LARGE');

-- CreateEnum
CREATE TYPE "DiscoverySource" AS ENUM ('TOPIC_SEARCH', 'CODE_SEARCH', 'AWESOME_SEED', 'MARKETPLACE_REF', 'MANUAL');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('PLUGIN', 'SKILL', 'HOOK');

-- CreateEnum
CREATE TYPE "ItemSourceType" AS ENUM ('IN_REPO', 'GITHUB_REPO', 'GIT_SUBDIR', 'UNSUPPORTED');

-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('SAFE', 'CAUTION', 'DANGER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('ANALYZED', 'UNSUPPORTED', 'TOO_LARGE', 'ERROR');

-- CreateEnum
CREATE TYPE "TrendWindow" AS ENUM ('D1', 'D7', 'D30');

-- CreateEnum
CREATE TYPE "IngestionTrigger" AS ENUM ('CRON', 'MANUAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('REQUESTED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "StageName" AS ENUM ('DISCOVER', 'QUALIFY', 'SNAPSHOT', 'STAR_HISTORY', 'FETCH_CONTENT', 'SECURITY_SCAN', 'AI_SYNC', 'TRENDING', 'QUALITY');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'PAUSED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DataQualityKind" AS ENUM ('STAR_SOURCE_MISMATCH', 'STAR_TOTAL_MISMATCH', 'EXTERNAL_MISMATCH', 'STAR_ANOMALY', 'OFFICIAL_HISTORY_FAILED');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "app_user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "family_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo" (
    "id" SERIAL NOT NULL,
    "github_id" BIGINT NOT NULL,
    "node_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_name_lower" TEXT NOT NULL,
    "description" TEXT,
    "default_branch" TEXT,
    "head_sha" CHAR(40),
    "content_sha" CHAR(40),
    "stars" INTEGER NOT NULL DEFAULT 0,
    "pushed_at" TIMESTAMP(3),
    "gh_created_at" TIMESTAMP(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "is_fork" BOOLEAN NOT NULL DEFAULT false,
    "topics" TEXT[],
    "status" "RepoStatus" NOT NULL DEFAULT 'CANDIDATE',
    "discovered_via" "DiscoverySource" NOT NULL,
    "ignored_reason" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "sparkline_7d" JSONB NOT NULL DEFAULT '[null,null,null,null,null,null,null]',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualified_at" TIMESTAMP(3),
    "tracked_since" TIMESTAMP(3),
    "star_backfilled_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT,
    "plugin_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_entry" (
    "marketplace_id" INTEGER NOT NULL,
    "entry_name" TEXT NOT NULL,
    "item_id" INTEGER NOT NULL,
    "raw_source" JSONB NOT NULL,

    CONSTRAINT "marketplace_entry_pkey" PRIMARY KEY ("marketplace_id","entry_name")
);

-- CreateTable
CREATE TABLE "item" (
    "id" SERIAL NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_type" "ItemSourceType" NOT NULL,
    "components" JSONB NOT NULL DEFAULT '{}',
    "has_external_mcp" BOOLEAN NOT NULL DEFAULT false,
    "status" "ItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_scan_id" INTEGER,
    "current_level" "RiskLevel",
    "level_changed_at" TIMESTAMP(3),
    "trend_score_7d" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trend_rank_7d" INTEGER,
    "prev_trend_rank_7d" INTEGER,
    "repo_stars" INTEGER NOT NULL DEFAULT 0,
    "repo_pushed_at" TIMESTAMP(3) NOT NULL DEFAULT '1970-01-01 00:00:00 +00:00',
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_source_doc" (
    "item_id" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_source_doc_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "repo_star_day" (
    "repo_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "snapshot_total" INTEGER,
    "official_added" INTEGER,
    "external_added" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repo_star_day_pkey" PRIMARY KEY ("repo_id","day")
);

-- CreateTable
CREATE TABLE "trend_score" (
    "window" "TrendWindow" NOT NULL,
    "as_of" DATE NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "gain" INTEGER NOT NULL,
    "acceleration" DOUBLE PRECISION NOT NULL,
    "spike_penalty" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "prev_rank" INTEGER,
    "params_version" INTEGER NOT NULL,

    CONSTRAINT "trend_score_pkey" PRIMARY KEY ("window","as_of","repo_id")
);

-- CreateTable
CREATE TABLE "security_scan" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "head_sha" CHAR(40) NOT NULL,
    "rule_set_version" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL,
    "raw_level" "RiskLevel",
    "level" "RiskLevel",
    "finding_count" INTEGER NOT NULL DEFAULT 0,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_finding" (
    "id" SERIAL NOT NULL,
    "scan_id" INTEGER NOT NULL,
    "rule_id" TEXT NOT NULL,
    "severity" "RiskLevel" NOT NULL,
    "file_path" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "excerpt" TEXT NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "security_finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_override" (
    "id" SERIAL NOT NULL,
    "item_id" INTEGER NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "rule_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "appeal_url" TEXT,
    "active_key" TEXT,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by_id" INTEGER,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "security_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookmark" (
    "user_id" INTEGER NOT NULL,
    "item_id" INTEGER NOT NULL,
    "seen_level" "RiskLevel",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookmark_pkey" PRIMARY KEY ("user_id","item_id")
);

-- CreateTable
CREATE TABLE "ingestion_run" (
    "id" SERIAL NOT NULL,
    "trigger" "IngestionTrigger" NOT NULL,
    "as_of" DATE NOT NULL,
    "cron_key" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'REQUESTED',
    "stages" "StageName"[],
    "requested_by" INTEGER,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_stage" (
    "run_id" INTEGER NOT NULL,
    "stage" "StageName" NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "cursor" JSONB,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "ingestion_stage_pkey" PRIMARY KEY ("run_id","stage")
);

-- CreateTable
CREATE TABLE "ingestion_failure" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "stage" "StageName" NOT NULL,
    "repo_id" INTEGER,
    "item_id" INTEGER,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_failure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_issue" (
    "id" SERIAL NOT NULL,
    "kind" "DataQualityKind" NOT NULL,
    "repo_id" INTEGER NOT NULL,
    "window_start" DATE NOT NULL,
    "window_end" DATE NOT NULL,
    "values" JSONB NOT NULL,
    "diff" INTEGER NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "detected_run_id" INTEGER,
    "resolved_by_id" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_quality_issue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE INDEX "refresh_token_family_id_idx" ON "refresh_token"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_github_id_key" ON "repo"("github_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_node_id_key" ON "repo"("node_id");

-- CreateIndex
CREATE UNIQUE INDEX "repo_full_name_lower_key" ON "repo"("full_name_lower");

-- CreateIndex
CREATE INDEX "repo_status_stars_idx" ON "repo"("status", "stars" DESC);

-- CreateIndex
CREATE INDEX "repo_status_qualified_at_idx" ON "repo"("status", "qualified_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_repo_id_path_key" ON "marketplace"("repo_id", "path");

-- CreateIndex
CREATE INDEX "marketplace_entry_item_id_idx" ON "marketplace_entry"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_current_scan_id_key" ON "item"("current_scan_id");

-- CreateIndex
CREATE INDEX "item_status_trend_score_7d_id_idx" ON "item"("status", "trend_score_7d" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_kind_trend_score_7d_id_idx" ON "item"("status", "kind", "trend_score_7d" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_repo_stars_id_idx" ON "item"("status", "repo_stars" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_kind_repo_stars_id_idx" ON "item"("status", "kind", "repo_stars" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_repo_pushed_at_id_idx" ON "item"("status", "repo_pushed_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_kind_repo_pushed_at_id_idx" ON "item"("status", "kind", "repo_pushed_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_first_seen_at_id_idx" ON "item"("status", "first_seen_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_status_kind_first_seen_at_id_idx" ON "item"("status", "kind", "first_seen_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "item_repo_id_idx" ON "item"("repo_id");

-- CreateIndex
CREATE UNIQUE INDEX "item_repo_id_kind_path_key" ON "item"("repo_id", "kind", "path");

-- CreateIndex
CREATE INDEX "trend_score_window_as_of_rank_idx" ON "trend_score"("window", "as_of", "rank");

-- CreateIndex
CREATE INDEX "security_scan_item_id_scanned_at_idx" ON "security_scan"("item_id", "scanned_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "security_scan_item_id_head_sha_rule_set_version_key" ON "security_scan"("item_id", "head_sha", "rule_set_version");

-- CreateIndex
CREATE INDEX "security_finding_scan_id_idx" ON "security_finding"("scan_id");

-- CreateIndex
CREATE UNIQUE INDEX "security_override_active_key_key" ON "security_override"("active_key");

-- CreateIndex
CREATE INDEX "security_override_item_id_created_at_idx" ON "security_override"("item_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ingestion_run_cron_key_key" ON "ingestion_run"("cron_key");

-- CreateIndex
CREATE INDEX "ingestion_run_created_at_idx" ON "ingestion_run"("created_at" DESC);

-- CreateIndex
CREATE INDEX "ingestion_run_status_idx" ON "ingestion_run"("status");

-- CreateIndex
CREATE INDEX "ingestion_failure_run_id_stage_idx" ON "ingestion_failure"("run_id", "stage");

-- CreateIndex
CREATE INDEX "data_quality_issue_status_created_at_idx" ON "data_quality_issue"("status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_issue_kind_repo_id_window_end_key" ON "data_quality_issue"("kind", "repo_id", "window_end");

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace" ADD CONSTRAINT "marketplace_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_entry" ADD CONSTRAINT "marketplace_entry_marketplace_id_fkey" FOREIGN KEY ("marketplace_id") REFERENCES "marketplace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_entry" ADD CONSTRAINT "marketplace_entry_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_current_scan_id_fkey" FOREIGN KEY ("current_scan_id") REFERENCES "security_scan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_source_doc" ADD CONSTRAINT "item_source_doc_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repo_star_day" ADD CONSTRAINT "repo_star_day_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trend_score" ADD CONSTRAINT "trend_score_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_scan" ADD CONSTRAINT "security_scan_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_finding" ADD CONSTRAINT "security_finding_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "security_scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_override" ADD CONSTRAINT "security_override_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_override" ADD CONSTRAINT "security_override_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark" ADD CONSTRAINT "bookmark_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookmark" ADD CONSTRAINT "bookmark_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_stage" ADD CONSTRAINT "ingestion_stage_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingestion_failure" ADD CONSTRAINT "ingestion_failure_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ingestion_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_issue" ADD CONSTRAINT "data_quality_issue_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
