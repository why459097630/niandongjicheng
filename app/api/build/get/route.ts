import { NextRequest, NextResponse } from "next/server";
const GH = "https://api.github.com";
const OWNER = process.env.GH_OWNER || "why459097630";
const REPO  = process.env.GH_REPO  || "Packaging-warehouse";
const TOKEN = process.env.GITHUB_TOKEN || "";

async function readContent(path: string) {
  const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${encodeURIComponent(path)}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "ndjc" },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const j = await r.json();
  const b64 = j.content as string;
  const buf = Buffer.from(b64, "base64").toString("utf8");
  try { return JSON.parse(buf); } catch { return buf; }
}

export async function GET(req: NextRequest) {
  if (!TOKEN) return NextResponse.json({ ok:false, error:"Missing GITHUB_TOKEN" }, { status:500 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ ok:false, error:"missing id" }, { status:400 });

  const base = `requests/${id}`;
  const [prompt, raw, normalized, report, meta] = await Promise.all([
    readContent(`${base}/prompt.txt`),
    readContent(`${base}/raw.json`),
    readContent(`${base}/normalized.json`),
    readContent(`${base}/report.json`),
    readContent(`app/src/main/assets/ndjc_meta.json`),
  ]);

  return NextResponse.json({
    ok: true,
    id,
    prompt,
    raw,
    normalized,
    report,
    meta,
  });
}
