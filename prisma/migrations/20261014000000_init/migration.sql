-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spotify_connections" (
    "user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret_enc" TEXT NOT NULL,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "expires_at" TIMESTAMP(3),
    "spotify_user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "code_verifier_enc" TEXT,
    "oauth_state" TEXT,
    "oauth_state_expires_at" TIMESTAMP(3),

    CONSTRAINT "spotify_connections_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "blocker_settings" (
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "interval_seconds" INTEGER NOT NULL DEFAULT 60,
    "replacement_uri" TEXT,
    "replacement_label" TEXT,
    "replacement_art" TEXT,
    "replacement_kind" TEXT,
    "block_audiobooks" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours" JSONB,
    "allowed_show_ids" JSONB NOT NULL DEFAULT '[]',
    "time_zone" TEXT NOT NULL DEFAULT 'UTC',

    CONSTRAINT "blocker_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "show_name" TEXT,
    "episode_name" TEXT,
    "device_name" TEXT,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "http_status" INTEGER,

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poll_state" (
    "user_id" TEXT NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "cooldown_until" TIMESTAMP(3),
    "paused_until" TIMESTAMP(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "now_playing_kind" TEXT,
    "now_playing_title" TEXT,
    "now_playing_subtitle" TEXT,
    "now_playing_art" TEXT,
    "quota_notified_at" TIMESTAMP(3),

    CONSTRAINT "poll_state_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "activity_log_user_id_at_idx" ON "activity_log"("user_id", "at");

-- AddForeignKey
ALTER TABLE "spotify_connections" ADD CONSTRAINT "spotify_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocker_settings" ADD CONSTRAINT "blocker_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poll_state" ADD CONSTRAINT "poll_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
