// app/api/build/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function env(k: string) { return process.env[k]; }

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
    },
  });
}

export async function POST(req: Request) {
  try {
    // 兼容你现有命名：GH_TOKEN/OWNER/REPO/WORKFLOW/REF
    const token = env('GITHUB_TOKEN') || env('GH_TOKEN');
    const repoFull = env('GITHUB_REPO') || `${env('OWNER')}/${env('REPO')}`;
    const [owner, repo] = (repoFull || '').split('/');
    const workflowFile = env('GITHUB_WORKFLOW_FILE') || env('WORKFLOW') || 'android-build-matrix.yml';
    const ref = env('REF') || 'main';

    if (!token || !owner || !repo) {
      return Response.json({ ok: false, error: 'ENV_MISSING' }, { status: 500 });
    }

    // 1) 获取目标分支 HEAD SHA（后续 /run-by-sha 会用它找到 run）
    const headResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${ref}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!headResp.ok) {
      const text = await headResp.text();
      return Response.json(
        { ok: false, error: 'HEAD_LOOKUP_FAILED', status: headResp.status, detail: text.slice(0, 400) },
        { status: 500 }
      );
    }
    const head = await headResp.json();
    const headSha: string = head?.sha;

    // 2) 触发 workflow_dispatch
    const body = await req.json().catch(() => ({} as any));
    const inputs = {
      app_name: body?.appName || 'Generated App',
      package_name: body?.packageName || 'com.example.generated',
      commit_sha: headSha,
      template_slug: body?.template || body?.template_slug || 'simple-template',
    };

    const dispatch = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({ ref, inputs }),
      }
    );

    if (dispatch.status !== 204) {
      const text = await dispatch.text();
      return Response.json(
        { ok: false, error: 'DISPATCH_FAILED', status: dispatch.status, detail: text.slice(0, 400) },
        { status: 500 }
      );
    }

    return Response.json({ ok: true, commitSha: headSha }, {
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || 'UNKNOWN' }, { status: 500 });
  }
}
