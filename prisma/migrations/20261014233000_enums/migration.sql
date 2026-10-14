-- Closed string sets become enums. Written by hand: Prisma would drop and
-- re-create the columns, which loses data.

CREATE TYPE "ConnectionStatus" AS ENUM ('pending', 'connected', 'broken', 'disconnected');
CREATE TYPE "PauseReason" AS ENUM ('rate_limited', 'quota');
CREATE TYPE "ReplacementKind" AS ENUM ('track', 'playlist', 'album');
CREATE TYPE "ActivityAction" AS ENUM ('swap', 'fallback_next', 'skip', 'error');
CREATE TYPE "ActivityResult" AS ENUM ('replaced', 'replaced_via_next', 'allow_listed', 'no_device', 'restricted', 'failed', 'rate_limited', 'quota', 'broken');

-- The quota pause moves from spotify_connections.status to poll_state.pause_reason.
ALTER TABLE "poll_state" ADD COLUMN "pause_reason" "PauseReason";
UPDATE "poll_state" AS p SET "pause_reason" = 'quota'
  FROM "spotify_connections" AS c
  WHERE c."user_id" = p."user_id" AND c."status" = 'quota_paused' AND p."paused_until" IS NOT NULL;
UPDATE "poll_state" SET "pause_reason" = 'rate_limited'
  WHERE "paused_until" IS NOT NULL AND "pause_reason" IS NULL;
UPDATE "spotify_connections" SET "status" = 'connected' WHERE "status" = 'quota_paused';

ALTER TABLE "spotify_connections"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "ConnectionStatus" USING "status"::"ConnectionStatus",
  ALTER COLUMN "status" SET DEFAULT 'pending';

ALTER TABLE "blocker_settings"
  ALTER COLUMN "replacement_kind" TYPE "ReplacementKind" USING "replacement_kind"::"ReplacementKind";

ALTER TABLE "activity_log"
  ALTER COLUMN "action" TYPE "ActivityAction" USING "action"::"ActivityAction",
  ALTER COLUMN "result" TYPE "ActivityResult" USING "result"::"ActivityResult";
