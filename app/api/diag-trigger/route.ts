// app/api/diag-trigger/route.ts
import { NextResponse } from "next/server";
import { touchRequestFile } from "@/lib/ndjc/github-writer";

// 统一触发逻辑
async function trigger() {
  const id = "diag-" + Date.now();
  await touchRequestFile(id, { kind: "diag" });
  return NextResponse.json({ ok: true, requestId: id });
}

// 支持 GET 和 POST，避免 405
export async function GET() {
  return trigger();
}

export async function POST() {
  return trigger();
}
