export const cfg = {
  owner: process.env.GH_OWNER!,
  repo: process.env.GH_REPO!,
  baseRef: process.env.GH_BASE_REF ?? "main",
  branchPrefix: process.env.GH_BRANCH_PREFIX ?? "ndjc-run",
  dispatchEvent: process.env.GH_DISPATCH_EVENT ?? "generate-apk",
  token: process.env.GITHUB_TOKEN!,
};
