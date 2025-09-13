// app/api/ping/route.ts
export const runtime = 'nodejs';
export async function GET() {
  const has = (k: string) => Boolean(process.env[k]);
  return Response.json({
    ok: true,
    env: {
      GROQ_API_KEY: has('GROQ_API_KEY'),
      GH_OWNER: has('GH_OWNER'),
      GH_REPO: has('GH_REPO'),
      GH_BRANCH: has('GH_BRANCH'),
      WORKFLOW_ID: has('WORKFLOW_ID'),
      GH_PAT: has('GH_PAT'),
      NDJC_GIT_COMMIT: process.env.NDJC_GIT_COMMIT,
      NDJC_SKIP_ACTIONS: process.env.NDJC_SKIP_ACTIONS,
    },
    time: new Date().toISOString(),
  });
}
