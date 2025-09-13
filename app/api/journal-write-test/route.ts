// app/api/journal-write-test/route.ts
import { NextResponse } from 'next/server';
import { writeText } from '@/lib/ndjc/journal';

export const runtime = 'nodejs';

export async function POST() {
  const runId = 'debug-' + new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await writeText(runId, '00_hello.txt', 'hi from journal-write-test');
    return NextResponse.json({ ok: true, runId });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
