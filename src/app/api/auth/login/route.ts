import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/crypto";
import { jsonError } from "@/lib/http";
import { setSessionCookie } from "@/lib/auth";
import { logActivity } from "@/lib/services/activity";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
    setSessionCookie(response, user.id);
    await logActivity({ type: "LOGIN", message: `${user.email} logged in`, userId: user.id });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
