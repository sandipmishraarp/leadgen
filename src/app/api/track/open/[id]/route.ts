import { recordEmailOpen, requestMeta } from "@/lib/services/engagement";

const PIXEL = Buffer.from(
  "R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
  "base64"
);

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const engagementId = params.id.replace(/\.gif$/i, "");
  await recordEmailOpen(engagementId, requestMeta(request));
  return new Response(PIXEL, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0"
    }
  });
}
