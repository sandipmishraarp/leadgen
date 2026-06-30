import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "lead_intake"
    ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "sandipReviewRequired" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "sandipDecisionStatus" TEXT,
    ADD COLUMN IF NOT EXISTS "reviewerEmail" TEXT,
    ADD COLUMN IF NOT EXISTS "reviewerComment" TEXT,
    ADD COLUMN IF NOT EXISTS "reviewerCommentAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "allowContinueAsAbhay" BOOLEAN NOT NULL DEFAULT false
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "lead_intake_sandipReviewRequired_sandipDecisionStatus_idx"
    ON "lead_intake"("sandipReviewRequired", "sandipDecisionStatus")
  `);
  console.log("sandip review columns ready");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
