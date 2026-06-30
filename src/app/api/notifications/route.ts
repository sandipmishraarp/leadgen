import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    await requireUser();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const [logs, scheduledDue, failedSends, whatsappEvents] = await Promise.all([
      prisma.activityLog.findMany({
      where: {
        OR: [
          { message: { contains: "Client replied", mode: "insensitive" } },
          { message: { contains: "draft ready", mode: "insensitive" } },
          { message: { contains: "failed", mode: "insensitive" } },
          { message: { contains: "Bounce detected", mode: "insensitive" } },
          { message: { contains: "Do-not-contact", mode: "insensitive" } }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: 8
      }),
      prisma.scheduledEmail.findMany({
        where: { scheduledAt: { gte: start, lte: end }, status: { in: ["SCHEDULED", "QUEUED", "RETRY"] } },
        orderBy: { scheduledAt: "asc" },
        take: 3
      }),
      prisma.scheduledEmail.findMany({
        where: { status: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: 3
      }),
      safeWhatsAppFindMany({
        where: {
          OR: [
            { direction: "INBOUND", receivedAt: { gte: start } },
            { status: "FAILED" },
            { status: "DRAFT", createdAt: { gte: start } }
          ]
        },
        orderBy: { updatedAt: "desc" },
        take: 4,
        include: { lead: true }
      })
    ]);
    return jsonOk({
      notifications: [
        ...failedSends.map((item) => ({
          id: `failed-${item.id}`,
          message: `Send failed: ${item.toEmail}`,
          createdAt: item.updatedAt
        })),
        ...scheduledDue.map((item) => ({
          id: `scheduled-${item.id}`,
          message: `Scheduled email due today: ${item.toEmail}`,
          createdAt: item.scheduledAt
        })),
        ...whatsappEvents.map((item: any) => ({
          id: `whatsapp-${item.id}`,
          message: item.direction === "INBOUND" ? `WhatsApp reply: ${item.lead?.name || item.phone}` : `WhatsApp ${item.status.toLowerCase()}: ${item.lead?.name || item.phone}`,
          createdAt: item.receivedAt || item.updatedAt
        })),
        ...logs.map((log) => ({
          id: log.id,
          message: log.message,
          createdAt: log.createdAt
        }))
      ].slice(0, 10)
    });
  } catch (error) {
    return jsonError(error);
  }
}

function safeWhatsAppFindMany(args: any) {
  const delegate = (prisma as any).whatsAppMessage;
  return typeof delegate?.findMany === "function" ? delegate.findMany(args).catch(() => []) : Promise.resolve([]);
}
