-- AlterTable
ALTER TABLE "users" ADD COLUMN     "history_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "listening_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "item_uri" TEXT,
    "title" TEXT,
    "artists" TEXT,
    "album" TEXT,
    "show_name" TEXT,
    "duration_ms" INTEGER,
    "progress_ms" INTEGER,
    "context_type" TEXT,
    "context_uri" TEXT,
    "device_name" TEXT,
    "device_type" TEXT,
    "volume_percent" INTEGER,
    "shuffle" BOOLEAN,
    "repeat_state" TEXT,
    "time_zone" TEXT,

    CONSTRAINT "listening_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listening_events_user_id_at_idx" ON "listening_events"("user_id", "at");

-- CreateIndex
CREATE INDEX "listening_events_at_idx" ON "listening_events"("at");

-- AddForeignKey
ALTER TABLE "listening_events" ADD CONSTRAINT "listening_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
