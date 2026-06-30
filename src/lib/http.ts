import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(error: unknown, fallback = "Something went wrong") {
  if (error instanceof Response) {
    return NextResponse.json({ error: error.statusText || "Unauthorized" }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "Validation failed", details: error.flatten() }, { status: 400 });
  }
  if (error instanceof Error && "status" in error && typeof (error as Error & { status?: unknown }).status === "number") {
    return NextResponse.json({ error: error.message }, { status: (error as Error & { status: number }).status });
  }
  const message = error instanceof Error ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}
