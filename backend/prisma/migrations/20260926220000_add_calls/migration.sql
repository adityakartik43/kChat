-- CreateEnum
CREATE TYPE "chat"."CallKind" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "chat"."CallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'ENDED_BY_CALLER', 'ENDED_BY_CALLEE', 'DECLINED', 'MISSED', 'FAILED');

-- CreateTable
CREATE TABLE "chat"."calls" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "callerId" UUID NOT NULL,
    "calleeId" UUID NOT NULL,
    "kind" "chat"."CallKind" NOT NULL DEFAULT 'AUDIO',
    "status" "chat"."CallStatus" NOT NULL DEFAULT 'RINGING',
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calls_conversationId_createdAt_idx" ON "chat"."calls"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "calls_calleeId_status_idx" ON "chat"."calls"("calleeId", "status");

-- CreateIndex
CREATE INDEX "calls_callerId_createdAt_idx" ON "chat"."calls"("callerId", "createdAt");

-- AddForeignKey
ALTER TABLE "chat"."calls" ADD CONSTRAINT "calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "chat"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."calls" ADD CONSTRAINT "calls_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "chat"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat"."calls" ADD CONSTRAINT "calls_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES "chat"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
