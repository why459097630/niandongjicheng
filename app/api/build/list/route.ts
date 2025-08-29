import { NextResponse } from "next/server";
const GH = "https://api.github.com";
const OWNER = process.env.GH_OWNER || "why459097630";
const REPO  = process.env.GH_REPO  || "Packaging-warehouse";
const TOKEN = process.env.GITHUB_TOKEN || "";

export async function GET() {
  if (!TOKEN) return NextResponse.json({ ok:false, error:"Missing GITHUB_TOKEN" }, { status:500 });

  const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/requests`, {
    headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "ndjc" },
    cache: "no-store",
  });

  if (r.status === 404) return NextResponse.json({ ok:true, builds: [] });
  if (!r.ok) return NextResponse.json({ ok:false, error:`HTTP ${r.status}` }, { status:r.status });

  const items = await r.json() as any[];
  const dirs = items.filter(x => x.type === "dir").map((x:any) => x.name);
  dirs.sort((a:string, b:string) => b.localeCompare(a)); // 最近的在前
  return NextResponse.json({ ok:true, builds: dirs.slice(0, 100) });
}
