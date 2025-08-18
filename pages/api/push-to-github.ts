import type { NextApiRequest, NextApiResponse } from "next";

type Payload = {
  packageName: string;
  java?: string | Record<string, string>;
  resLayout?: string | Record<string, string>;
  resValues?: string | Record<string, string>;
};

const GH_TOKEN  = process.env.GH_TOKEN!;
const GH_OWNER  = process.env.GH_OWNER!;
const GH_REPO   = process.env.GH_REPO!;
const GH_BRANCH = process.env.GH_BRANCH || "main";

const GH_API = "https://api.github.com";

// ✅ 正确的 path 编码：逐段编码，保留 /
function encodeGhPath(p: string) {
  return p.split("/").map(encodeURIComponent).join("/");
}

async function gh(path: string, init?: RequestInit) {
  const res = await fetch(`${GH_API}${path}`, {
    ...(init || {}),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "why-apk-bot", // 友好一点
      ...(init?.headers || {}),
    },
  });

  const text = await res.text();
  let json: any;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok) {
    // 把 GitHub 返回什么就回传给客户端，方便你在 Network 面板直接看到原因
    throw new Error(`GitHub ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function getFileSha(path: string) {
  try {
    const json = await gh(
      `/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeGhPath(path)}?ref=${encodeURIComponent(GH_BRANCH)}`
    );
    return json?.sha as string | undefined;
  } catch (e: any) {
    // 404 表示文件不存在，返回 undefined
    if (String(e.message).includes("404")) return undefined;
    throw e;
  }
}

function b64(s: string) {
  return Buffer.from(s, "utf8").toString("base64");
}

async function putFile(path: string, content: string, message: string) {
  const sha = await getFileSha(path);
  return gh(`/repos/${GH_OWNER}/${GH_REPO}/contents/${encodeGhPath(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message,
      content: b64(content),
      branch: GH_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
}

function norm(maybe: string | Record<string, string> | undefined, key: string) {
  if (!maybe) return {};
  return typeof maybe === "string" ? { [key]: maybe } : maybe;
}

function pkgToJavaDir(pkg: string) {
  return pkg.replace(/\./g, "/");
}

function defaultManifest(packageName: string) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${packageName}">
  <application android:allowBackup="true" android:supportsRtl="true"
      android:theme="@style/Theme.AppCompat.Light.NoActionBar">
    <activity android:name=".MainActivity">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>`.trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method Not Allowed" });
    if (!GH_TOKEN || !GH_OWNER || !GH_REPO) return res.status(500).json({ ok: false, error: "Server missing GH_* envs" });

    const body = (req.body || {}) as Payload;
    const { packageName } = body;

    if (!packageName || !/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+$/.test(packageName)) {
      return res.status(400).json({ ok: false, error: "Invalid packageName" });
    }

    const javaMap   = norm(body.java, "MainActivity.java");
    const layoutMap = norm(body.resLayout, "activity_main.xml");
    const valuesMap = norm(body.resValues, "strings.xml");

    const mainJava  = javaMap["MainActivity.java"]?.trim();
    const mainXml   = layoutMap["activity_main.xml"]?.trim();
    const strings   = valuesMap["strings.xml"]?.trim();

    if (!mainJava)  return res.status(400).json({ ok: false, error: "java.MainActivity.java empty" });
    if (!mainXml)   return res.status(400).json({ ok: false, error: "resLayout.activity_main.xml empty" });
    if (!strings)   return res.status(400).json({ ok: false, error: "resValues.strings.xml empty" });

    const now = new Date().toISOString();
    const prefix = `chore(gen): apply API payload @ ${now}`;

    const javaDir = `app/src/main/java/${pkgToJavaDir(packageName)}`;

    await putFile(`${javaDir}/MainActivity.java`, mainJava, `${prefix} (MainActivity.java)`);
    await putFile(`app/src/main/res/layout/activity_main.xml`, mainXml, `${prefix} (activity_main.xml)`);
    await putFile(`app/src/main/res/values/strings.xml`, strings, `${prefix} (strings.xml)`);

    const manifestPath = `app/src/main/AndroidManifest.xml`;
    if (!(await getFileSha(manifestPath))) {
      await putFile(manifestPath, defaultManifest(packageName), `${prefix} (manifest)`);
    }

    res.status(200).json({
      ok: true,
      repo: GH_REPO,
      owner: GH_OWNER,
      branch: GH_BRANCH,
      packageName,
      changed: [
        `${javaDir}/MainActivity.java`,
        `app/src/main/res/layout/activity_main.xml`,
        `app/src/main/res/values/strings.xml`,
        manifestPath,
      ],
    });
  } catch (e: any) {
    // 把后端错误文本返回，方便你在浏览器 Network 的 Response 里直接看到根因
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}
