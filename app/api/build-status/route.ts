import { NextRequest, NextResponse } from "next/server";

const OWNER = process.env.GH_OWNER!;
const REPO = process.env.GH_REPO!;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("requestId");
  if (!id) return NextResponse.json({ ok: false, error: "Missing requestId" }, { status: 400 });

  // 最简：直接返回 Release 页面 URL（你也可以调 GitHub API 查具体 assets）
  const releaseUrl = `https://github.com/${OWNER}/${REPO}/releases`;
  return NextResponse.json({ ok: true, status: "unknown", url: releaseUrl, requestId: id });
}
