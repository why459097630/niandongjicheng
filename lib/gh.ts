// 最小 GitHub 写文件工具（使用 Contents API）
type WriteArgs = {
  owner: string;
  repo: string;
  filePath: string;    // 例如 "requests/123/prompt.txt"
  content: string;     // 直接传入字符串，内部转 base64
  message: string;     // commit message
  branch?: string;     // 默认 main
};

const GH = "https://api.github.com";
const TOKEN = process.env.GITHUB_TOKEN || "";

export async function writeToRepo(args: WriteArgs): Promise<void> {
  if (!TOKEN) throw new Error("Missing GITHUB_TOKEN");
  const { owner, repo, filePath, content, message, branch = "main" } = args;

  // 1) 查是否已存在（拿到 sha 才能 update）
  let sha: string | undefined = undefined;
  const getRes = await fetch(
    `${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${branch}`,
    { headers: { Authorization: `Bearer ${TOKEN}`, "User-Agent": "ndjc" } }
  );
  if (getRes.ok) {
    const j = await getRes.json();
    sha = j.sha;
  }

  // 2) 写入
  const res = await fetch(`${GH}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "ndjc",
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      branch,
      sha,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`writeToRepo failed: HTTP ${res.status} — ${text}`);
  }
}
