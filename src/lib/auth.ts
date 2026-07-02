import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signToken, verifyToken } from "@/lib/crypto";

export const SESSION_COOKIE = "arp_session";

function sessionCookieOptions(maxAge: number) {
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const secure = appUrl.startsWith("https://") || process.env.COOKIE_SECURE === "true";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: basePath || "/",
    maxAge
  };
}

export async function getCurrentUser() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const payload = verifyToken(token);
  if (!payload?.userId) return null;
  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, name: true, email: true, role: true }
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    throw new Response("Unauthorized", { status: 401 });
  }
  return user;
}

export function setSessionCookie(response: NextResponse, userId: string) {
  response.cookies.set(SESSION_COOKIE, signToken({ userId }), sessionCookieOptions(60 * 60 * 8));
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
}
