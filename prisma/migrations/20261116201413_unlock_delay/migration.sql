-- AlterTable
ALTER TABLE "blocker_settings" ADD COLUMN     "off_at" TIMESTAMP(3),
ADD COLUMN     "pending_quiet_hours" JSONB,
ADD COLUMN     "quiet_hours_at" TIMESTAMP(3);
