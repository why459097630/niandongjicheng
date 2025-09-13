// app/api/ping-groq/route.ts
export const runtime = 'nodejs';

export async function GET() {
  try {
    const r = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY!}`,
        Accept: 'application/json',
      },
    });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
