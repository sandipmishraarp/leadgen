import { NextResponse } from "next/server";
import { appBaseUrl, recordProposalView, requestMeta } from "@/lib/services/engagement";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(request.url);
  const proposalUrl = searchParams.get("url");
  await recordProposalView({
    engagementId: params.id,
    proposalId: searchParams.get("proposalId"),
    proposalUrl,
    meta: requestMeta(request)
  });
  if (proposalUrl) return NextResponse.redirect(proposalUrl, { status: 302 });
  return NextResponse.redirect(appBaseUrl(), { status: 302 });
}
