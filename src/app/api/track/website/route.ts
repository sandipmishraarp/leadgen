import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/http";
import { recordWebsiteVisit, requestMeta } from "@/lib/services/engagement";

const schema = z.object({
  engagementId: z.string().optional().nullable(),
  leadId: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  pageUrl: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const visit = await recordWebsiteVisit({ ...input, meta: requestMeta(request) });
    return jsonOk({ ok: true, visitId: visit.id });
  } catch (error) {
    return jsonError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const input = schema.parse({
      engagementId: url.searchParams.get("engagementId"),
      leadId: url.searchParams.get("leadId"),
      email: url.searchParams.get("email"),
      pageUrl: url.searchParams.get("pageUrl") || url.searchParams.get("url") || request.headers.get("referer") || "unknown"
    });
    const visit = await recordWebsiteVisit({ ...input, meta: requestMeta(request) });
    return jsonOk({ ok: true, visitId: visit.id });
  } catch (error) {
    return jsonError(error);
  }
}
