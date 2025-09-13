// app/api/ping-github/route.ts
export const runtime = 'nodejs';
export async function GET() {
  const r = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${process.env.GH_PAT || ''}`,
      Accept: 'application/vnd.github+json',
    },
  });
  const text = await r.text();
  return new Response(text, {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
