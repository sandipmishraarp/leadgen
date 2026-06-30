import { requireUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/http";
import { calculateLeadQualification } from "@/lib/services/lead-qualification";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    await requireUser();
    const qualification = await calculateLeadQualification(params.id);
    return jsonOk({ qualification });
  } catch (error) {
    return jsonError(error);
  }
}
