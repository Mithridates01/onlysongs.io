-- CreateEnum
CREATE TYPE "EarlyAccessStatus" AS ENUM ('pending', 'invited', 'declined', 'joined');

-- CreateTable
CREATE TABLE "early_access_requests" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" "EarlyAccessStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),
    "invite_token_hash" TEXT,
    "invite_expires_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),

    CONSTRAINT "early_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "early_access_requests_email_key" ON "early_access_requests"("email");

-- CreateIndex
CREATE UNIQUE INDEX "early_access_requests_invite_token_hash_key" ON "early_access_requests"("invite_token_hash");

-- CreateIndex
CREATE INDEX "early_access_requests_status_created_at_idx" ON "early_access_requests"("status", "created_at");
