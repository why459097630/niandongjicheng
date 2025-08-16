import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

type UpsertParams = {
  owner: string;
  repo: string;
  branch?: string;       // default 'main'
  path: string;          // e.g. 'android-app/src/main/assets/catalog.json'
  content: string;       // plain text
  message?: string;
};

export async function upsertFile({
  owner, repo, branch = 'main', path, content, message = 'chore: add content via API'
}: UpsertParams) {
  // 如果文件已存在，需要带上 sha 才能 update
  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(data)) sha = (data as any).sha;
  } catch (e: any) {
    if (e.status !== 404) throw e; // 404 表示不存在，走创建分支
  }

  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path, branch, message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    sha
  });
}
