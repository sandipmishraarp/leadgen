import type { ActivityType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function logActivity(input: {
  type: ActivityType;
  message: string;
  userId?: string;
  leadId?: string;
  threadId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.activityLog.create({
    data: {
      type: input.type,
      message: input.message,
      userId: input.userId,
      leadId: input.leadId,
      threadId: input.threadId,
      metadata: input.metadata
    }
  });
}
