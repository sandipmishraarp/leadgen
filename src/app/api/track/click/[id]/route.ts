import { NextResponse } from "next/server";
import { appBaseUrl, recordLinkClick, requestMeta } from "@/lib/services/engagement";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get("u") || appBaseUrl();
  const result = await recordLinkClick(params.id, target, requestMeta(request));
  return NextResponse.redirect(result.url, { status: 302 });
}
